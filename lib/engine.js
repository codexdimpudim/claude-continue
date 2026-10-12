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
    cancel(next='PAUSED',reason='HUMAN_CONTROL') {this.epoch++;this.deadline=null;this.nextCheck=null;this.awaitingConfirmation=false;this.lastReason=reason;this.transition(next,reason);}
    arm(conversation,now=Date.now(),continueExisting=false) {
      if(!conversation){this.cancel('PAUSED','CONVERSATION_UNKNOWN');return;}
      if(!['DISABLED','PAUSED','STOPPED','ERROR'].includes(this.state))this.cancel();
      this.epoch++;this.conversation=conversation;this.stats.start=now;this.stats.count=0;
      this.lastHash=null;this.repeats=0;this.emptyCount=0;this.lastError=null;this.nextCheck=null;
      this.resumeNeeded=false;this.kickoffRequested=continueExisting;this.quietSince=null;this.quietHash=null;this.lastReason=null;this.awaitingConfirmation=false;
      this.transition('IDLE','USER_ENABLED');
    }
    inactive(){return ['DISABLED','PAUSED','STOPPED','ERROR'].includes(this.state);}
    wait(kind,s,now) {
      if(!['RATE_LIMIT','NETWORK','SERVER'].includes(kind)){this.lastError=kind;this.cancel('PAUSED',kind);return;}
      if(kind!=='RATE_LIMIT'&&['SENDING_CONTINUE','WAITING_FOR_GENERATION'].includes(this.state)) {this.failed('DELIVERY_UNCERTAIN');return;}
      this.resumeNeeded=(this.kickoffRequested&&!!s.hash)||['GENERATING','FINISHED','COUNTDOWN','SENDING_CONTINUE','WAITING_FOR_GENERATION','RECOVERING'].includes(this.state)||this.resumeNeeded===true;
      this.epoch++;this.deadline=null;this.awaitingConfirmation=false;this.lastError=kind;this.verifyAt=null;
      if(kind==='RATE_LIMIT') {
        this.transition('RATE_LIMITED',kind);this.stats.usageWaits++;this.poll=0;
        this.reset=resetTime(s.resetText||'',now);this.transition('WAITING_FOR_USAGE_RESET','SENDS_SUSPENDED');
        this.nextCheck=this.reset?Math.max(now+120000,this.reset.timestamp+30000):now+this.options.pollMinutes[0]*60000;
      } else {this.transition('NETWORK_ERROR',kind);this.nextCheck=now+this.options.networkRetryMs;}
    }
    schedule(now,extra=0,hash=this.quietHash) {
      if(this.options.maxConsecutive!=='unlimited'&&this.stats.count>=this.options.maxConsecutive) return this.cancel('PAUSED','MAX_CONTINUATIONS');
      this.countdownStarted=now;this.scheduledHash=hash;this.awaitingConfirmation=false;this.confirmed=false;
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
        this.kickoffRequested=false;this.observedHash=s.hash;this.quietSince=null;return null;
      }
      if(!s.ready){this.cancel('PAUSED','UI_CHANGED');return null;}
      if(this.state==='IDLE'&&this.kickoffRequested){
        if(!s.hash){this.cancel('PAUSED','NO_RESPONSE_TO_CONTINUE');return null;}
        if(!s.completed){this.cancel('PAUSED','COMPLETION_UNCERTAIN');return null;}
        if(this.quietHash!==s.hash||this.quietSince==null){this.quietHash=s.hash;this.quietSince=now;return null;}
        if(now-this.quietSince<this.options.quietMs)return null;
        this.kickoffRequested=false;this.schedule(now,0,s.hash);return null;
      }
      if(this.state==='RECOVERING') {
        if(now<this.verifyAt)return null;
        this.nextCheck=null;this.lastError=null;
        if(this.resumeNeeded){this.resumeNeeded=false;this.kickoffRequested=false;this.schedule(now,0,s.hash);}else this.transition('IDLE','AVAILABILITY_VERIFIED');
        return null;
      }
      if(this.state==='GENERATING') {
        if(this.quietHash!==s.hash||this.quietSince==null){this.quietHash=s.hash;this.quietSince=now;return null;}
        if(now-this.quietSince<this.options.quietMs)return null;
        if(!s.completed){if(now-this.quietSince>15000)this.cancel('PAUSED','COMPLETION_UNCERTAIN');return null;}
        this.transition('FINISHED','STABLE_COMPLETION_CONFIRMED');this.stats.lastSuccess=now;
        if(!s.hash){this.emptyCount++;if(this.emptyCount>1){this.cancel('PAUSED','EMPTY_RESPONSE_LOOP');return null;}}else this.emptyCount=0;
        this.repeats=s.hash&&s.hash===this.lastHash?this.repeats+1:0;this.lastHash=s.hash;
        if(this.repeats>=2){this.cancel('PAUSED','DUPLICATE_RESPONSE_LOOP');return null;}
        this.schedule(now,this.emptyCount?30000:0);return null;
      }
      if(this.state==='COUNTDOWN'&&!s.completed){this.cancel('PAUSED','COMPLETION_UNCERTAIN');return null;}
      if(this.state==='COUNTDOWN'&&s.hash!==this.scheduledHash){this.cancel('PAUSED','RESPONSE_CHANGED');return null;}
      if(this.state==='COUNTDOWN'&&now>=this.deadline){
        if(this.options.confirmBeforeSend&&!this.confirmed&&!this.awaitingConfirmation){this.awaitingConfirmation=true;this.log({event:'confirmation-needed'});return null;}
        if(this.awaitingConfirmation)return null;
        this.transition('SENDING_CONTINUE','PREFLIGHT_PASSED');return {type:'send',epoch:this.epoch,conversation:this.conversation,hash:this.scheduledHash};}
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
  return {Engine,STATES,defaults,config,resetTime,classify};
});
