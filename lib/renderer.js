// Auto Continue: explicit controls, contextual warnings, and a draggable status card.
(function() {
  'use strict';
  const ID='claude-auto-continue-plugin', KEY='claude_auto_continue_settings';
  if(window.claudeAutoContinue||document.getElementById(ID)||!document.body)return;
  const {Engine,config,classify}=window.ClaudeAutoContinueEngine;
  const VERSION='2.1.0-mac-preview';
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
    buttons:'button', completion:'button[aria-label="Copy" i],button[aria-label="Copy response" i],button[data-testid="copy-response-button"]'
  });
  let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{}
  let settings={...config(saved),phrase:typeof saved.phrase==='string'&&saved.phrase!=='Continue'?saved.phrase:PRESETS.Default,
    project:typeof saved.project==='string'?saved.project:'',position:saved.position,keepAwake:saved.keepAwake===true,debug:saved.debug===true};
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
    </style>
    <div class="ac-container" id="ac-container">
      <div class="ac-header"><div class="ac-icon-handle" id="ac-drag-handle" title="Drag to move"><span class="ac-mark" aria-hidden="true">↻</span>Claude Continue</div><button id="ac-settings-btn" aria-expanded="false" aria-controls="ac-panel">Settings</button></div>
      <label class="ac-toggle-label"><input type="checkbox" id="ac-enabled-check" aria-label="Enable Auto Continue" tabindex="-1"></label>
      <div class="ac-status-line"><span class="ac-dot" aria-hidden="true"></span><span id="ac-state" role="status">Ready when you are</span></div>
      <div id="ac-detail" aria-live="polite"></div>
      <div class="ac-actions"><button id="ac-cancel-btn">Start</button><button id="ac-stop-btn" title="Stop automatic continuations">Stop</button></div>
      <div class="ac-footer"><span id="ac-summary">0 continuations</span><span id="ac-runtime">0 min active</span></div>
    </div>
    <section class="ac-panel" id="ac-panel" aria-label="Auto Continue settings"><div class="ac-header"><strong style="flex:1">Settings</strong><button id="ac-settings-close" aria-label="Close settings">Done</button></div>
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
      <pre id="ac-stats"></pre>
      <small>Enable explicitly after each launch or chat change. Use Resume after adjusting settings.</small>
    </section>`;
  document.body.appendChild(container);
  const el=id=>container.querySelector('#'+id), widget=el('ac-container'),check=el('ac-enabled-check');
  const listeners=[];const on=(target,event,handler,opts)=>{target.addEventListener(event,handler,opts);listeners.push(()=>target.removeEventListener(event,handler,opts));};
  const logs=[];
  function emit(data){console.info('[ClaudeAutoContinue] '+JSON.stringify(data));}
  function log(data){const row={time:new Date().toISOString(),...data};logs.push(row);if(logs.length>250)logs.shift();emit(row);}
  const engine=new Engine(settings,log);
  let disposed=false,ownedDraft=null,writing=false,releaseLock=null,arming=false,armRequest=0,pending=null,lastPulse=0,lastTick=Date.now(),drag=null;
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
    // Toolbars can be siblings of the response body. Stop at another assistant
    // response so an older turn's Copy button can never complete the latest turn.
    let area=response?.closest('[data-message-author-role="assistant"]')||response?.closest('[data-testid="assistant-message"]')||response?.parentElement;
    const completionControls=node=>all(SELECTORS.completion,node).filter(b=>!b.closest('pre,code,[data-testid="code-block"]')&&(b.getAttribute('aria-label')?.toLowerCase()!=='copy'||!response.contains(b)));
    if(response&&!area?.matches('[data-message-author-role="assistant"], [data-testid="assistant-message"]')){
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
    const controlsAmbiguous=all(SELECTORS.stop).length>1||all(SELECTORS.send).length>1;
    return {conversation:conversation(),composer,send,direct:direct.length===1?direct[0]:null,
      generating:!!stop,ready:!!composer&&usable(composer)&&!!send&&!controlsAmbiguous,
      completed,hash:fingerprint(response?.textContent||''),error:error.kind,resetText:error.resetText,
      humanDraft:!!text.trim()&&!(ownedDraft&&ownedDraft.node===composer&&ownedDraft.text===text),warnings: warnings.length};
  }
  function clearOwned(){if(!ownedDraft)return;const draft=ownedDraft;ownedDraft=null;if(value(draft.node)===draft.text){try{writing=true;setValue(draft.node,'');}catch{log({event:'draft-cleanup-failed'});}finally{writing=false;}}}
  function cancel(state='PAUSED',reason='HUMAN_CONTROL'){
    armRequest++;arming=false;engine.cancel(state,reason);if(pending){clearTimeout(pending);pending=null;}clearOwned();
    if(releaseLock){releaseLock();releaseLock=null;}check.checked=false;render();pulse();
  }
  async function arm(){
    if(arming)return;
    const request=++armRequest;arming=true;render();
    if(!navigator.locks){arming=false;cancel('PAUSED','WINDOW_LOCK_UNAVAILABLE');return;}
    try {await navigator.locks.request('claude-auto-continue-owner',{ifAvailable:true},async lock=>{
      if(request!==armRequest||disposed)return;
      arming=false;
      if(!lock){cancel('PAUSED','ANOTHER_WINDOW_ACTIVE');return;}
      engine.options=config(settings);engine.arm(conversation());check.checked=!engine.inactive();
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
  function valid(action,s){return !disposed&&releaseLock&&engine.state==='SENDING_CONTINUE'&&engine.epoch===action.epoch&&s.conversation===action.conversation&&!s.error&&!s.generating&&s.ready&&!s.humanDraft;}
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
      engine.sent(action.epoch);ownedDraft=null;s.send.click();render();
    },250);
  }
  function pulse(){emit({event:'heartbeat',active:!engine.inactive(),keepAwake:settings.keepAwake,state:engine.state,widgets:document.querySelectorAll('#'+ID).length,composer:!!unique(SELECTORS.composer),send:!!sendControl()});lastPulse=Date.now();}
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
    const status=engine.state==='PAUSED'&&engine.lastReason==='UI_CHANGED'?'Claude UI changed — paused':engine.state==='PAUSED'&&engine.lastReason==='DUPLICATE_RESPONSE_LOOP'?'Possible continuation loop — paused':engine.state==='COUNTDOWN'?`Continuing in ${Math.max(0,Math.ceil((engine.deadline-Date.now())/1000))}s`:labels[engine.state];
    if(el('ac-state').textContent!==status)el('ac-state').textContent=status;
    widget.classList.toggle('ac-active-glow',!engine.inactive());widget.classList.toggle('ac-counting',engine.state==='COUNTDOWN');
    el('ac-cancel-btn').textContent=arming?'Starting…':engine.inactive()?(engine.state==='DISABLED'||engine.state==='STOPPED'?'Start':'Resume'):engine.state==='COUNTDOWN'?'Cancel countdown':'Pause';
    const reasons={HUMAN_CONTROL:'Paused while you interact with the chat. Resume when ready.',UNKNOWN:'Claude is showing a warning. Resolve it, then choose Resume.',UI_CHANGED:'Chat controls are unavailable. Open a chat and try Resume.',COMPLETION_UNCERTAIN:'Could not confirm the response finished. Start a response, then Resume.',CONVERSATION_UNKNOWN:'Open an existing chat, then choose Start.',CONVERSATION_CHANGED:'You changed chats. Resume to enable this chat.',SETTINGS_CHANGED:'Settings saved. Resume when you are ready.',WINDOW_LOCK_UNAVAILABLE:'Window coordination is unavailable. Reopen the local app.',ANOTHER_WINDOW_ACTIVE:'Another window is running Auto Continue. Pause it first.',WINDOW_LOCK_FAILED:'Could not coordinate windows. Reopen the local app.',WAKE_REVALIDATION_REQUIRED:'Your Mac woke up. Check the chat, then Resume.',MAX_CONTINUATIONS:'Session continuation limit reached. Resume starts a new session.',MAX_RUNTIME:'Session time limit reached. Resume starts a new session.',DUPLICATE_RESPONSE_LOOP:'Repeated responses detected. Review the chat before resuming.',HUMAN_DRAFT:'Your message is still in the composer. Send or clear it first.'};
    const detail=engine.inactive()?(reasons[engine.lastReason]|| (engine.state==='DISABLED'?'Start during a response to continue automatically when Claude finishes.':engine.state==='STOPPED'?'Automation stopped. Start when you are ready.':`Needs attention: ${(engine.lastReason||engine.lastError||'unknown').toLowerCase().replaceAll('_',' ')}.`)):engine.state==='GENERATING'?'Claude is working. The next continuation waits until the response finishes.':engine.state==='WAITING_FOR_USAGE_RESET'?`No messages will be sent. Next check: ${engine.nextCheck?new Date(engine.nextCheck).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'pending'}.`:engine.state==='IDLE'?'Waiting for a new response. Start your request, then Resume while Claude works.':engine.state==='COUNTDOWN'?'You can cancel before the next message is sent.':'Monitoring this chat. You can pause at any time.';
    if(el('ac-detail').textContent!==detail)el('ac-detail').textContent=detail;
    el('ac-summary').textContent=`${engine.stats.count} / ${settings.maxConsecutive==='unlimited'?'∞':settings.maxConsecutive} continuations`;
    el('ac-runtime').textContent=`${engine.stats.start?Math.floor((Date.now()-engine.stats.start)/60000):0} min elapsed`;
    const meta=window.__CLAUDE_AC_META||{};
    const stats=`Auto Continue ${VERSION}\nClaude ${meta.claudeVersion||'unknown'} · Loader ${meta.loaderVersion||'unknown'}\nCompatibility: ${meta.compatibility||'unverified'}\nRuntime: ${engine.stats.start?Math.floor((Date.now()-engine.stats.start)/60000):0} min\nContinues: ${engine.stats.count} · Failures: ${engine.stats.failures}\nUsage waits: ${engine.stats.usageWaits}\nLast continuation: ${engine.stats.lastContinuation?new Date(engine.stats.lastContinuation).toLocaleTimeString():'—'}\nNext check: ${engine.nextCheck?new Date(engine.nextCheck).toLocaleTimeString():'—'}\nLast error: ${engine.lastError||'—'}`;
    if(el('ac-stats').textContent!==stats)el('ac-stats').textContent=stats;
  }
  function settingsChanged(){cancel('PAUSED','SETTINGS_CHANGED');engine.options=config(settings);save();}
  el('ac-phrase-input').value=settings.phrase;el('ac-project').value=settings.project;el('ac-delay-input').value=settings.delaySeconds;
  for(const name of Object.keys(PRESETS)){const option=document.createElement('option');option.textContent=name;el('ac-preset').appendChild(option);}
  el('ac-preset').value=Object.entries(PRESETS).find(([,text])=>text===settings.phrase)?.[0]||'Custom';
  for(const [id,values,current] of [['ac-max',[10,25,50,100,'unlimited'],settings.maxConsecutive],['ac-hours',[1,3,6,12,24,'unlimited'],settings.maxHours]]){
    for(const v of [...new Set([...values,current])]){const o=document.createElement('option');o.value=v;o.textContent=v==='unlimited'?'Unlimited':id==='ac-hours'?`${v} ${v===1?'hour':'hours'}`:String(v);el(id).appendChild(o);}el(id).value=current;
  }
  el('ac-poll').value=settings.pollMinutes.join(', ');el('ac-awake').checked=settings.keepAwake;el('ac-debug').checked=settings.debug;
  on(check,'change',()=>check.checked?arm():cancel('DISABLED','USER_DISABLED'));
  on(el('ac-cancel-btn'),'click',()=>engine.inactive()?arm():cancel());on(el('ac-stop-btn'),'click',()=>cancel('STOPPED','USER_STOPPED'));
  on(el('ac-settings-btn'),'click',()=>{el('ac-panel').classList.toggle('open');widget.classList.toggle('ac-expanded',el('ac-panel').classList.contains('open'));el('ac-settings-btn').setAttribute('aria-expanded',String(el('ac-panel').classList.contains('open')));clamp();});
  on(el('ac-settings-close'),'click',()=>{el('ac-panel').classList.remove('open');el('ac-settings-btn').setAttribute('aria-expanded','false');});
  on(el('ac-preset'),'change',()=>{if(PRESETS[el('ac-preset').value]){settings.phrase=PRESETS[el('ac-preset').value];el('ac-phrase-input').value=settings.phrase;settingsChanged();}});
  for(const [id,key] of [['ac-phrase-input','phrase'],['ac-project','project']])on(el(id),'input',()=>{settings[key]=el(id).value;settingsChanged();});
  for(const [id,key] of [['ac-delay-input','delaySeconds'],['ac-max','maxConsecutive'],['ac-hours','maxHours']])on(el(id),'change',()=>{settings={...settings,...config({...settings,[key]:el(id).value})};settingsChanged();el(id).value=settings[key];});
  on(el('ac-poll'),'change',()=>{settings.pollMinutes=config({pollMinutes:el('ac-poll').value.split(',').map(x=>Number(x.trim()))}).pollMinutes;el('ac-poll').value=settings.pollMinutes.join(', ');settingsChanged();});
  for(const [id,key] of [['ac-awake','keepAwake'],['ac-debug','debug']])on(el(id),'change',()=>{settings[key]=el(id).checked;save();pulse();});
  on(el('ac-logs'),'click',()=>emit({event:'open-logs'}));
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
  function dispose(){if(disposed)return;cancel('STOPPED','DISPOSED');disposed=true;observer.disconnect();clearInterval(timer);listeners.forEach(f=>f());container.remove();delete window.claudeAutoContinue;}
  on(window,'pagehide',dispose);
  window.claudeAutoContinue={version:VERSION,resume:arm,pause:()=>cancel(),stop:()=>cancel('STOPPED'),dispose,diagnostics:()=>({state:engine.state,reason:engine.lastReason||null,widgets:document.querySelectorAll('#'+ID).length,composer:!!unique(SELECTORS.composer),send:!!sendControl(),stats:{...engine.stats},signals:(()=>{const s=snapshot();return {generating:s.generating,completed:s.completed,error:s.error,hasResponse:!!s.hash};})()})};
  clamp();render();pulse();log({event:'initialized',version:VERSION});
})();
