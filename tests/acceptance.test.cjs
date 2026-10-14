// Cross-component acceptance cases: use the canonical engine/renderer with
// realistic turn replacement and controlled time; never contact Claude.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const FakeTimers=require('@sinonjs/fake-timers');
const engineSource=fs.readFileSync(path.join(__dirname,'../lib/engine.js'),'utf8');
const rendererSource=fs.readFileSync(path.join(__dirname,'../lib/renderer.js'),'utf8');
async function session(settings={}){
  const dom=new JSDOM('<main><section data-message-author-role="user">Initial task</section><article data-message-author-role="assistant"><div data-testid="assistant-message">Initial completed answer</div><button aria-label="Copy response">Copy</button></article><textarea placeholder="Reply"></textarea><button aria-label="Send message">Send</button></main>',{url:'https://claude.ai/chat/acceptance-chat',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
  const w=dom.window,d=w.document;
  w.Element.prototype.getClientRects=function(){return [{width:100,height:50}];};
  w.Element.prototype.getBoundingClientRect=function(){return {left:20,top:80,width:300,height:250,right:320,bottom:330};};
  Object.defineProperty(w.navigator,'locks',{value:{request:async(_name,_options,callback)=>callback({name:'owner'})}});
  w.localStorage.setItem('claude_continue_onboarding_seen','true');
  w.localStorage.setItem('claude_auto_continue_settings',JSON.stringify({delaySeconds:1,maxConsecutive:'unlimited',maxHours:'unlimited',...settings}));
  const clock=FakeTimers.withGlobal(w).install({now:100000,toFake:['Date','setTimeout','clearTimeout','setInterval','clearInterval']});
  let sends=0;
  function begin(){if(d.querySelector('[aria-label="Stop response"]'))return;const stop=d.createElement('button');stop.setAttribute('aria-label','Stop response');d.querySelector('main').appendChild(stop);}
  d.querySelector('[aria-label="Send message"]').addEventListener('click',()=>{sends++;d.querySelector('textarea').value='';const user=d.createElement('section');user.setAttribute('data-message-author-role','user');user.textContent='Continuation '+sends;d.querySelector('main').appendChild(user);begin();});
  async function advance(ms){await clock.tickAsync(ms);await Promise.resolve();}
  async function finish(i){d.querySelector('[aria-label="Stop response"]')?.remove();const article=d.createElement('article');article.setAttribute('data-message-author-role','assistant');article.innerHTML='<div data-testid="assistant-message">Completed turn '+i+'</div><button aria-label="Copy response">Copy</button>';d.querySelector('main').appendChild(article);await advance(9000);}
  w.eval(engineSource);w.eval(rendererSource);
  function start(){d.getElementById('ac-cancel-btn').click();}
  async function close(){w.claudeAutoContinue?.dispose();clock.uninstall();dom.window.close();}
  return {w,d,start,begin,advance,finish,close,get sends(){return sends;}};
}
test('a long simulated chat continues through twelve acknowledged turns and stops at its cap',async()=>{const f=await session({maxConsecutive:12});try{f.start();await f.advance(6000);assert.equal(f.sends,1);for(let i=1;i<=12;i++){await f.finish(i);assert.equal(f.sends,Math.min(12,i+1));}const state=f.w.claudeAutoContinue.diagnostics();assert.equal(state.state,'PAUSED');assert.equal(state.reason,'MAX_CONTINUATIONS');assert.equal(state.stats.count,12);}finally{await f.close();}});
test('a repeated-turn session survives a quota interruption with no completed response marker',async()=>{const f=await session();try{f.start();await f.advance(6000);await f.finish(1);assert.equal(f.sends,2);f.d.querySelector('[aria-label="Stop response"]').remove();const partial=f.d.createElement('article');partial.setAttribute('data-message-author-role','assistant');partial.innerHTML='<div data-testid="assistant-message">A quota-interrupted partial result</div>';f.d.querySelector('main').appendChild(partial);const banner=f.d.createElement('div');banner.setAttribute('data-testid','usage-limit-banner');banner.setAttribute('role','status');banner.textContent='Usage limit reached';f.d.querySelector('main').appendChild(banner);await f.advance(1000);assert.equal(f.w.claudeAutoContinue.diagnostics().state,'WAITING_FOR_USAGE_RESET');assert.equal(f.sends,2);banner.remove();await f.advance(145000);assert.equal(f.sends,3);assert.equal(f.w.claudeAutoContinue.diagnostics().state,'GENERATING');await f.finish(3);assert.equal(f.sends,4);}finally{await f.close();}});
test('new human text in a running chat prevents all further sends despite later completed turns',async()=>{const f=await session();try{f.start();await f.advance(6000);await f.finish(1);assert.equal(f.sends,2);const input=f.d.querySelector('textarea');input.value='My own follow-up';input.dispatchEvent(new f.w.Event('input',{bubbles:true}));await f.finish(2);await f.advance(20000);assert.equal(f.sends,2);assert.equal(input.value,'My own follow-up');assert.equal(f.w.claudeAutoContinue.diagnostics().state,'PAUSED');}finally{await f.close();}});
