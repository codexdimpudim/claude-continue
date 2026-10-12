const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../macos/loader.cjs'),'utf8');
function fixture(){
  const files=new Map(),app=new EventEmitter();app.getVersion=()=> '2.31226.1';app.whenReady=()=>Promise.resolve();
  let started=0,stopped=0,opened=0,watch,now=100000;
  class Clock extends Date {static now(){return now;}}
  const fsMock={mkdirSync(){},existsSync:p=>files.has(p),statSync:p=>({size:(files.get(p)||'').length}),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);},appendFileSync:(p,s)=>files.set(p,(files.get(p)||'')+s),writeFileSync:(p,s)=>files.set(p,s),unlinkSync:p=>files.delete(p),readFileSync:p=>p.endsWith('manifest.json')?JSON.stringify({claudeVersion:'2.31226.1'}):'// code'};
  const electron={app,webContents:{getAllWebContents:()=>[]},powerSaveBlocker:{start:()=>++started,stop:()=>stopped++},shell:{openPath:()=>opened++}};
  vm.runInNewContext(source,{require:n=>n==='electron'?electron:n==='node:fs'?fsMock:n==='node:os'?{homedir:()=>'/test',release:()=> 'test'}:require(n),__dirname:'/runtime/macos',process:{pid:123},setInterval:f=>{watch=f;return {unref(){}};},clearInterval(){},module:{exports:{}},URL,console,Date:Clock});
  const c=new EventEmitter();c.id=5;c.getURL=()=> 'https://claude.ai/chat/test';c.isDestroyed=()=>false;c.executeJavaScript=async()=>({widgets:1,composer:true,send:true,state:'DISABLED'});
  c.throttled=true;c.getBackgroundThrottling=()=>c.throttled;c.setBackgroundThrottling=v=>{c.throttled=v;};
  app.emit('web-contents-created',{},c);
  function emit(data){c.emit('console-message',{message:'[ClaudeAutoContinue] '+JSON.stringify(data)});}
  return {app,c,files,emit,watch,advance(ms){now+=ms;watch();},get started(){return started;},get stopped(){return stopped;},get opened(){return opened;}};
}
test('keep-awake assertion released when paused and renderer destroyed',()=>{const f=fixture();f.emit({event:'heartbeat',active:true,keepAwake:true});assert.equal(f.started,1);f.emit({event:'heartbeat',active:false,keepAwake:true});assert.equal(f.stopped,1);f.emit({event:'heartbeat',active:true,keepAwake:true});f.c.emit('destroyed');assert.equal(f.stopped,2);});
test('logs whitelist metadata and exclude private fields',()=>{const f=fixture();f.emit({event:'state',from:'IDLE',to:'GENERATING',reason:'SAFE',prompt:'PRIVATE PROJECT',url:'https://claude.ai/chat/secret'});f.emit({event:'debug',error:'PRIVATE TEXT',composer:true});const logs=f.files.get('/test/Library/Logs/ClaudeAutoContinue/auto-continue.log');assert(logs.includes('GENERATING'));assert(!logs.includes('PRIVATE'));assert(!logs.includes('/chat/'));});
test('non-Claude origins cannot request power or open logs',()=>{const f=fixture();f.c.getURL=()=> 'https://claude.ai.evil.example/';f.emit({event:'heartbeat',active:true,keepAwake:true});f.emit({event:'open-logs'});assert.equal(f.started,0);assert.equal(f.opened,0);});
test('navigation releases assertion',()=>{const f=fixture();f.emit({event:'heartbeat',active:true,keepAwake:true});f.c.emit('did-start-navigation',{},'https://claude.ai/chat/other',true,true);assert.equal(f.stopped,1);});
test('quit releases assertion',()=>{const f=fixture();f.emit({event:'heartbeat',active:true,keepAwake:true});f.app.emit('before-quit');assert.equal(f.stopped,1);});

test('a heartbeat restores renderer health after an in-place navigation',()=>{const f=fixture();f.c.emit('did-start-navigation',{},'https://claude.ai/chat/other',true,true);f.emit({event:'heartbeat',active:false,keepAwake:false,state:'PAUSED',widgets:1,composer:true,send:true});f.watch();const status=JSON.parse(f.files.get('/runtime/status.json'));assert.equal(status.renderers.length,1);assert.equal(status.renderers[0].state,'PAUSED');assert.equal(status.renderers[0].composer,true);});

test('active sessions keep renderer timers unthrottled even without keep-awake',()=>{const f=fixture();f.emit({event:'heartbeat',active:true,keepAwake:false});assert.equal(f.c.throttled,false);assert.equal(f.started,0);f.emit({event:'heartbeat',active:false,keepAwake:false});assert.equal(f.c.throttled,true);});
test('a stale heartbeat restores timers and power, with room for a throttled 60s timer',()=>{const f=fixture();f.emit({event:'heartbeat',active:true,keepAwake:true});f.advance(61000);assert.equal(f.stopped,0);assert.equal(f.c.throttled,false);f.advance(60000);assert.equal(f.stopped,1);assert.equal(f.c.throttled,true);});
test('navigation and quit restore the original renderer throttle setting',()=>{const f=fixture();f.emit({event:'heartbeat',active:true});f.c.emit('did-start-navigation',{},'',true,true);assert.equal(f.c.throttled,true);f.c.throttled=false;f.emit({event:'heartbeat',active:true});f.app.emit('before-quit');assert.equal(f.c.throttled,false);});
