// macOS adapter for the upstream web-contents-created / executeJavaScript loader.
// Installs only Auto Continue; never loads the upstream version-spoof plugin.
const {app,powerSaveBlocker,shell,webContents,autoUpdater}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const logDir=path.join(os.homedir(),'Library/Logs/ClaudeAutoContinue');
try{fs.mkdirSync(logDir,{recursive:true,mode:0o700});}catch{}
const logPath=path.join(logDir,'auto-continue.log');
const statusPath=path.join(root,'status.json');
const STATES=['DISABLED','IDLE','GENERATING','FINISHED','COUNTDOWN','SENDING_CONTINUE','WAITING_FOR_GENERATION','RATE_LIMITED','WAITING_FOR_USAGE_RESET','CHECKING_AVAILABILITY','NETWORK_ERROR','RECOVERING','PAUSED','ERROR','STOPPED'];
let assertion=null,shuttingDown=false,powerFailed=false,failedReload=null,vendorUpdatesBlocked=false;
const health=new Map(),leases=new Map(),attached=new WeakSet(),throttling=new Map(),epochs=new WeakMap(),injecting=new WeakMap(),documents=new WeakMap();
function log(event,fields={}){
  try{
    if(fs.existsSync(logPath)&&fs.statSync(logPath).size>1024*1024){for(let i=2;i>=1;i--)if(fs.existsSync(logPath+'.'+i))fs.renameSync(logPath+'.'+i,logPath+'.'+(i+1));fs.renameSync(logPath,logPath+'.1');}
    fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),event,...fields})+'\n',{mode:0o600});
  }catch{}
}
function allowed(contents){try{const u=new URL(contents.getURL());return u.protocol==='https:'&&['claude.ai','www.claude.ai'].includes(u.hostname);}catch{return false;}}
function documentKey(url){try{const u=new URL(url);return u.origin+u.pathname;}catch{return null;}}
function release(){if(assertion!==null){const prior=assertion;assertion=null;try{powerSaveBlocker.stop(prior);log('power-released');}catch{log('power-release-failed');}}}
function restoreTimers(contents){
  const prior=throttling.get(contents.id);if(!prior)return;
  throttling.delete(contents.id);
  try{if(!contents.isDestroyed())contents.setBackgroundThrottling(prior.value);}catch{log('timer-restore-failed');}
}
function activeTimers(contents,active){
  if(!active){restoreTimers(contents);return;}
  if(throttling.has(contents.id))return;
  try{const value=contents.getBackgroundThrottling();contents.setBackgroundThrottling(false);throttling.set(contents.id,{contents,value});}catch{log('timer-control-unavailable');}
}
function drop(contents){epochs.set(contents,(epochs.get(contents)||0)+1);restoreTimers(contents);leases.delete(contents.id);health.delete(contents.id);updatePower();}
function restoreAllTimers(){for(const x of [...throttling.values()])restoreTimers(x.contents);}
function updatePower(){
  for(const [id,x] of leases)if(Date.now()-x.time>=120000){restoreTimers(x.contents);leases.delete(id);health.delete(id);}
  const active=[...leases.values()].some(x=>x.active&&x.keepAwake);
  if(active&&assertion===null){try{assertion=powerSaveBlocker.start('prevent-app-suspension');powerFailed=false;log('power-started');}catch{if(!powerFailed)log('power-unavailable');powerFailed=true;}}
  if(!active){release();powerFailed=false;}
}
function status(){try{fs.writeFileSync(statusPath,JSON.stringify({pid:process.pid,version:app.getVersion(),loaderVersion:'2.2.3',time:Date.now(),compatible,bundleReady:!!bundle,vendorUpdatesBlocked,powerAssertion:assertion!==null,renderers:[...health.values()]}),{mode:0o600});}catch{}}
function message(contents,args){
  if(shuttingDown||!compatible||!bundle||!allowed(contents))return;
  const detail=args[0];const message=typeof detail?.message==='string'?detail.message:args[1];
  if(typeof message!=='string'||!message.startsWith('[ClaudeAutoContinue] ')||message.length>1500)return;
  let data;try{data=JSON.parse(message.slice(20));}catch{return;}
  if(!data||typeof data!=='object'||Array.isArray(data))return;
  if(data.event==='heartbeat'){
    if(data.rendererVersion!==bundle.version){drop(contents);return;}
    activeTimers(contents,data.active===true);leases.set(contents.id,{contents,time:Date.now(),active:data.active===true,keepAwake:data.keepAwake===true});if(STATES.includes(data.state))health.set(contents.id,{widgets:data.widgets===1?1:0,composer:data.composer===true,send:data.send===true,home:data.home===true,state:data.state,rendererVersion:bundle.version,tutorialVisible:data.tutorialVisible===true});
    updatePower();return;
  }
  if(data.event==='open-logs'){try{Promise.resolve(shell.openPath(logDir)).catch(()=>log('open-logs-failed'));}catch{log('open-logs-failed');}return;}
  // Never persist arbitrary renderer text, URLs, prompts, or response hashes.
  const known=['state','initialized','storage-unavailable','draft-cleanup-failed','debug'];
  if(!known.includes(data.event))return;
  const fields={};
  for(const key of ['from','to','reason','error'])if(typeof data[key]==='string'&&/^[A-Z_]{1,64}$/.test(data[key]))fields[key]=data[key];
  for(const key of ['composer','send','generating','completed'])if(typeof data[key]==='boolean')fields[key]=data[key];
  log(data.event,fields);
}
function readBundle(){
  const engine=fs.readFileSync(path.join(root,'lib/engine.js'),'utf8'),renderer=fs.readFileSync(path.join(root,'lib/renderer.js'),'utf8'),plugin=fs.readFileSync(path.join(root,'plugins/auto-continue.js'),'utf8');
  const expected='// Bundled safety engine preserves compatibility with the original one-file loader.\nif (typeof window !== "undefined" && !window.ClaudeAutoContinueEngine) {\n'+engine+'\n}\n'+renderer;
  if(!engine.trim()||!renderer.trim()||plugin!==expected)throw new Error('Incomplete plugin sources');
  const version=renderer.match(/\bconst\s+VERSION\s*=\s*(['"])([0-9A-Za-z.-]{1,64})\1\s*;/)?.[2];
  if(!version)throw new Error('Renderer version missing');
  new vm.Script(engine);new vm.Script(plugin);
  return {engine,plugin,version};
}
let compatible=false,bundle=null;
try{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const expected=manifest.patchedHashes?.['Contents/Resources/app.asar'];
  compatible=manifest.marker==='claude-auto-continue-local-copy-v1'&&manifest.claudeVersion===app.getVersion()&&typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected)
    // Electron's patched fs treats ASAR as a directory; original-fs reads its actual bytes.
    &&crypto.createHash('sha256').update(require('original-fs').readFileSync(path.join(process.resourcesPath,'app.asar'))).digest('hex')===expected;
}catch{log('manifest-unavailable');}
// A vendor update replaces the entire copied app and erases its ASAR hook.
// The inspected build uses these native entry points. Block them before its
// code runs, only after verifying this managed copy's exact version/hash.
if(compatible){
  try{
    if(!autoUpdater)throw new Error('Native updater unavailable');
    for(const operation of ['setFeedURL','checkForUpdates','quitAndInstall']){
      const blocked=()=>{
        log('vendor-update-blocked',{operation});
        if(operation==='checkForUpdates')Promise.resolve().then(()=>autoUpdater.emit('update-not-available')).catch(()=>log('update-status-unavailable'));
      };
      Object.defineProperty(autoUpdater,operation,{value:blocked,writable:false,configurable:false});
    }
    vendorUpdatesBlocked=true;log('vendor-updates-pinned');
  }catch{compatible=false;log('vendor-update-guard-unavailable');}
}
try{bundle=readBundle();}catch{log('plugin-source-unavailable');}
async function injectPluginsIntoContents(contents){
  if(shuttingDown||contents.isDestroyed()||!allowed(contents)||!compatible||!bundle)return false;
  const epoch=epochs.get(contents)||0,prior=injecting.get(contents);
  if(prior?.epoch===epoch)return prior.promise;
  const current=()=>!shuttingDown&&!contents.isDestroyed()&&allowed(contents)&&(epochs.get(contents)||0)===epoch;
  const selected=bundle;
  const promise=(async()=>{
  try{
    const meta={claudeVersion:app.getVersion(),loaderVersion:'2.2.3',compatibility:'Beta; sustained live automation still being validated'};
    // A navigation can finish while executeJavaScript is queued. Check the actual document too.
    await contents.executeJavaScript(`if(location.protocol==='https:'&&['claude.ai','www.claude.ai'].includes(location.hostname)){window.__CLAUDE_AC_META=${JSON.stringify(meta)};\n${selected.engine}\n${selected.plugin}\n}`);
    if(!current())return false;
    const report=await contents.executeJavaScript('window.claudeAutoContinue?.diagnostics()');
    if(!current())return false;
    const valid=report?.version===selected.version&&STATES.includes(report?.state);
    if(valid)health.set(contents.id,{widgets:report.widgets===1?1:0,composer:report.composer===true,send:report.send===true,home:report.home===true,state:report.state,rendererVersion:selected.version,tutorialVisible:report.tutorialVisible===true});
    else health.delete(contents.id);
    log('injection',{widgets:report?.widgets===1?1:0,composer:report?.composer===true,send:report?.send===true,generating:report?.signals?.generating===true,completed:report?.signals?.completed===true,resumable:report?.signals?.resumable===true,hasResponse:report?.signals?.hasResponse===true,hasUserTurn:report?.signals?.hasUserTurn===true,ready:report?.signals?.ready===true,error:['RATE_LIMIT','NETWORK','SERVER','UNKNOWN','HUMAN_APPROVAL_REQUIRED'].includes(report?.signals?.error)?report.signals.error:'NONE',humanDraft:report?.signals?.humanDraft===true,directControl:report?.signals?.directControl===true,directInsideResponse:report?.signals?.directInsideResponse===true});status();
    return valid&&report.widgets===1;
  }catch{if(current())log('injection-failed');return false;}
  })();
  injecting.set(contents,{epoch,promise});
  try{return await promise;}finally{if(injecting.get(contents)?.promise===promise)injecting.delete(contents);}
}
function attach(contents){
  if(attached.has(contents))return;attached.add(contents);
  try{documents.set(contents,documentKey(contents.getURL()));}catch{}
  contents.on('console-message',(_event,...args)=>message(contents,[typeof _event?.message==='string'?_event:args[0],...args.slice(1)]));
  contents.on('dom-ready',()=>{failedReload=null;injectPluginsIntoContents(contents);});
  contents.on('did-finish-load',()=>{failedReload=null;injectPluginsIntoContents(contents);});
  contents.on('did-start-navigation',(_event,url,inPlace,isMainFrame)=>{if(isMainFrame){
    const next=documentKey(url),sameDocument=inPlace&&next&&next===documents.get(contents);documents.set(contents,next);
    if(sameDocument)epochs.set(contents,(epochs.get(contents)||0)+1);
    else drop(contents);
  }});
  contents.on('render-process-gone',()=>{drop(contents);status();log('renderer-exited');});
  contents.once('destroyed',()=>{drop(contents);status();});
  if(typeof contents.isLoading==='function'&&!contents.isLoading())injectPluginsIntoContents(contents);
}
app.on('web-contents-created',(_event,contents)=>attach(contents));
app.whenReady().then(()=>{for(const c of webContents.getAllWebContents())attach(c);}).catch(()=>log('loader-ready-failed'));
let reloading=false;
const disposeCode="if(location.protocol==='https:'&&['claude.ai','www.claude.ai'].includes(location.hostname)){window.claudeAutoContinue?.dispose();if(!window.claudeAutoContinue)document.getElementById('claude-auto-continue-plugin')?.remove();}";
async function reloadPlugin(){
  if(reloading||shuttingDown||!compatible)return;
  reloading=true;
  const previous=bundle,touched=[];let replacement;
  try{
    replacement=readBundle();
    // Keep the restored widget usable while the same broken replacement remains on disk.
    // Source changes or a fresh ready event permit another attempt.
    if(failedReload?.engine===replacement.engine&&failedReload?.plugin===replacement.plugin)return;
    bundle=replacement;
    let failed=false;
    for(const c of webContents.getAllWebContents())if(!c.isDestroyed()&&allowed(c)){
      touched.push(c);
      try{
        drop(c);await c.executeJavaScript(disposeCode);
        if(!await injectPluginsIntoContents(c))failed=true;
      }catch{failed=true;}
    }
    if(failed)throw new Error('Renderer injection unavailable');
    fs.unlinkSync(path.join(root,'reload-plugin.json'));failedReload=null;log('plugin-reloaded');
  }catch{
    bundle=previous;log('plugin-reload-failed');
    if(touched.length){
      failedReload=replacement;let restored=!!previous;
      for(const c of touched)if(!c.isDestroyed()&&allowed(c)){
        try{drop(c);await c.executeJavaScript(disposeCode);if(!await injectPluginsIntoContents(c))restored=false;}catch{restored=false;}
      }
      log('plugin-rollback',{restored});status();
    }
  }finally{reloading=false;}
}
const watch=setInterval(()=>{
  if(fs.existsSync(path.join(root,'reload-plugin.json')))reloadPlugin();
  updatePower();status();
  if(fs.existsSync(path.join(root,'shutdown.json'))){
    shuttingDown=true;for(const c of webContents.getAllWebContents())if(allowed(c))c.executeJavaScript('window.claudeAutoContinue?.dispose()').catch(()=>{});
    restoreAllTimers();release();app.quit();
  }
},2000);
watch.unref();
app.on('before-quit',()=>{shuttingDown=true;clearInterval(watch);restoreAllTimers();release();log('app-exit');});
log('loader-start',{claudeVersion:app.getVersion(),macOS:os.release(),compatible});
if(!compatible)log('compatibility-paused');
status();
module.exports={injectPluginsIntoContents};
