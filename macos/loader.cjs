// macOS adapter for the upstream web-contents-created / executeJavaScript loader.
// Installs only Auto Continue; never loads the upstream version-spoof plugin.
const {app,powerSaveBlocker,shell,webContents}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
const logDir=path.join(os.homedir(),'Library/Logs/ClaudeAutoContinue');
fs.mkdirSync(logDir,{recursive:true,mode:0o700});
const logPath=path.join(logDir,'auto-continue.log');
const statusPath=path.join(root,'status.json');
let assertion=null,shuttingDown=false;
const health=new Map(),leases=new Map(),attached=new WeakSet();
function log(event,fields={}){
  try{
    if(fs.existsSync(logPath)&&fs.statSync(logPath).size>1024*1024){for(let i=2;i>=1;i--)if(fs.existsSync(logPath+'.'+i))fs.renameSync(logPath+'.'+i,logPath+'.'+(i+1));fs.renameSync(logPath,logPath+'.1');}
    fs.appendFileSync(logPath,JSON.stringify({time:new Date().toISOString(),event,...fields})+'\n',{mode:0o600});
  }catch{}
}
function allowed(contents){try{const u=new URL(contents.getURL());return u.protocol==='https:'&&['claude.ai','www.claude.ai'].includes(u.hostname);}catch{return false;}}
function release(){if(assertion!==null){powerSaveBlocker.stop(assertion);assertion=null;log('power-released');}}
function updatePower(){
  const active=[...leases.values()].some(x=>Date.now()-x.time<30000&&x.active&&x.keepAwake);
  if(active&&assertion===null){assertion=powerSaveBlocker.start('prevent-app-suspension');log('power-started');}
  if(!active)release();
}
function status(){try{fs.writeFileSync(statusPath,JSON.stringify({pid:process.pid,version:app.getVersion(),loaderVersion:'2.1.0',time:Date.now(),powerAssertion:assertion!==null,renderers:[...health.values()]}),{mode:0o600});}catch{}}
function message(contents,args){
  if(!allowed(contents))return;
  const detail=args[0];const message=typeof detail?.message==='string'?detail.message:args[1];
  if(typeof message!=='string'||!message.startsWith('[ClaudeAutoContinue] ')||message.length>1500)return;
  let data;try{data=JSON.parse(message.slice(20));}catch{return;}
  if(data.event==='heartbeat'){
    leases.set(contents.id,{time:Date.now(),active:data.active===true,keepAwake:data.keepAwake===true});if(['DISABLED','IDLE','GENERATING','FINISHED','COUNTDOWN','SENDING_CONTINUE','WAITING_FOR_GENERATION','RATE_LIMITED','WAITING_FOR_USAGE_RESET','CHECKING_AVAILABILITY','NETWORK_ERROR','RECOVERING','PAUSED','ERROR','STOPPED'].includes(data.state))health.set(contents.id,{widgets:data.widgets===1?1:0,composer:data.composer===true,send:data.send===true,state:data.state});
    updatePower();return;
  }
  if(data.event==='open-logs'){shell.openPath(logDir);return;}
  // Never persist arbitrary renderer text, URLs, prompts, or response hashes.
  const known=['state','initialized','storage-unavailable','draft-cleanup-failed','debug'];
  if(!known.includes(data.event))return;
  const fields={};
  for(const key of ['from','to','reason','error'])if(typeof data[key]==='string'&&/^[A-Z_]{1,64}$/.test(data[key]))fields[key]=data[key];
  for(const key of ['composer','send','generating','completed'])if(typeof data[key]==='boolean')fields[key]=data[key];
  log(data.event,fields);
}
let engine=fs.readFileSync(path.join(root,'lib/engine.js'),'utf8');
let plugin=fs.readFileSync(path.join(root,'plugins/auto-continue.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const compatible=manifest.claudeVersion===app.getVersion();
async function injectPluginsIntoContents(contents){
  if(shuttingDown||contents.isDestroyed()||!allowed(contents)||!compatible)return;
  try{
    const meta={claudeVersion:app.getVersion(),loaderVersion:'2.1.0',compatibility:'injection tested; automation preview'};
    await contents.executeJavaScript(`window.__CLAUDE_AC_META=${JSON.stringify(meta)};\n${engine}\n${plugin}`);
    const report=await contents.executeJavaScript('window.claudeAutoContinue?.diagnostics()');
    if(report)health.set(contents.id,{widgets:report.widgets,composer:report.composer,send:report.send,state:report.state});
    log('injection',{widgets:report?.widgets||0,composer:report?.composer===true,send:report?.send===true});status();
  }catch{log('injection-failed');}
}
function attach(contents){
  if(attached.has(contents))return;attached.add(contents);
  contents.on('console-message',(_event,...args)=>message(contents,[typeof _event?.message==='string'?_event:args[0],...args.slice(1)]));
  contents.on('dom-ready',()=>injectPluginsIntoContents(contents));
  contents.on('did-finish-load',()=>injectPluginsIntoContents(contents));
  contents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame){leases.delete(contents.id);health.delete(contents.id);updatePower();}});
  contents.on('render-process-gone',()=>{leases.delete(contents.id);health.delete(contents.id);updatePower();status();log('renderer-exited');});
  contents.once('destroyed',()=>{leases.delete(contents.id);health.delete(contents.id);updatePower();status();});
}
app.on('web-contents-created',(_event,contents)=>attach(contents));
app.whenReady().then(()=>{for(const c of webContents.getAllWebContents())attach(c);});
let reloading=false;
async function reloadPlugin(){
  if(reloading||shuttingDown||!compatible)return;
  reloading=true;
  try{
    engine=fs.readFileSync(path.join(root,'lib/engine.js'),'utf8');plugin=fs.readFileSync(path.join(root,'plugins/auto-continue.js'),'utf8');
    for(const c of webContents.getAllWebContents())if(!c.isDestroyed()&&allowed(c)){
      await c.executeJavaScript('window.claudeAutoContinue?.dispose()');await injectPluginsIntoContents(c);
    }
    fs.unlinkSync(path.join(root,'reload-plugin.json'));log('plugin-reloaded');
  }catch{log('plugin-reload-failed');}finally{reloading=false;}
}
const watch=setInterval(()=>{
  if(fs.existsSync(path.join(root,'reload-plugin.json')))reloadPlugin();
  updatePower();status();
  if(fs.existsSync(path.join(root,'shutdown.json'))){
    shuttingDown=true;for(const c of webContents.getAllWebContents())if(allowed(c))c.executeJavaScript('window.claudeAutoContinue?.dispose()').catch(()=>{});
    release();app.quit();
  }
},2000);
watch.unref();
app.on('before-quit',()=>{shuttingDown=true;clearInterval(watch);release();log('app-exit');});
log('loader-start',{claudeVersion:app.getVersion(),macOS:os.release(),compatible});
if(!compatible)log('compatibility-paused');
status();
module.exports={injectPluginsIntoContents};
