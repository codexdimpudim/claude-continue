// Bundled safety engine preserves compatibility with the original one-file loader.
if (typeof window !== "undefined" && !window.ClaudeAutoContinueEngine) {
/* MIT; Claude Auto Continue safety engine. No network or DOM access. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClaudeAutoContinueEngine = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const STATES = Object.freeze(['DISABLED','IDLE','GENERATING','FINISHED','COUNTDOWN','SENDING_CONTINUE','WAITING_FOR_GENERATION','RATE_LIMITED','WAITING_FOR_USAGE_RESET','CHECKING_AVAILABILITY','NETWORK_ERROR','RECOVERING','PAUSED','ERROR','STOPPED']);
  const edges = {
    DISABLED:['IDLE'], STOPPED:['IDLE'], PAUSED:['IDLE'], ERROR:['PAUSED','IDLE'],
    IDLE:['COUNTDOWN','GENERATING','RATE_LIMITED','NETWORK_ERROR'],
    GENERATING:['FINISHED','RATE_LIMITED','NETWORK_ERROR'],
    FINISHED:['COUNTDOWN','GENERATING','RATE_LIMITED','NETWORK_ERROR'],
    COUNTDOWN:['SENDING_CONTINUE','GENERATING','RATE_LIMITED','NETWORK_ERROR'],
    SENDING_CONTINUE:['WAITING_FOR_GENERATION','GENERATING','RATE_LIMITED','NETWORK_ERROR'],
    WAITING_FOR_GENERATION:['GENERATING','RATE_LIMITED','NETWORK_ERROR'],
    RATE_LIMITED:['WAITING_FOR_USAGE_RESET'],
    WAITING_FOR_USAGE_RESET:['CHECKING_AVAILABILITY'],
    CHECKING_AVAILABILITY:['WAITING_FOR_USAGE_RESET','RECOVERING','NETWORK_ERROR','GENERATING'],
    NETWORK_ERROR:['RECOVERING','RATE_LIMITED'],
    RECOVERING:['COUNTDOWN','IDLE','GENERATING','RATE_LIMITED','NETWORK_ERROR']
  };
  const defaults = Object.freeze({delaySeconds:10,maxConsecutive:10,maxHours:6,minCooldownMs:5000,quietMs:2500,verifyMs:5000,sendTimeoutMs:45000,pollMinutes:[2,5,10,15],networkRetryMs:120000});
  function number(value, fallback, min, max) { return Number.isFinite(Number(value)) ? Math.min(max, Math.max(min,Number(value))) : fallback; }
  function config(input={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))input={};
    return {...defaults,...input,
      delaySeconds:number(input.delaySeconds,10,1,300),
      maxConsecutive:input.maxConsecutive==='unlimited'?'unlimited':Math.floor(number(input.maxConsecutive,10,1,10000)),
      maxHours:input.maxHours==='unlimited'?'unlimited':number(input.maxHours,6,0.01,24),
      minCooldownMs:Math.max(5000,number(input.minCooldownMs,5000,5000,300000)),
      quietMs:number(input.quietMs,2500,2500,30000),verifyMs:number(input.verifyMs,5000,5000,60000),
      sendTimeoutMs:number(input.sendTimeoutMs,45000,45000,300000),networkRetryMs:number(input.networkRetryMs,120000,120000,900000),
      pollMinutes:Array.isArray(input.pollMinutes)&&input.pollMinutes.length&&input.pollMinutes.every(x=>Number.isFinite(x)&&x>=2&&x<=60)?input.pollMinutes.slice(0,8):[2,5,10,15]
    };
  }
  function resetTime(text, now=Date.now()) {
    // Only explicit local clock times. Ambiguous dates/time zones fall back to polling.
    if (/\b(?:UTC|GMT|[A-Z]{2,4}[SD]T)\b|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/.test(text)) return null;
    if (!/(?:reset|until|available|use claude again|try again)/i.test(text)) return null;
    const m=text.match(/\b(?:at\s+)?(?:(\d{1,2})(?::([0-5]\d))?\s*(am|pm)|(midnight|noon))(?=\b|Upgrade)/i);
    if(!m) return null;
    let hour=m[4]?(/noon/i.test(m[4])?12:0):Number(m[1]);
    if(!m[4]&&(hour<1||hour>12)) return null;
    if(!m[4]) hour=hour%12+(/pm/i.test(m[3])?12:0);
    const d=new Date(now);d.setHours(hour,Number(m[2]||0),0,0);
    if (/tomorrow/i.test(text)||d.getTime()<=now) d.setDate(d.getDate()+1);
    return {timestamp:d.getTime(),category:'visible-status-local-time',confidence:'medium'};
  }
  function classify({warnings=[],online=true,composerUsable=true,unknownError=false}={}) {
    if(!online) return {kind:'NETWORK'};
    // Consider every banner before falling back to an unfamiliar error.
    const limit=warnings.find(text=>/\b(?:usage|session|daily|weekly|message|rate)\s+limits?\b|(?:you.ve|you have) (?:reached|hit) (?:your|the) (?:usage )?limit|out of (?:free |remaining )?(?:messages|usage)|use Claude again at/i.test(text));
    if(limit) return {kind:'RATE_LIMIT',confidence:2+Number(/reset|until|available again|try again at/i.test(limit))+Number(!composerUsable),resetText:limit};
    if(warnings.some(text=>/network (?:error|issue)|connection (?:interrupted|lost|failed|error)|offline|failed to fetch|disconnected/i.test(text))) return {kind:'NETWORK'};
    if(warnings.some(text=>/server (?:error|issue)|overloaded|capacity|temporarily unavailable/i.test(text))) return {kind:'SERVER'};
    if(warnings.some(text=>/\berror\b|\bfailed\b|unable to|cannot|can't|something went wrong|try again/i.test(text))) return {kind:'UNKNOWN'};
    return {kind:unknownError?'UNKNOWN':null};
  }
  // An interrupted task is not a completed reply. Only explicit Start or
  // verified quota recovery can resume it without a completion toolbar.
  function continuationAllowed(s,basis='complete') {
    return s.ready&&!s.generating&&!s.error&&(s.completed||['explicit-start','quota-recovery'].includes(basis));
  }
  class Engine {
    constructor(options={},log=()=>{}) {
      this.options=config(options);this.log=log;this.state='DISABLED';this.epoch=0;
      this.stats={start:null,count:0,failures:0,usageWaits:0,lastContinuation:null,lastSuccess:null};
      this.nextCheck=null;this.deadline=null;this.lastError=null;this.lastSend=-Infinity;this.awaitingConfirmation=false;
      this.lastHash=null;this.repeats=0;this.emptyCount=0;
    }
    transition(next,reason='') {
      if(next===this.state)return;
      if(!STATES.includes(next)||(!['PAUSED','DISABLED','STOPPED','ERROR'].includes(next)&&!edges[this.state]?.includes(next))) throw Error(`Invalid transition ${this.state} -> ${next}`);
      const from=this.state;this.state=next;this.log({event:'state',from,to:next,reason});
    }
    cancel(next='PAUSED',reason='HUMAN_CONTROL') {this.epoch++;this.deadline=null;this.nextCheck=null;this.awaitingConfirmation=false;this.verifyingInterrupted=false;this.lastReason=reason;this.transition(next,reason);}
    arm(conversation,now=Date.now(),continueExisting=false) {
      if(!conversation){this.cancel('PAUSED','CONVERSATION_UNKNOWN');return;}
      if(!['DISABLED','PAUSED','STOPPED','ERROR'].includes(this.state))this.cancel();
      this.epoch++;this.conversation=conversation;this.stats.start=now;this.stats.count=0;
      this.lastHash=null;this.repeats=0;this.emptyCount=0;this.lastError=null;this.nextCheck=null;
      this.resumeNeeded=false;this.kickoffRequested=continueExisting;this.quietSince=null;this.quietHash=null;this.lastReason=null;this.awaitingConfirmation=false;this.verifyingInterrupted=false;this.recoveryBasis=null;this.quietTaskHash=null;
      this.transition('IDLE','USER_ENABLED');
    }
    inactive(){return ['DISABLED','PAUSED','STOPPED','ERROR'].includes(this.state);}
    wait(kind,s,now) {
      if(!['RATE_LIMIT','NETWORK','SERVER'].includes(kind)){this.lastError=kind;this.cancel('PAUSED',kind);return;}
      if(kind!=='RATE_LIMIT'&&['SENDING_CONTINUE','WAITING_FOR_GENERATION'].includes(this.state)) {this.failed('DELIVERY_UNCERTAIN');return;}
      this.resumeNeeded=(this.kickoffRequested&&(!!s.hash||s.hasUserTurn===true))||['GENERATING','FINISHED','COUNTDOWN','SENDING_CONTINUE','WAITING_FOR_GENERATION','RECOVERING'].includes(this.state)||this.resumeNeeded===true;
      this.epoch++;this.deadline=null;this.awaitingConfirmation=false;this.verifyingInterrupted=false;this.lastError=kind;this.verifyAt=null;this.recoveryQuietSince=null;
      this.recoveryBasis=kind==='RATE_LIMIT'&&this.resumeNeeded?'quota-recovery':null;
      if(kind==='RATE_LIMIT') {
        this.transition('RATE_LIMITED',kind);this.stats.usageWaits++;this.poll=0;
        this.reset=resetTime(s.resetText||'',now);this.transition('WAITING_FOR_USAGE_RESET','SENDS_SUSPENDED');
        this.nextCheck=this.reset?Math.max(now+120000,this.reset.timestamp+30000):now+this.options.pollMinutes[0]*60000;
      } else {this.transition('NETWORK_ERROR',kind);this.nextCheck=now+this.options.networkRetryMs;}
    }
    schedule(now,extra=0,hash=this.quietHash,basis='complete',taskHash) {
      if(this.options.maxConsecutive!=='unlimited'&&this.stats.count>=this.options.maxConsecutive) return this.cancel('PAUSED','MAX_CONTINUATIONS');
      this.countdownStarted=now;this.scheduledHash=hash;this.scheduledTaskHash=taskHash;this.sendBasis=basis;this.verifyingInterrupted=false;this.awaitingConfirmation=false;this.confirmed=false;
      this.deadline=Math.max(now+Math.max(extra,this.options.delaySeconds*1000),this.lastSend+this.options.minCooldownMs);
      this.transition('COUNTDOWN','CONTINUATION_SCHEDULED');
    }
    tick(s,now=Date.now()) {
      if(this.inactive())return null;
      if(s.conversation!==this.conversation){this.cancel('PAUSED','CONVERSATION_CHANGED');return null;}
      if(s.humanDraft){this.cancel('PAUSED','HUMAN_DRAFT');return null;}
      if(this.options.maxHours!=='unlimited'&&now-this.stats.start>=this.options.maxHours*3600000&&!s.generating){this.cancel('PAUSED','MAX_RUNTIME');return null;}
      if(this.state==='WAITING_FOR_USAGE_RESET') {
        if(now<this.nextCheck)return null;
        this.transition('CHECKING_AVAILABILITY','PASSIVE_CHECK');
        if(s.error==='RATE_LIMIT') {this.poll++;this.nextCheck=now+this.options.pollMinutes[Math.min(this.poll,this.options.pollMinutes.length-1)]*60000;this.transition('WAITING_FOR_USAGE_RESET','STILL_LIMITED');return null;}
        if(s.error){this.wait(s.error,s,now);return null;}
        if(!s.ready){this.cancel('PAUSED','UI_CHANGED');return null;}
        this.transition('RECOVERING','VERIFY_AVAILABILITY');this.verifyAt=now+this.options.verifyMs;return null;
      }
      if(this.state==='NETWORK_ERROR') {
        if(now<this.nextCheck)return null;
        if(s.error==='RATE_LIMIT'){this.wait(s.error,s,now);return null;}
        if(s.error){if(!['NETWORK','SERVER'].includes(s.error)){this.lastError=s.error;this.cancel('PAUSED',s.error);}else this.nextCheck=now+this.options.networkRetryMs;return null;}
        if(!s.ready){this.cancel('PAUSED','UI_CHANGED');return null;}
        this.transition('RECOVERING','VERIFY_CONNECTION');this.verifyAt=now+this.options.verifyMs;return null;
      }
      if(s.error==='RATE_LIMIT'||s.error==='NETWORK'||s.error==='SERVER'){this.wait(s.error,s,now);return null;}
      if(s.error){this.lastError=s.error;this.cancel('PAUSED',s.error);return null;}
      // A complete, changed assistant response can acknowledge a reply that
      // finished between samples. It never causes a second submission.
      const fastReply=this.state==='WAITING_FOR_GENERATION'&&s.completed&&s.hash&&s.hash!==this.scheduledHash;
      if(s.generating||fastReply) {
        if(this.state!=='GENERATING'){this.epoch++;this.deadline=null;this.awaitingConfirmation=false;this.transition('GENERATING',fastReply?'FAST_RESPONSE_CONFIRMED':'STOP_CONTROL_VISIBLE');}
        this.kickoffRequested=false;this.verifyingInterrupted=false;this.recoveryBasis=null;this.observedHash=s.hash;this.quietSince=null;return null;
      }
      if(!s.ready){this.cancel('PAUSED','UI_CHANGED');return null;}
      if(this.state==='IDLE'&&this.kickoffRequested){
        if(!s.hash&&!s.hasUserTurn){this.cancel('PAUSED','NO_RESPONSE_TO_CONTINUE');return null;}
        this.verifyingInterrupted=!s.completed;
        if(this.quietHash!==s.hash||this.quietTaskHash!==s.taskHash||this.quietSince==null){this.quietHash=s.hash;this.quietTaskHash=s.taskHash;this.quietSince=now;return null;}
        if(now-this.quietSince<Math.max(this.options.quietMs,s.completed?0:10000))return null;
        this.kickoffRequested=false;this.schedule(now,0,s.hash,s.completed?'complete':'explicit-start',s.taskHash);return null;
      }
      if(this.state==='RECOVERING') {
        if(now<this.verifyAt)return null;
        this.nextCheck=null;this.lastError=null;
        if(this.resumeNeeded){
          if(!s.completed){
            if(this.recoveryBasis!=='quota-recovery'){this.cancel('PAUSED','COMPLETION_UNCERTAIN');return null;}
            this.verifyingInterrupted=true;
            if(this.recoveryHash!==s.hash||this.recoveryTaskHash!==s.taskHash||this.recoveryQuietSince==null){this.recoveryHash=s.hash;this.recoveryTaskHash=s.taskHash;this.recoveryQuietSince=now;return null;}
            if(now-this.recoveryQuietSince<Math.max(10000,this.options.quietMs))return null;
          }
          this.resumeNeeded=false;this.kickoffRequested=false;this.schedule(now,0,s.hash,s.completed?'complete':'quota-recovery',s.taskHash);
        }else this.transition('IDLE','AVAILABILITY_VERIFIED');
        return null;
      }
      if(this.state==='GENERATING') {
        if(this.quietHash!==s.hash||this.quietTaskHash!==s.taskHash||this.quietSince==null){this.quietHash=s.hash;this.quietTaskHash=s.taskHash;this.quietSince=now;return null;}
        if(now-this.quietSince<this.options.quietMs)return null;
        if(!s.completed){if(now-this.quietSince>15000)this.cancel('PAUSED','COMPLETION_UNCERTAIN');return null;}
        this.transition('FINISHED','STABLE_COMPLETION_CONFIRMED');this.stats.lastSuccess=now;
        if(!s.hash){this.emptyCount++;if(this.emptyCount>1){this.cancel('PAUSED','EMPTY_RESPONSE_LOOP');return null;}}else this.emptyCount=0;
        this.repeats=s.hash&&s.hash===this.lastHash?this.repeats+1:0;this.lastHash=s.hash;
        if(this.repeats>=2){this.cancel('PAUSED','DUPLICATE_RESPONSE_LOOP');return null;}
        this.schedule(now,this.emptyCount?30000:0,s.hash,'complete',s.taskHash);return null;
      }
      if(this.state==='COUNTDOWN'&&!continuationAllowed(s,this.sendBasis)){this.cancel('PAUSED','COMPLETION_UNCERTAIN');return null;}
      if(this.state==='COUNTDOWN'&&(s.hash!==this.scheduledHash||s.taskHash!==this.scheduledTaskHash)){this.cancel('PAUSED','RESPONSE_CHANGED');return null;}
      if(this.state==='COUNTDOWN'&&now>=this.deadline){
        if(this.options.confirmBeforeSend&&!this.confirmed&&!this.awaitingConfirmation){this.awaitingConfirmation=true;this.log({event:'confirmation-needed'});return null;}
        if(this.awaitingConfirmation)return null;
        this.transition('SENDING_CONTINUE','PREFLIGHT_PASSED');return {type:'send',epoch:this.epoch,conversation:this.conversation,hash:this.scheduledHash,taskHash:this.scheduledTaskHash,basis:this.sendBasis};}
      if(this.state==='WAITING_FOR_GENERATION'&&now>=this.sendDeadline)this.failed('SEND_NOT_ACKNOWLEDGED');
      return null;
    }
    confirm(){if(this.state!=='COUNTDOWN'||!this.awaitingConfirmation)return false;this.awaitingConfirmation=false;this.confirmed=true;return true;}
    sent(epoch,now=Date.now()) {
      if(epoch!==this.epoch||this.state!=='SENDING_CONTINUE')return false;
      this.lastSend=now;this.stats.count++;this.stats.lastContinuation=now;this.sendDeadline=now+this.options.sendTimeoutMs;
      this.transition('WAITING_FOR_GENERATION','SUBMITTED_AWAITING_GENERATION');return true;
    }
    failed(reason='SEND_FAILED') {this.stats.failures++;this.lastError=reason;this.cancel('PAUSED',reason);}
  }
  return {Engine,STATES,defaults,config,resetTime,classify,continuationAllowed};
});

}
// Auto Continue: explicit controls, contextual warnings, and a draggable status card.
(function() {
  'use strict';
  const ID='claude-auto-continue-plugin', KEY='claude_auto_continue_settings';
  if(window.claudeAutoContinue&&!document.getElementById(ID))window.claudeAutoContinue.dispose();
  if(window.claudeAutoContinue||document.getElementById(ID)||!document.body)return;
  const {Engine,config,classify,continuationAllowed}=window.ClaudeAutoContinueEngine;
  const VERSION='2.2.1-mac-preview';
  const PRESETS={
    Default:'Continue working on the current project from exactly where you left off. Preserve completed work. Test your latest changes, fix any problems you find, then proceed to the next highest-priority unfinished task. Do not restart the project or redo completed work.',
    Simple:'Continue.',
    Coding:'Continue working from where you left off. Preserve completed work. Test the latest changes, fix any issues, and proceed to the next unfinished task.',
    'Game Development':'Continue developing the current game from exactly where you left off. Preserve all working systems and completed improvements. Test the latest changes, fix bugs, regressions, visual problems, broken interactions, or performance issues you find, then proceed to the next highest-priority unfinished improvement. Do not restart the project or redo completed work.',
    'Autonomous Development':'Continue the current development project autonomously from where you left off. Preserve working features. Review the latest changes, test them, fix failures or regressions, and continue with the next highest-priority unfinished task. Do not redo finished work and do not stop merely because one improvement pass is complete.'
  };
  const SELECTORS=Object.freeze({
    composer:'div.ProseMirror[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea[placeholder*="Reply"], textarea[placeholder*="Message"]',
    stop:'button[aria-label="Stop response" i],button[aria-label="Stop generating" i],button[aria-label="Stop" i],button[data-testid="stop-button"]',
    send:'button[aria-label="Send message" i],button[aria-label="Send Message" i],button[data-testid="send-button"],button[data-testid="chat-input-send"]',
    assistant:'[data-message-author-role="assistant"], [data-testid="assistant-message"], .font-claude-response',
    message:'[data-message-author-role], [data-testid="user-message"], [data-testid="assistant-message"], .font-claude-response, pre, code',
    warning:'[role="alert"], [role="status"], [data-testid="usage-limit-banner"], [data-testid="error-banner"]',
    buttons:'button', completion:'button[data-testid="action-bar-copy"],button[aria-label="Copy" i],button[aria-label="Copy response" i],button[data-testid="copy-response-button"]'
  });
  const THEMES={
    Terracotta:{bg:'#292521',surface:'#24211f',border:'#51463f',text:'#f2ece6',muted:'#baaea5',accent:'#e3ab90',ink:'#241b16',field:'#181716'},
    Ocean:{bg:'#192630',surface:'#1c2d38',border:'#3b5769',text:'#e4f3fb',muted:'#aac4d4',accent:'#88c7ef',ink:'#12232f',field:'#14202a'},
    Forest:{bg:'#202b24',surface:'#25342a',border:'#45664f',text:'#edf5e9',muted:'#b4c5b1',accent:'#add29b',ink:'#1b2b18',field:'#19231c'},
    Lavender:{bg:'#282330',surface:'#302839',border:'#645273',text:'#f4edf9',muted:'#c4b4d1',accent:'#c4a5e7',ink:'#291c38',field:'#201b29'},
    Light:{bg:'#fcf8f2',surface:'#fffdf8',border:'#d7c6b8',text:'#332b25',muted:'#736050',accent:'#b56846',ink:'#ffffff',field:'#f2e9df'}
  };
  const TOUR_KEY='claude_continue_onboarding_seen';
  let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{};if(typeof saved!=='object'||Array.isArray(saved))saved={};}catch{}
  let settings={...config(saved),phrase:typeof saved.phrase==='string'?saved.phrase:PRESETS.Default,
    project:typeof saved.project==='string'?saved.project:'',position:saved.position,keepAwake:saved.keepAwake===true,debug:saved.debug===true,theme:Object.hasOwn(THEMES,saved.theme)?saved.theme:'Terracotta',paranoid:saved.paranoid===true,compact:saved.compact===true,oneShot:saved.oneShot===true,confirmBeforeSend:saved.confirmBeforeSend===true};
  const container=document.createElement('div');container.id=ID;
  const pos=settings.position;
  const initialTop=Number.isFinite(pos?.top)?`${Math.max(48,pos.top)}px`:'auto';
  const initialLeft=Number.isFinite(pos?.left)?`${pos.left}px`:'auto';
  const initialBottom=initialTop==='auto'?'80px':'auto', initialRight=initialLeft==='auto'?'24px':'auto';
  container.innerHTML=`<style>
    #${ID},#${ID} *{box-sizing:border-box;-webkit-app-region:no-drag!important}
    #${ID}{position:fixed;top:${initialTop};left:${initialLeft};bottom:${initialBottom};right:${initialRight};z-index:999999;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f2ece6;user-select:none;width:300px;max-width:calc(100vw - 16px);color-scheme:dark}
    #${ID} .ac-container{padding:16px;background:linear-gradient(145deg,rgba(44,40,37,.98),rgba(26,25,24,.98));border:1px solid #51463f;border-radius:18px;box-shadow:0 14px 45px #0006;backdrop-filter:blur(24px)}
    #${ID} .ac-header{display:flex;align-items:center;gap:9px;margin-bottom:14px}
    #${ID} .ac-icon-handle{cursor:grab;display:flex;align-items:center;gap:9px;flex:1;font-weight:650;letter-spacing:.1px}
    #${ID} .ac-mark{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:#d9957722;color:#edb296;font-size:19px}
    #${ID} button{font:inherit;cursor:pointer;border:1px solid #ffffff18;border-radius:9px;background:#ffffff08;color:#d8cec6;padding:7px 11px;transition:background .15s}
    #${ID} button:hover{background:#ffffff18}#${ID} button:focus-visible,#${ID} input:focus-visible,#${ID} textarea:focus-visible,#${ID} select:focus-visible{outline:2px solid #edb296;outline-offset:3px}
    #${ID} #ac-settings-btn{padding:4px 8px;font-size:11px;color:#c4b5aa}
    #${ID} .ac-status-line{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600}
    #${ID} .ac-dot{width:7px;height:7px;border-radius:50%;background:#a59a90;flex:none}
    #${ID} .ac-active-glow .ac-dot{background:#a7c9a2;box-shadow:0 0 0 4px #a7c9a212}
    #${ID} .ac-counting .ac-dot{background:#efb291}
    #${ID} #ac-detail{color:#baaea5;font-size:12px;min-height:36px;margin:7px 0 13px;line-height:1.5}
    #${ID} .ac-actions{display:flex;gap:7px}#${ID} #ac-cancel-btn{flex:1;background:#e3ab90;color:#241b16;border-color:#e3ab90;font-weight:650}#${ID} #ac-cancel-btn:hover{background:#efbda4}
    #${ID} .ac-footer{display:flex;justify-content:space-between;border-top:1px solid #ffffff0c;margin-top:13px;padding-top:10px;font-size:10px;color:#ab9c90;letter-spacing:.3px}
    #${ID} .ac-toggle-label{display:none}
    #${ID} .ac-panel{display:none;position:fixed;width:340px;max-width:calc(100vw - 16px);max-height:calc(100vh - 64px);overflow:auto;padding:18px;background:#24211f;border:1px solid #51463f;border-radius:16px;box-shadow:0 14px 50px #0008;color:#eee7e1}
    #${ID} .ac-panel.open{display:block}#${ID} .ac-panel label{display:block;margin:13px 0;color:#c9bdb4;font-size:12px}
    #${ID} textarea,#${ID} select,#${ID} input[type=number],#${ID} input[type=text]{font:inherit;color:#eee7e1;background:#181716;border:1px solid #51463f;border-radius:7px;padding:7px;max-width:100%;user-select:text}
    #${ID} textarea{display:block;width:100%;min-height:80px;margin-top:6px;resize:vertical}#${ID} select{margin-left:5px}#${ID} input[type=number]{width:65px}#${ID} #ac-poll{width:100%;margin-top:6px}
    #${ID} pre{white-space:pre-wrap;font:10px/1.6 ui-monospace,monospace;color:#ac9d91;border-top:1px solid #ffffff15;padding-top:12px}#${ID} small{font-size:10px;color:#ac9d91}
    #${ID}{color:var(--ac-text)}
    #${ID} .ac-container,#${ID} .ac-panel{background:var(--ac-bg);border-color:var(--ac-border);color:var(--ac-text)}
    #${ID} button{color:var(--ac-text);border-color:var(--ac-border)}
    #${ID} #ac-cancel-btn,#${ID} #ac-tour-next,#${ID} #ac-confirm-btn{background:var(--ac-accent);color:var(--ac-ink);border-color:var(--ac-accent)}
    #${ID} #ac-cancel-btn:hover{filter:brightness(1.08);background:var(--ac-accent)}
    #${ID} #ac-detail,#${ID} .ac-footer,#${ID} .ac-panel label,#${ID} small,#${ID} pre,#${ID} #ac-settings-btn{color:var(--ac-muted)}
    #${ID} textarea,#${ID} select,#${ID} input[type=number],#${ID} input[type=text]{color:var(--ac-text);background:var(--ac-field);border-color:var(--ac-border)}
    #${ID} .ac-mark{background:var(--ac-field);color:var(--ac-accent)}
    #${ID} button:focus-visible,#${ID} input:focus-visible,#${ID} select:focus-visible,#${ID} textarea:focus-visible{outline-color:var(--ac-accent)}
    #${ID} #ac-monitor{display:none;margin:9px 0 14px;padding:10px;background:var(--ac-field);border:1px solid var(--ac-border);border-radius:10px}
    #${ID} #ac-clock{font:600 25px/1.3 ui-monospace,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
    #${ID} #ac-clock.ac-clock-label{font-size:18px;letter-spacing:0}
    #${ID} #ac-clock-note{color:var(--ac-muted);font-size:10px;margin-top:4px}
    #${ID} .ac-progress{height:3px;background:var(--ac-border);margin-top:9px;border-radius:3px;overflow:hidden}
    #${ID} #ac-progress-fill{height:100%;background:var(--ac-accent);width:0}
    #${ID} #ac-confirm-btn{width:100%;margin:5px 0 12px}
    #${ID} [hidden]{display:none!important}
    #${ID} .ac-compact #ac-detail,#${ID} .ac-compact .ac-footer{display:none}
    #${ID} .ac-compact .ac-header{margin-bottom:9px}#${ID} .ac-compact .ac-actions{margin-top:10px}
    #${ID} .ac-tour{position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;background:#0008;padding:20px}
    #${ID} .ac-tour-card{width:380px;max-width:100%;max-height:calc(100vh - 40px);overflow:auto;background:var(--ac-surface);border:1px solid var(--ac-border);border-radius:20px;padding:26px;box-shadow:0 20px 70px #0008}
    #${ID} .ac-tour-card h2{font-size:24px;line-height:1.3;margin:15px 0 10px;letter-spacing:-.5px}
    #${ID} .ac-tour-card p{color:var(--ac-muted);line-height:1.7;margin:0 0 20px}
    #${ID} .ac-tour-actions{display:flex;gap:10px}#${ID} #ac-tour-next{flex:1}
    #${ID} .ac-tour-step{font-size:11px;color:var(--ac-muted);margin-bottom:8px}
    #${ID} .ac-settings-title{margin:18px 0 5px;font-size:10px;text-transform:uppercase;letter-spacing:1.3px;color:var(--ac-muted)}
    #${ID} #ac-history{font-size:11px;color:var(--ac-muted);padding-left:18px}#${ID} #ac-history li{margin:6px 0}
    </style>
    <div class="ac-container" id="ac-container">
      <div class="ac-header"><div class="ac-icon-handle" id="ac-drag-handle" title="Drag to move"><span class="ac-mark" aria-hidden="true">↻</span>Claude Continue</div><button id="ac-settings-btn" aria-expanded="false" aria-controls="ac-panel">Settings</button></div>
      <label class="ac-toggle-label"><input type="checkbox" id="ac-enabled-check" aria-label="Enable Auto Continue" tabindex="-1"></label>
      <div class="ac-status-line"><span class="ac-dot" aria-hidden="true"></span><span id="ac-state" role="status">Ready when you are</span></div>
      <div id="ac-detail" aria-live="polite"></div>
      <div id="ac-monitor"><div id="ac-clock" aria-live="off">No send scheduled</div><div id="ac-clock-note"></div><div class="ac-progress"><div id="ac-progress-fill"></div></div></div>
      <button id="ac-confirm-btn" hidden>Approve this continuation</button>
      <div class="ac-actions"><button id="ac-cancel-btn">Start</button><button id="ac-stop-btn" title="Stop automatic continuations">Stop</button></div>
      <div class="ac-footer"><span id="ac-summary">0 continuations</span><span id="ac-runtime">0 min active</span></div>
    </div>
    <section class="ac-panel" id="ac-panel" aria-label="Auto Continue settings"><div class="ac-header"><strong style="flex:1">Settings</strong><button id="ac-settings-close" aria-label="Close settings">Done</button></div>
      <div class="ac-settings-title">Appearance &amp; visibility</div>
      <label>Color scheme <select id="ac-theme"></select></label>
      <label><input id="ac-paranoid" type="checkbox"> Paranoid mode — precise countdown</label>
      <label><input id="ac-compact" type="checkbox"> Compact widget</label>
      <div class="ac-settings-title">Continuation controls</div>
      <label><input id="ac-confirm" type="checkbox"> Ask me before each continuation</label>
      <label><input id="ac-one-shot" type="checkbox"> Continue once, then pause</label>
      <label>Preset <select id="ac-preset"><option>Custom</option></select></label>
      <label>Continuation prompt<textarea id="ac-phrase-input"></textarea></label>
      <label>Optional project instructions<textarea id="ac-project"></textarea></label>
      <label>Delay (seconds) <input id="ac-delay-input" type="number" min="1" max="300"></label>
      <label>Maximum continuations <select id="ac-max"></select></label>
      <label>Maximum runtime <select id="ac-hours"></select></label>
      <label>Usage checks (minutes, at least 2)<input id="ac-poll" type="text"></label>
      <label><input id="ac-awake" type="checkbox"> Keep Mac awake while active</label>
      <label><input id="ac-debug" type="checkbox"> Operational debug logging</label>
      <button id="ac-logs">Open Logs</button>
      <button id="ac-help-btn">Quick tour</button><button id="ac-position-reset">Reset position</button>
      <div class="ac-settings-title">Recent activity</div><ol id="ac-history"></ol>
      <details><summary>Session diagnostics</summary><pre id="ac-stats"></pre></details>
      <small>Enable explicitly after each launch or chat change. Use Resume after adjusting settings.</small>
    </section>
    <div id="ac-tour" class="ac-tour" hidden><section class="ac-tour-card" role="dialog" aria-modal="true" aria-labelledby="ac-tour-title" tabindex="-1">
      <div class="ac-tour-step" id="ac-tour-step"></div><div class="ac-mark" aria-hidden="true">↻</div>
      <h2 id="ac-tour-title"></h2><p id="ac-tour-text"></p>
      <div class="ac-tour-actions"><button id="ac-tour-skip">Skip tour</button><button id="ac-tour-next">Next</button></div>
    </section></div>`;
  document.body.appendChild(container);
  const el=id=>container.querySelector('#'+id), widget=el('ac-container'),check=el('ac-enabled-check');
  const listeners=[];const on=(target,event,handler,opts)=>{target.addEventListener(event,handler,opts);listeners.push(()=>target.removeEventListener(event,handler,opts));};
  const logs=[];
  function emit(data){console.info('[ClaudeAutoContinue] '+JSON.stringify(data));}
  function log(data){const row={time:new Date().toISOString(),...data};logs.push(row);if(logs.length>100)logs.shift();emit(row);}
  function engineOptions(){return config({...settings,maxConsecutive:settings.oneShot?1:settings.maxConsecutive});}
  const engine=new Engine(engineOptions(),log);
  let disposed=false,ownedDraft=null,writing=false,releaseLock=null,arming=false,armRequest=0,pending=null,lastPulse=0,lastTick=Date.now(),drag=null;
  let tourStep=0,tourReturnFocus=null,lastSize='';
  function applyAppearance(){for(const [k,v] of Object.entries(THEMES[settings.theme]))container.style.setProperty('--ac-'+k,v);container.style.colorScheme=settings.theme==='Light'?'light':'dark';widget.classList.toggle('ac-compact',settings.compact);}
  function save(){try{localStorage.setItem(KEY,JSON.stringify({...settings,enabled:false}));}catch{log({event:'storage-unavailable'});}}
  function conversation(){return /^\/chat\/[a-zA-Z0-9-]+\/?$/.test(location.pathname)?location.origin+location.pathname:null;}
  function visible(node){if(!node||container.contains(node)||!node.isConnected)return false;const c=getComputedStyle(node);return c.display!=='none'&&c.visibility!=='hidden'&&node.getClientRects().length>0;}
  function all(selector,root=document){return [...root.querySelectorAll(selector)].filter(visible);}
  function unique(selector,root=document){const nodes=all(selector,root);return nodes.length===1?nodes[0]:null;}
  function sendControl(){const nodes=[...document.querySelectorAll(SELECTORS.send)].filter(n=>n.isConnected&&!container.contains(n));return nodes.length===1?nodes[0]:null;}
  function usable(node){return !!node&&!node.disabled&&!node.readOnly&&node.getAttribute('aria-disabled')!=='true'&&!node.closest('[inert]');}
  function value(node){return node?('value'in node?node.value:node.textContent||''):'';}
  function fingerprint(text){if(!text.trim())return null;let n=2166136261;for(const c of text.trim().replace(/\s+/g,' '))n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(16);}
  function snapshot(){
    const composer=unique(SELECTORS.composer), send=sendControl(),stop=unique(SELECTORS.stop);
    const responses=all(SELECTORS.assistant),response=responses.at(-1);
    const userTurn=all('[data-message-author-role="user"], [data-testid="user-message"]').at(-1);
    // Toolbars can be siblings of the response body. Stop at another assistant
    // response so an older turn's Copy button can never complete the latest turn.
    let area=response?.closest('[data-message-author-role="assistant"]')||response?.closest('[data-testid="assistant-message"]')||response?.parentElement;
    const completionControls=node=>[...node.querySelectorAll(SELECTORS.completion)].filter(b=>b.isConnected&&!container.contains(b)).filter(b=>!b.closest('pre,code,[data-testid="code-block"]')&&(b.getAttribute('aria-label')?.toLowerCase()!=='copy'||!response.contains(b)));
    if(response){
      for(let n=response.parentElement,depth=0;n&&n!==document.body&&depth<8;n=n.parentElement,depth++){
        const others=[...n.querySelectorAll(SELECTORS.assistant)].filter(x=>x!==response&&!x.contains(response)&&!response.contains(x));
        if(others.length)break;
        if(completionControls(n).length){area=n;break;}
      }
    }
    const completed=!!response&&(response.getAttribute('data-is-streaming')==='false'||!!(area&&completionControls(area).length));
    const direct=area?all(SELECTORS.buttons,area).filter(b=>/^(continue|continue generating|resume)$/i.test((b.textContent||'').trim())&&usable(b)):[];
    const warnings=all(SELECTORS.warning).filter(n=>!n.closest(SELECTORS.message)).map(n=>n.textContent||'');
    const error=classify({warnings,online:navigator.onLine,composerUsable:usable(composer),unknownError:all('[data-testid="error-banner"], [role="alert"][data-severity="error"]').some(n=>!n.closest(SELECTORS.message))});
    const text=value(composer);
    if(ownedDraft?.submitted&&ownedDraft.node===composer&&!text.trim())ownedDraft=null;
    const controlsAmbiguous=all(SELECTORS.stop).length>1||all(SELECTORS.send).length>1;
    return {conversation:conversation(),composer,send,direct:direct.length===1?direct[0]:null,
      generating:!!stop||!!(response&&(response.matches('[data-is-streaming="true"], [aria-busy="true"]')||area?.matches('[data-is-streaming="true"], [aria-busy="true"]')||all('[data-is-streaming="true"], [aria-busy="true"]',area||response).length)),ready:!!composer&&usable(composer)&&!!send&&!controlsAmbiguous,
      completed,hash:fingerprint(response?.textContent||''),taskHash:fingerprint(userTurn?.textContent||''),hasUserTurn:!!userTurn,error:error.kind,resetText:error.resetText,
      humanDraft:!!text.trim()&&!(ownedDraft&&ownedDraft.node===composer&&ownedDraft.text===text),warnings: warnings.length};
  }
  function clearOwned(){if(!ownedDraft)return;const draft=ownedDraft;ownedDraft=null;if(!draft.submitted&&value(draft.node)===draft.text){try{writing=true;setValue(draft.node,'');}catch{log({event:'draft-cleanup-failed'});}finally{writing=false;}}}
  function cancel(state='PAUSED',reason='HUMAN_CONTROL'){
    armRequest++;arming=false;engine.cancel(state,reason);if(pending){clearTimeout(pending);pending=null;}clearOwned();
    if(releaseLock){releaseLock();releaseLock=null;}check.checked=false;render();pulse();
  }
  async function arm(once=false){
    if(!el('ac-tour').hidden){el('ac-tour-next').focus();return;}
    if(arming||!engine.inactive())return;
    const request=++armRequest;arming=true;render();
    if(!navigator.locks){arming=false;cancel('PAUSED','WINDOW_LOCK_UNAVAILABLE');return;}
    try {await navigator.locks.request('claude-auto-continue-owner',{ifAvailable:true},async lock=>{
      if(request!==armRequest||disposed)return;
      arming=false;
      if(!lock){cancel('PAUSED','ANOTHER_WINDOW_ACTIVE');return;}
      engine.options=engineOptions();if(once===true)engine.options.maxConsecutive=1;engine.arm(conversation(),Date.now(),true);check.checked=!engine.inactive();
      if(engine.inactive()){render();return;}
      const held=new Promise(resolve=>{releaseLock=resolve;});tick();render();await held;
    });}catch{arming=false;cancel('PAUSED','WINDOW_LOCK_FAILED');}
  }
  function setValue(node,text){
    if(node.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,text);node.dispatchEvent(new Event('input',{bubbles:true}));return;}
    node.focus();
    const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);
    // Browser editing command lets ProseMirror observe a real edit transaction.
    if(!document.execCommand('insertText',false,text))throw Error('EDITOR_INSERT_FAILED');
    node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
  }
  function valid(action,s){return !disposed&&releaseLock&&engine.state==='SENDING_CONTINUE'&&engine.epoch===action.epoch&&s.conversation===action.conversation&&!s.error&&!s.generating&&continuationAllowed(s,action.basis)&&!s.humanDraft&&s.hash===action.hash&&s.taskHash===action.taskHash;}
  function send(action){
    let s=snapshot();
    if(!valid(action,s)){cancel('PAUSED','SEND_PREFLIGHT_CHANGED');return;}
    if(s.direct){engine.sent(action.epoch);s.direct.click();render();return;}
    if(value(s.composer).trim()){cancel('PAUSED','HUMAN_DRAFT');return;}
    const text=(settings.phrase+'\n\n'+settings.project).trim();
    if(!text){engine.failed('EMPTY_PROMPT');return;}
    try{writing=true;ownedDraft={node:s.composer,text};setValue(s.composer,text);}catch{ownedDraft=null;engine.failed('EDITOR_INSERT_FAILED');return;}finally{writing=false;}
    pending=setTimeout(()=>{
      pending=null;s=snapshot();
      if(action.epoch!==engine.epoch||engine.state!=='SENDING_CONTINUE'){clearOwned();return;}
      if(s.error){engine.tick(s);clearOwned();render();return;}
      if(!valid(action,s)||!ownedDraft||s.composer!==ownedDraft.node||value(s.composer)!==ownedDraft.text){cancel('PAUSED','SEND_PREFLIGHT_CHANGED');return;}
      if(!usable(s.send)||!visible(s.send)){engine.failed('SEND_BUTTON_DISABLED');clearOwned();render();return;}
      // A missing acknowledgement never triggers a second click or an Enter fallback.
      engine.sent(action.epoch);ownedDraft.submitted=true;s.send.click();render();
    },250);
  }
  function pulse(){emit({event:'heartbeat',active:!engine.inactive(),keepAwake:settings.keepAwake,state:engine.state,rendererVersion:VERSION,tutorialVisible:!el('ac-tour').hidden,widgets:document.querySelectorAll('#'+ID).length,composer:!!unique(SELECTORS.composer),send:!!sendControl()});lastPulse=Date.now();}
  function tick(){try{tickSafely();}catch{cancel('ERROR','UNEXPECTED_UI_ERROR');}}
  function tickSafely(){
    if(disposed)return;
    const now=Date.now();
    if(now-lastTick>60000&&!engine.inactive()&&!['WAITING_FOR_USAGE_RESET','NETWORK_ERROR'].includes(engine.state)){cancel('PAUSED','WAKE_REVALIDATION_REQUIRED');}
    lastTick=now;
    if(!engine.inactive()){
      if(conversation()!==engine.conversation){cancel('PAUSED','CONVERSATION_CHANGED');return;}
      if(settings.maxHours!=='unlimited'&&now-engine.stats.start>=settings.maxHours*3600000&&engine.state!=='GENERATING'){cancel('PAUSED','MAX_RUNTIME');return;}
      const waiting=['WAITING_FOR_USAGE_RESET','NETWORK_ERROR'].includes(engine.state);
      if(!waiting||now>=engine.nextCheck){
        const s=snapshot();const action=engine.tick(s,now);
        if(pending&&engine.state!=='SENDING_CONTINUE'){clearTimeout(pending);pending=null;clearOwned();}
        if(settings.debug)log({event:'debug',composer:!!s.composer,send:!!s.send,generating:s.generating,completed:s.completed,error:s.error});
        if(action)send(action);
      }
    }
    if(engine.inactive()&&releaseLock){releaseLock();releaseLock=null;clearOwned();check.checked=false;pulse();}
    render();if(now-lastPulse>10000)pulse();
  }
  const labels={DISABLED:'Ready when you are',IDLE:'Idle — waiting for a response',GENERATING:'Claude is working',FINISHED:'Response finished',SENDING_CONTINUE:'Sending Continue',WAITING_FOR_GENERATION:'Waiting for Claude',RATE_LIMITED:'Usage Limit Reached',WAITING_FOR_USAGE_RESET:'Waiting for usage reset',CHECKING_AVAILABILITY:'Checking Availability',NETWORK_ERROR:'Waiting for connection/service',RECOVERING:'Verifying availability',PAUSED:'Paused',ERROR:'Error',STOPPED:'Stopped'};
  function render(){
    const status=engine.verifyingInterrupted?'Verifying interrupted reply':engine.awaitingConfirmation?'Waiting for your approval':engine.state==='PAUSED'&&engine.lastReason==='UI_CHANGED'?'Claude UI changed — paused':engine.state==='PAUSED'&&engine.lastReason==='DUPLICATE_RESPONSE_LOOP'?'Possible continuation loop — paused':engine.state==='COUNTDOWN'?`Continuing in ${Math.max(0,Math.ceil((engine.deadline-Date.now())/1000))}s`:labels[engine.state];
    if(el('ac-state').textContent!==status)el('ac-state').textContent=status;
    widget.classList.toggle('ac-active-glow',!engine.inactive());widget.classList.toggle('ac-counting',engine.state==='COUNTDOWN');
    el('ac-cancel-btn').textContent=arming?'Starting…':engine.inactive()?(engine.state==='DISABLED'||engine.state==='STOPPED'?'Start':'Resume'):engine.state==='COUNTDOWN'?'Cancel countdown':'Pause';
    const reasons={RESPONSE_CHANGED:'The response changed during the countdown. Review the chat before resuming.',SEND_NOT_ACKNOWLEDGED:'The last send was not confirmed. Check the chat before resuming.',DELIVERY_UNCERTAIN:'Connection was interrupted after sending. Check the chat before resuming.',NO_RESPONSE_TO_CONTINUE:'There is no assistant response yet. Send your first request, then press Start.',TUTORIAL_OPENED:'Quick tour opened. Resume after the tour when you are ready.',KEYBOARD_PAUSE:'Paused with the keyboard shortcut. Resume when you are ready.',HUMAN_CONTROL:'Paused while you interact with the chat. Resume when ready.',UNKNOWN:'Claude is showing a warning. Resolve it, then choose Resume.',UI_CHANGED:'Chat controls are unavailable. Open a chat and try Resume.',COMPLETION_UNCERTAIN:'Could not confirm the response finished. Check Claude’s reply and controls before resuming.',CONVERSATION_UNKNOWN:'Open an existing chat, then choose Start.',CONVERSATION_CHANGED:'You changed chats. Resume to enable this chat.',SETTINGS_CHANGED:'Settings saved. Resume when you are ready.',WINDOW_LOCK_UNAVAILABLE:'Window coordination is unavailable. Reopen the local app.',ANOTHER_WINDOW_ACTIVE:'Another window is running Auto Continue. Pause it first.',WINDOW_LOCK_FAILED:'Could not coordinate windows. Reopen the local app.',WAKE_REVALIDATION_REQUIRED:'Your Mac woke up. Check the chat, then Resume.',MAX_CONTINUATIONS:'Session continuation limit reached. Resume starts a new session.',MAX_RUNTIME:'Session time limit reached. Resume starts a new session.',DUPLICATE_RESPONSE_LOOP:'Repeated responses detected. Review the chat before resuming.',HUMAN_DRAFT:'Your message is still in the composer. Send or clear it first.'};
    const detail=engine.awaitingConfirmation?'The timer is finished. Approve this continuation to send, or Cancel countdown to pause.':engine.inactive()?(reasons[engine.lastReason]|| (engine.state==='DISABLED'?'Start continues this chat after the countdown, or waits while Claude is working.':engine.state==='STOPPED'?'Automation stopped. Start when you are ready.':`Needs attention: ${(engine.lastReason||engine.lastError||'unknown').toLowerCase().replaceAll('_',' ')}.`)):engine.state==='GENERATING'?'Claude is working. The next continuation waits until the response finishes.':engine.state==='WAITING_FOR_USAGE_RESET'?`No messages will be sent. Next check: ${engine.nextCheck?new Date(engine.nextCheck).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'pending'}.`:engine.verifyingInterrupted?'The previous reply may have been interrupted. Verifying 10 seconds of idle chat before continuing.':engine.state==='IDLE'?'Checking the latest response before starting the countdown.':engine.state==='COUNTDOWN'?(engine.sendBasis==='complete'?'You can cancel before the next message is sent.':'Resuming the interrupted task. You can cancel before the next message is sent.'):'Monitoring this chat. You can pause at any time.';
    if(el('ac-detail').textContent!==detail)el('ac-detail').textContent=detail;
    el('ac-summary').textContent=`${engine.stats.count} / ${engine.options.maxConsecutive==='unlimited'?'∞':engine.options.maxConsecutive} continuations`;
    el('ac-runtime').textContent=`${engine.stats.start?Math.floor((Date.now()-engine.stats.start)/60000):0} min elapsed`;
    el('ac-confirm-btn').hidden=!engine.awaitingConfirmation;
    el('ac-monitor').style.display=settings.paranoid?'block':'none';
    let clock='No send scheduled',note='The next send time is unknown while Claude is working.',progress=0;
    const target=engine.state==='COUNTDOWN'?engine.deadline:['WAITING_FOR_USAGE_RESET','NETWORK_ERROR'].includes(engine.state)?engine.nextCheck:null;
    if(engine.awaitingConfirmation){clock='Awaiting approval';note='No message will be sent until you approve it.';progress=100;}
    else if(target){const remaining=Math.max(0,target-Date.now()),tenths=Math.ceil(remaining/100);clock=`${String(Math.floor(tenths/600)).padStart(2,'0')}:${(tenths%600/10).toFixed(1).padStart(4,'0')}`;note=`${engine.state==='COUNTDOWN'?'Earliest send':'Next passive check'}: ${new Date(target).toLocaleTimeString()}. Final checks still apply.`;progress=engine.state==='COUNTDOWN'?Math.min(100,Math.max(0,100*(Date.now()-engine.countdownStarted)/(engine.deadline-engine.countdownStarted))):0;}
    else if(engine.inactive()){note='Automation is off. Nothing is queued.';}
    else if(engine.verifyingInterrupted){clock='Verifying idle chat';note='An interrupted reply need not have a finished toolbar. Checking stability before scheduling.';}
    else if(engine.state==='WAITING_FOR_GENERATION'){clock='Already submitted';note='Waiting for acknowledgment. There is no second send queued.';}
    el('ac-clock').classList.toggle('ac-clock-label',!target||engine.awaitingConfirmation);
    if(el('ac-clock').textContent!==clock)el('ac-clock').textContent=clock;
    if(el('ac-clock-note').textContent!==note)el('ac-clock-note').textContent=note;
    el('ac-progress-fill').style.width=progress+'%';
    const rows=logs.filter(x=>x.event==='state').slice(-5).reverse();
    const signature=rows.map(x=>x.time+x.to+x.reason).join('|');
    if(el('ac-history').dataset.signature!==signature){el('ac-history').dataset.signature=signature;el('ac-history').replaceChildren(...rows.map(row=>{const li=document.createElement('li');li.textContent=`${new Date(row.time).toLocaleTimeString()} · ${labels[row.to]||row.to.toLowerCase().replaceAll('_',' ')}${row.reason?' · '+row.reason.toLowerCase().replaceAll('_',' '):''}`;return li;}));}
    const meta=window.__CLAUDE_AC_META||{};
    const stats=`Auto Continue ${VERSION}\nClaude ${meta.claudeVersion||'unknown'} · Loader ${meta.loaderVersion||'unknown'}\nCompatibility: ${meta.compatibility||'unverified'}\nRuntime: ${engine.stats.start?Math.floor((Date.now()-engine.stats.start)/60000):0} min\nContinues: ${engine.stats.count} · Failures: ${engine.stats.failures}\nUsage waits: ${engine.stats.usageWaits}\nLast continuation: ${engine.stats.lastContinuation?new Date(engine.stats.lastContinuation).toLocaleTimeString():'—'}\nNext check: ${engine.nextCheck?new Date(engine.nextCheck).toLocaleTimeString():'—'}\nLast error: ${engine.lastError||'—'}`;
    if(el('ac-stats').textContent!==stats)el('ac-stats').textContent=stats;
    const bounds=container.getBoundingClientRect(),size=`${bounds.width}:${bounds.height}`;if(size!==lastSize){lastSize=size;clamp();}
  }
  function settingsChanged(){cancel('PAUSED','SETTINGS_CHANGED');engine.options=engineOptions();save();}
  el('ac-phrase-input').value=settings.phrase;el('ac-project').value=settings.project;el('ac-delay-input').value=settings.delaySeconds;
  for(const name of Object.keys(PRESETS)){const option=document.createElement('option');option.textContent=name;el('ac-preset').appendChild(option);}
  el('ac-preset').value=Object.entries(PRESETS).find(([,text])=>text===settings.phrase)?.[0]||'Custom';
  for(const [id,values,current] of [['ac-max',[10,25,50,100,'unlimited'],settings.maxConsecutive],['ac-hours',[1,3,6,12,24,'unlimited'],settings.maxHours]]){
    for(const v of [...new Set([...values,current])]){const o=document.createElement('option');o.value=v;o.textContent=v==='unlimited'?'Unlimited':id==='ac-hours'?`${v} ${v===1?'hour':'hours'}`:String(v);el(id).appendChild(o);}el(id).value=current;
  }
  for(const theme of Object.keys(THEMES)){const option=document.createElement('option');option.value=theme;option.textContent=theme;el('ac-theme').appendChild(option);}
  el('ac-theme').value=settings.theme;
  for(const [id,key] of [['ac-paranoid','paranoid'],['ac-compact','compact'],['ac-confirm','confirmBeforeSend'],['ac-one-shot','oneShot']])el(id).checked=settings[key];
  el('ac-poll').value=settings.pollMinutes.join(', ');el('ac-awake').checked=settings.keepAwake;el('ac-debug').checked=settings.debug;
  on(el('ac-theme'),'change',()=>{settings.theme=Object.hasOwn(THEMES,el('ac-theme').value)?el('ac-theme').value:'Terracotta';applyAppearance();save();});
  for(const [id,key] of [['ac-paranoid','paranoid'],['ac-compact','compact']])on(el(id),'change',()=>{settings[key]=el(id).checked;applyAppearance();save();render();clamp();});
  for(const [id,key] of [['ac-confirm','confirmBeforeSend'],['ac-one-shot','oneShot']])on(el(id),'change',()=>{settings[key]=el(id).checked;settingsChanged();});
  on(el('ac-confirm-btn'),'click',()=>{if(engine.confirm())tick();});
  on(el('ac-position-reset'),'click',()=>{settings.position=null;container.style.left=`${Math.max(8,innerWidth-324)}px`;container.style.top='80px';clamp();save();});
  on(check,'change' ,()=>check.checked?arm():cancel('DISABLED','USER_DISABLED'));
  on(el('ac-cancel-btn'),'click',()=>engine.inactive()?arm():cancel());on(el('ac-stop-btn'),'click',()=>cancel('STOPPED','USER_STOPPED'));
  on(el('ac-settings-btn'),'click',()=>{el('ac-panel').classList.toggle('open');widget.classList.toggle('ac-expanded',el('ac-panel').classList.contains('open'));el('ac-settings-btn').setAttribute('aria-expanded',String(el('ac-panel').classList.contains('open')));clamp();});
  on(el('ac-settings-close'),'click',()=>{el('ac-panel').classList.remove('open');el('ac-settings-btn').setAttribute('aria-expanded','false');});
  on(el('ac-preset'),'change',()=>{if(PRESETS[el('ac-preset').value]){settings.phrase=PRESETS[el('ac-preset').value];el('ac-phrase-input').value=settings.phrase;settingsChanged();}});
  for(const [id,key] of [['ac-phrase-input','phrase'],['ac-project','project']])on(el(id),'input',()=>{settings[key]=el(id).value;settingsChanged();});
  for(const [id,key] of [['ac-delay-input','delaySeconds'],['ac-max','maxConsecutive'],['ac-hours','maxHours']])on(el(id),'change',()=>{settings={...settings,...config({...settings,[key]:el(id).value})};settingsChanged();el(id).value=settings[key];});
  on(el('ac-poll'),'change',()=>{settings.pollMinutes=config({pollMinutes:el('ac-poll').value.split(',').map(x=>Number(x.trim()))}).pollMinutes;el('ac-poll').value=settings.pollMinutes.join(', ');settingsChanged();});
  for(const [id,key] of [['ac-awake','keepAwake'],['ac-debug','debug']])on(el(id),'change',()=>{settings[key]=el(id).checked;save();pulse();});
  const tour=[
    ['Welcome to Claude Continue','A small helper for keeping a task moving. You stay in control, and automation starts off.'],
    ['Start in an existing chat','Send your first request normally. Then press Start: finished replies get a cancellable countdown; active replies are monitored until they finish.'],
    ['Pause whenever you need','Pause or Stop cancels pending automation. Typing, changing chats, and editing continuation settings also pause it. Your own draft is preserved.'],
    ['Make it feel right','Choose a color scheme, turn on Paranoid mode for a precise countdown, or ask for approval before each send. Usage limits suspend sending.'],
    ['You’re ready','Open Settings for your prompt and session limits. This tour will not open automatically again; Quick tour in Settings lets you replay it.']
  ];
  function renderTour(){el('ac-tour-step').textContent=`Quick tour · ${tourStep+1} / ${tour.length}`;el('ac-tour-title').textContent=tour[tourStep][0];el('ac-tour-text').textContent=tour[tourStep][1];el('ac-tour-next').textContent=tourStep===tour.length-1?'Got it':'Next';}
  function showTour(){if(!engine.inactive())cancel('PAUSED','TUTORIAL_OPENED');tourReturnFocus=document.activeElement;tourStep=0;renderTour();el('ac-tour').hidden=false;el('ac-tour-next').focus();}
  function markTourSeen(){window.__CLAUDE_CONTINUE_TOUR_SEEN=true;try{localStorage.setItem(TOUR_KEY,'true');}catch{log({event:'storage-unavailable'});}}
  function dismissTour(){el('ac-tour').hidden=true;markTourSeen();if(tourReturnFocus?.isConnected)tourReturnFocus.focus();else el('ac-cancel-btn').focus();}
  on(el('ac-tour-next'),'click',()=>{if(tourStep===tour.length-1)dismissTour();else{tourStep++;renderTour();}});
  on(el('ac-tour-skip'),'click',dismissTour);on(el('ac-help-btn'),'click',showTour);
  on(document,'keydown',event=>{if(!el('ac-tour').hidden){if(event.key==='Escape'){event.preventDefault();dismissTour();}else if(event.key==='Tab'){event.preventDefault();(document.activeElement===el('ac-tour-next')?el('ac-tour-skip'):el('ac-tour-next')).focus();}}else if(event.altKey&&event.shiftKey&&event.code==='KeyP'&&!engine.inactive()){event.preventDefault();cancel('PAUSED','KEYBOARD_PAUSE');}},true);
  on(window,'storage',event=>{if(event.key===TOUR_KEY&&event.newValue==='true'&&!el('ac-tour').hidden){el('ac-tour').hidden=true;el('ac-cancel-btn').focus();}});
  on(el('ac-logs'),'click' ,()=>emit({event:'open-logs'}));
  function human(event){
    if(writing||engine.inactive()||container.contains(event.target))return;
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    if(target.closest(SELECTORS.composer)||target.closest(SELECTORS.stop)||target.closest(SELECTORS.send)||target.closest('button, a[href], [role="button"]'))cancel('PAUSED','HUMAN_CONTROL');
  }
  for(const event of ['beforeinput','input','paste','drop','keydown','pointerdown'])on(document,event,human,true);
  on(document,'click',event=>{if(event.isTrusted)human(event);},true);
  on(window,'popstate',()=>cancel('PAUSED','CONVERSATION_CHANGED'));
  on(window,'hashchange',()=>cancel('PAUSED','CONVERSATION_CHANGED'));
  function clamp(){const r=container.getBoundingClientRect();container.style.left=`${Math.max(8,Math.min(innerWidth-Math.min(r.width,innerWidth-16)-8,r.left))}px`;container.style.top=`${Math.max(48,Math.min(innerHeight-r.height-8,r.top))}px`;container.style.right='auto';container.style.bottom='auto';const panel=el('ac-panel');const w=Math.min(340,innerWidth-16),h=panel.getBoundingClientRect().height;const x=r.right+12+w<=innerWidth-8?r.right+12:r.left-w-12>=8?r.left-w-12:Math.max(8,Math.min(innerWidth-w-8,r.left));panel.style.left=`${x}px`;panel.style.top=`${Math.max(48,Math.min(innerHeight-h-8,r.top))}px`;}

  on(el('ac-drag-handle'),'pointerdown',e=>{if(e.button!==0)return;const r=container.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};e.preventDefault();});
  on(document,'pointermove',e=>{if(!drag)return;container.style.left=`${drag.left+e.clientX-drag.x}px`;container.style.top=`${drag.top+e.clientY-drag.y}px`;clamp();});
  on(document,'pointerup',()=>{if(!drag)return;drag=null;const r=container.getBoundingClientRect();settings.position={left:r.left,top:r.top};save();});
  on(window,'resize',clamp);
  let queued=false;
  const observer=new MutationObserver(mutations=>{
    if(engine.inactive()||mutations.every(m=>container.contains(m.target)))return;
    if(queued)return;queued=true;queueMicrotask(()=>{queued=false;tick();});
  });
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-disabled','aria-label','data-is-streaming']});
  const timer=setInterval(tick,500);
  const displayTimer=setInterval(()=>{if(settings.paranoid&&!disposed)render();},100);
  function dispose(){if(disposed)return;cancel('STOPPED','DISPOSED');disposed=true;observer.disconnect();clearInterval(timer);clearInterval(displayTimer);listeners.forEach(f=>f());container.remove();delete window.claudeAutoContinue;}
  on(window,'pagehide',dispose);
  window.claudeAutoContinue={version:VERSION,resume:arm,resumeOnce:()=>arm(true),pause:()=>cancel(),stop:()=>cancel('STOPPED'),dispose,diagnostics:()=>({version:VERSION,tutorialVisible:!el('ac-tour').hidden,theme:settings.theme,paranoid:settings.paranoid,awaitingConfirmation:engine.awaitingConfirmation,state:engine.state,reason:engine.lastReason||null,widgets:document.querySelectorAll('#'+ID).length,composer:!!unique(SELECTORS.composer),send:!!sendControl(),stats:{...engine.stats},signals:(()=>{const s=snapshot();return {generating:s.generating,completed:s.completed,error:s.error,hasResponse:!!s.hash,hasUserTurn:s.hasUserTurn,ready:s.ready,humanDraft:s.humanDraft,resumable:continuationAllowed(s,'explicit-start')&&(!!s.hash||s.hasUserTurn)};})()})};
  applyAppearance();clamp();render();pulse();log({event:'initialized',version:VERSION});
  let seen=window.__CLAUDE_CONTINUE_TOUR_SEEN===true;try{seen=seen||localStorage.getItem(TOUR_KEY)==='true';}catch{}
  if(!seen){showTour();markTourSeen();pulse();}
})();
