const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine,resetTime,classify,config}=require('../lib/engine.js');
const base={conversation:'chat-1',ready:true,generating:false,completed:true,hash:'response-1',error:null,humanDraft:false};
function setup(options={}){const logs=[];const e=new Engine(options,x=>logs.push(x));e.arm('chat-1',0);return {e,logs};}
function finish(e,t=0,hash='response-1'){e.tick({...base,generating:true,hash},t);e.tick({...base,hash},t+100);e.tick({...base,hash},t+3000);}
test('one send follows observed generation and stable completion',()=>{const {e}=setup();finish(e);assert.equal(e.state,'COUNTDOWN');const a=e.tick(base,13000);assert.equal(a.type,'send');assert.equal(e.tick(base,13000),null);e.sent(a.epoch,13000);e.tick({...base,generating:true},14000);assert.equal(e.state,'GENERATING');assert.equal(e.stats.count,1);});
test('idle never sends without observing generation',()=>{const {e}=setup();for(let t=0;t<100000;t+=500)e.tick(base,t);assert.equal(e.state,'IDLE');});
test('stop disappearance alone never means completion',()=>{const {e}=setup();finish(e);const x=setup().e;x.tick({...base,generating:true},0);x.tick({...base,completed:false},100);x.tick({...base,completed:false},20000);assert.equal(x.state,'PAUSED');});
for(const state of ['PAUSED','DISABLED','STOPPED'])test(`${state} invalidates queued send`,()=>{const {e}=setup();finish(e);const a=e.tick(base,13000);e.cancel(state);assert.equal(e.sent(a.epoch,14000),false);assert.equal(e.tick(base,20000),null);});
test('human draft cancels countdown',()=>{const {e}=setup();finish(e);e.tick({...base,humanDraft:true},4000);assert.equal(e.state,'PAUSED');});
test('conversation switch cancels countdown',()=>{const {e}=setup();finish(e);e.tick({...base,conversation:'chat-2'},4000);assert.equal(e.state,'PAUSED');});
test('generation restart cancels countdown',()=>{const {e}=setup();finish(e);e.tick({...base,generating:true},4000);assert.equal(e.state,'GENERATING');assert.equal(e.deadline,null);});
test('rate limit cancels countdown and does not send across checks',()=>{const {e}=setup();finish(e);const limit={...base,error:'RATE_LIMIT',resetText:'Usage limit reached'};e.tick(limit,4000);assert.equal(e.state,'WAITING_FOR_USAGE_RESET');for(let i=0;i<20;i++){const next=e.nextCheck;assert.equal(e.tick(limit,next),null);assert(e.nextCheck-next>=120000);}assert.equal(e.stats.count,0);});
test('rate limit recovery verifies availability before one continuation',()=>{const {e}=setup();finish(e);e.tick({...base,error:'RATE_LIMIT'},4000);e.tick(base,124000);assert.equal(e.state,'RECOVERING');e.tick(base,128999);assert.equal(e.state,'RECOVERING');e.tick(base,129000);assert.equal(e.state,'COUNTDOWN');assert.equal(e.tick(base,139000).type,'send');assert.equal(e.tick(base,139000),null);});
test('reappearing limit during verification cancels recovery',()=>{const {e}=setup();finish(e);e.tick({...base,error:'RATE_LIMIT'},4000);e.tick(base,124000);e.tick({...base,error:'RATE_LIMIT'},125000);assert.equal(e.state,'WAITING_FOR_USAGE_RESET');});
test('rate limit cannot jump to send',()=>{const {e}=setup();e.transition('RATE_LIMITED');assert.throws(()=>e.transition('SENDING_CONTINUE'));});
test('network is distinct and recovers conservatively',()=>{const {e}=setup();finish(e);e.tick({...base,error:'NETWORK'},4000);assert.equal(e.state,'NETWORK_ERROR');e.tick(base,5000);assert.equal(e.state,'NETWORK_ERROR');e.tick(base,124000);e.tick(base,129000);assert.equal(e.state,'COUNTDOWN');});
test('ambiguous network delivery is not retried',()=>{const {e}=setup();finish(e);const a=e.tick(base,13000);e.sent(a.epoch,13000);e.tick({...base,error:'NETWORK'},14000);assert.equal(e.state,'PAUSED');assert.equal(e.lastError,'DELIVERY_UNCERTAIN');});
test('missing UI safely pauses',()=>{const {e}=setup();e.tick({...base,ready:false},0);assert.equal(e.state,'PAUSED');});
test('missing acknowledgement never resubmits',()=>{const {e}=setup();finish(e);const a=e.tick(base,13000);e.sent(a.epoch,13000);e.tick(base,59000);assert.equal(e.state,'PAUSED');assert.equal(e.stats.count,1);});
test('maximum continuation count is exact',()=>{const {e}=setup({maxConsecutive:3});for(let i=0;i<3;i++){const t=i*20000;finish(e,t,'r'+i);const a=e.tick({...base,hash:'r'+i},t+13000);assert(a);e.sent(a.epoch,t+13000);}finish(e,60000,'last');assert.equal(e.stats.count,3);assert.equal(e.state,'PAUSED');});
test('unlimited preserves cooldown and validation',()=>{const {e}=setup({maxConsecutive:'unlimited',maxHours:'unlimited',delaySeconds:1,minCooldownMs:1});assert.equal(e.options.minCooldownMs,5000);e.stats.count=100000;finish(e);assert.equal(e.state,'COUNTDOWN');});
test('runtime limit does not interrupt generation',()=>{const {e}=setup({maxHours:0.01});e.tick({...base,generating:true},0);e.tick({...base,generating:true},40000);assert.equal(e.state,'GENERATING');e.tick(base,41000);assert.equal(e.state,'PAUSED');});
test('repeated responses pause after three identical completions',()=>{const {e}=setup();for(let i=0;i<2;i++){finish(e,i*20000);const a=e.tick(base,i*20000+13000);e.sent(a.epoch,i*20000+13000);}finish(e,40000);assert.equal(e.state,'PAUSED');});
test('one empty response gets longer delay; second pauses',()=>{const {e}=setup();finish(e,0,null);assert.equal(e.deadline,33000);const a=e.tick({...base,hash:null},33000);e.sent(a.epoch,33000);finish(e,40000,null);assert.equal(e.state,'PAUSED');});
test('reset parses noon, midnight, future and rollover',()=>{const now=new Date(2026,9,11,14,0).getTime();for(const [text,hour,day] of [['Resets at 8:00 PM',20,11],['Available again at 12:00 AM',0,12],['Resets at 12:00 PM',12,12],['Resets at midnight',0,12],['Resets at noon',12,12],['Resets tomorrow at 8 PM',20,12]]){const d=new Date(resetTime(text,now).timestamp);assert.equal(d.getHours(),hour);assert.equal(d.getDate(),day);}});
test('unsupported reset time returns unknown',()=>{for(const s of ['reset soon','reset at 25 PM','reset at 8 PM UTC','reset on 2026-11-12 at 8 PM','hello 8 PM'])assert.equal(resetTime(s),null);});
test('known reset adds buffer and does not send at reset',()=>{const now=new Date(2026,9,11,19).getTime();const {e}=setup();e.arm('chat-1',now);e.tick({...base,error:'RATE_LIMIT',resetText:'Resets at 8 PM'},now);assert.equal(e.nextCheck,new Date(2026,9,11,20,0,30).getTime());assert.equal(e.stats.count,0);});
test('classification requires warning context supplied by adapter',()=>{assert.equal(classify({warnings:[]}).kind,null);assert.equal(classify({warnings:['Usage limit reached; resets at 8 PM']}).kind,'RATE_LIMIT');assert.equal(classify({warnings:['Server overloaded']}).kind,'SERVER');assert.equal(classify({online:false}).kind,'NETWORK');assert.equal(classify({warnings:['Connection interrupted']}).kind,'NETWORK');});
test('invalid options cannot create tight polling',()=>{assert.deepEqual(config({pollMinutes:[0,0.1]}).pollMinutes,[2,5,10,15]);assert.equal(config({delaySeconds:NaN}).delaySeconds,10);});
test('session reset clears pending recovery intention',()=>{const {e}=setup();finish(e);e.tick({...base,error:'RATE_LIMIT'},4000);e.cancel();e.arm('chat-1',5000);assert.equal(e.resumeNeeded,false);});

test('a usage limit takes priority over an earlier unrelated error toast',()=>{assert.equal(classify({warnings:['Something went wrong','You are out of free messages until 4:40 AM']}).kind,'RATE_LIMIT');});
test('free message until time parses even next to the Upgrade label',()=>{const now=new Date(2026,9,12,3,0).getTime();assert.equal(resetTime('You are out of free messages until 4:40 AMUpgrade',now).timestamp,new Date(2026,9,12,4,40).getTime());});
test('explicit Start can continue a completed idle response after quiet time and countdown',()=>{const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);e.tick(base,0);e.tick(base,2500);assert.equal(e.state,'COUNTDOWN');assert.equal(e.tick(base,3500).type,'send');});
test('explicit Start during an existing limit retains continuation intent after reset',()=>{const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);e.tick({...base,error:'RATE_LIMIT'},0);assert.equal(e.resumeNeeded,true);e.tick(base,120000);e.tick(base,125000);assert.equal(e.state,'COUNTDOWN');assert.equal(e.tick(base,126000).type,'send');});
test('explicit Start never submits on an empty chat',()=>{const e=new Engine();e.arm('chat-1',0,true);e.tick({...base,hash:null},0);assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'NO_RESPONSE_TO_CONTINUE');});

test('a completed fast reply acknowledges one submission without a visible Stop sample',()=>{const {e}=setup();finish(e);const a=e.tick(base,13000);e.sent(a.epoch,13000);const reply={...base,hash:'new-completed-answer'};e.tick(reply,13500);assert.equal(e.state,'GENERATING');e.tick(reply,14000);e.tick(reply,17000);assert.equal(e.state,'COUNTDOWN');assert.equal(e.stats.count,1);});
test('a changed response invalidates a pending continuation',()=>{const {e}=setup();finish(e);assert.equal(e.tick({...base,hash:'different'},13000),null);assert.equal(e.lastReason,'RESPONSE_CHANGED');});
test('approval mode waits indefinitely, then rechecks the conversation before sending',()=>{const {e}=setup({confirmBeforeSend:true});finish(e);assert.equal(e.tick(base,13000),null);assert.equal(e.awaitingConfirmation,true);assert.equal(e.tick(base,40000),null);assert.equal(e.stats.count,0);assert.equal(e.confirm(),true);e.tick({...base,conversation:'other'},40001);assert.equal(e.state,'PAUSED');assert.equal(e.confirm(),false);});
test('approval authorizes only the current send and resets for the next turn',()=>{const {e}=setup({confirmBeforeSend:true});finish(e);e.tick(base,13000);e.confirm();const a=e.tick(base,13500);assert(a);e.sent(a.epoch,13500);finish(e,20000,'new-answer');assert.equal(e.tick({...base,hash:'new-answer'},33000),null);assert.equal(e.awaitingConfirmation,true);assert.equal(e.stats.count,1);});
test('losing a completion marker cancels even an approved countdown',()=>{const {e}=setup({confirmBeforeSend:true});finish(e);e.tick(base,13000);e.confirm();assert.equal(e.tick({...base,completed:false},14000),null);assert.equal(e.lastReason,'COMPLETION_UNCERTAIN');});
test('unknown errors during network recovery pause instead of polling forever',()=>{const {e}=setup();e.tick({...base,error:'NETWORK'},0);e.tick({...base,error:'UNKNOWN'},120000);assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'UNKNOWN');});
test('malformed persisted timing values cannot bypass safety minimums',()=>{assert.equal(config(null).quietMs,2500);const c=config({quietMs:0,verifyMs:-1,sendTimeoutMs:0,networkRetryMs:1,maxConsecutive:2.8});assert.equal(c.quietMs,2500);assert.equal(c.verifyMs,5000);assert.equal(c.sendTimeoutMs,45000);assert.equal(c.networkRetryMs,120000);assert.equal(c.maxConsecutive,2);});

test('overnight quota recovery resumes an interrupted reply without a completion toolbar',()=>{const now=new Date(2026,9,12,19,51,34).getTime(),e=new Engine({delaySeconds:1});e.arm('chat-1',now,true);const partial={...base,completed:false,hash:'interrupted-response',taskHash:'current-task'};e.tick({...partial,generating:true},now);e.tick({...partial,error:'RATE_LIMIT',resetText:'You are out of free messages until 12:20 AM'},now+1000);const check=e.nextCheck;assert.equal(check,new Date(2026,9,13,0,20,30).getTime());e.tick(partial,check);e.tick(partial,check+5000);assert.equal(e.state,'RECOVERING');e.tick(partial,check+14999);assert.equal(e.state,'RECOVERING');e.tick(partial,check+15000);assert.equal(e.state,'COUNTDOWN');const a=e.tick(partial,check+16000);assert.equal(a.type,'send');assert.equal(a.basis,'quota-recovery');assert.equal(e.tick(partial,check+16001),null);e.sent(a.epoch,check+16001);e.tick({...partial,generating:true},check+17000);assert.equal(e.stats.count,1);assert.equal(e.state,'GENERATING');});
test('explicit Resume can continue an interrupted response after ten stable idle seconds',()=>{const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);const s={...base,completed:false};e.tick(s,0);e.tick(s,9999);assert.equal(e.state,'IDLE');e.tick(s,10000);assert.equal(e.state,'COUNTDOWN');assert.equal(e.tick(s,11000).basis,'explicit-start');});
test('an explicit request can resume a user task that produced no assistant text',()=>{const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);const s={...base,hash:null,completed:false,hasUserTurn:true,taskHash:'existing-request'};e.tick(s,0);e.tick(s,10000);assert.equal(e.tick(s,11000).type,'send');});
test('network recovery cannot silently use the quota-interruption exception',()=>{const {e}=setup();const s={...base,completed:false};e.tick({...s,generating:true},0);e.tick({...s,error:'NETWORK'},1);e.tick(s,120001);e.tick(s,125001);assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'COMPLETION_UNCERTAIN');});
test('a new user turn cancels a pending interrupted-task continuation',()=>{const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);const s={...base,completed:false,taskHash:'task-1'};e.tick(s,0);e.tick(s,10000);assert.equal(e.tick({...s,taskHash:'task-2'},11000),null);assert.equal(e.lastReason,'RESPONSE_CHANGED');});
test('generation or human typing prevents an interrupted-task send',()=>{for(const change of [{generating:true},{humanDraft:true}]){const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);const s={...base,completed:false};e.tick(s,0);e.tick(s,10000);assert.equal(e.tick({...s,...change},11000),null);assert.notEqual(e.state,'SENDING_CONTINUE');}});
test('Start during quota exhaustion retains a user task with no assistant text',()=>{const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);const s={...base,hash:null,completed:false,hasUserTurn:true,taskHash:'blocked-task'};e.tick({...s,error:'RATE_LIMIT'},0);assert.equal(e.resumeNeeded,true);e.tick(s,120000);e.tick(s,125000);e.tick(s,135000);assert.equal(e.tick(s,136000).basis,'quota-recovery');});

test('a semantic usage banner suspends sending when its wording is unfamiliar',()=>{
  assert.equal(classify({warnings:['Limite atingido'],usageLimitVisible:true}).kind,'RATE_LIMIT');
  assert.equal(classify({warnings:['Something went wrong'],usageLimitVisible:true}).kind,'RATE_LIMIT');
  assert.equal(classify({warnings:['Something went wrong']}).kind,'UNKNOWN');
  assert.equal(classify({online:false,usageLimitVisible:true}).kind,'NETWORK');
  assert.equal(classify({warnings:['A notification'],usageLimitVisible:false}).kind,null);
});
test('unsupported three-letter reset time zones use passive polling',()=>{
  const now=new Date(2026,9,13,18,0).getTime();
  for(const zone of ['EST','EDT','PST','PDT','CST','CDT','IST'])assert.equal(resetTime(`Resets at 8 PM ${zone}`,now),null,zone);
  const e=new Engine();e.arm('chat-1',now,true);e.tick({...base,error:'RATE_LIMIT',resetText:'Resets at 8 PM PST'},now);
  assert.equal(e.nextCheck,now+120000);
});
for(const kind of ['NETWORK','SERVER'])test(`quota recovery survives an intervening ${kind.toLowerCase()} outage`,()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,completed:false,taskHash:'pending-task'};
  e.tick({...s,error:'RATE_LIMIT'},0);e.tick({...s,error:kind},120000);
  assert.equal(e.state,'NETWORK_ERROR');assert.equal(e.recoveryBasis,'quota-recovery');
  e.tick({...s,error:kind},240000);assert.equal(e.stats.count,0);
  e.tick(s,360000);e.tick(s,365000);e.tick(s,374999);assert.equal(e.state,'RECOVERING');
  e.tick(s,375000);const action=e.tick(s,376000);
  assert.equal(action.basis,'quota-recovery');assert.equal(e.tick(s,376001),null);
});
test('an unsent explicit interrupted-task request survives a connection outage',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,completed:false,taskHash:'pending-task'};
  e.tick(s,0);e.tick(s,10000);e.tick({...s,error:'NETWORK'},10500);
  assert.equal(e.recoveryBasis,'explicit-start');
  e.tick(s,130500);e.tick(s,135500);e.tick(s,145500);
  assert.equal(e.tick(s,146500).basis,'explicit-start');
});
test('explicit Start while offline retains an interrupted user task until verification succeeds',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,completed:false,hash:null,hasUserTurn:true,taskHash:'pending-task'};
  e.tick({...s,error:'NETWORK'},0);assert.equal(e.recoveryBasis,'explicit-start');
  e.tick(s,120000);e.tick(s,125000);e.tick(s,135000);
  assert.equal(e.tick(s,136000).basis,'explicit-start');
});
test('a recovered interrupted countdown preserves quota intent through a later outage',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,completed:false,taskHash:'pending-task'};
  e.tick({...s,error:'RATE_LIMIT'},0);e.tick(s,120000);e.tick(s,125000);e.tick(s,135000);
  e.tick({...s,error:'SERVER'},135500);assert.equal(e.recoveryBasis,'quota-recovery');
  e.tick(s,255500);e.tick(s,260500);e.tick(s,270500);
  assert.equal(e.tick(s,271500).basis,'quota-recovery');
});
for(const kind of ['RATE_LIMIT','NETWORK'])test(`a new task during ${kind.toLowerCase()} waiting cannot inherit the old continuation`,()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'original-task'};
  e.tick({...s,error:kind},0);
  assert.equal(e.tick({...s,taskHash:'different-task'},120000),null);
  assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'RESPONSE_CHANGED');assert.equal(e.stats.count,0);
});
test('a new task during availability verification cancels the original recovery',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'original-task'};
  e.tick({...s,error:'RATE_LIMIT'},0);e.tick(s,120000);
  assert.equal(e.tick({...s,taskHash:'different-task'},125000),null);assert.equal(e.lastReason,'RESPONSE_CHANGED');
});
test('a changed user task cannot replace countdown intent behind a quota banner',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'original-task'};e.tick(s,0);e.tick(s,2500);
  e.tick({...s,taskHash:'different-task',error:'RATE_LIMIT'},3000);
  assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'RESPONSE_CHANGED');
});
test('an identical fast reply is acknowledged by a new stable assistant turn identity',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,responseToken:'count:1'};e.tick(s,0);e.tick(s,2500);
  const action=e.tick(s,3500);assert.equal(action.responseToken,'count:1');e.sent(action.epoch,3500);
  const next={...s,responseToken:'count:2'};e.tick(next,4000);
  assert.equal(e.state,'GENERATING');e.tick(next,4500);e.tick(next,7000);
  assert.equal(e.state,'COUNTDOWN');assert.equal(e.stats.count,1);
});
test('unchanged assistant identity cannot falsely acknowledge an identical stale response',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,responseToken:'count:1'};e.tick(s,0);e.tick(s,2500);
  const action=e.tick(s,3500);e.sent(action.epoch,3500);
  e.tick(s,4000);assert.equal(e.state,'WAITING_FOR_GENERATION');
  e.tick(s,48500);assert.equal(e.lastError,'SEND_NOT_ACKNOWLEDGED');assert.equal(e.stats.count,1);
});
test('new assistant identities do not bypass the repeated-text loop safeguard',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0);
  let s={...base,responseToken:'turn:1'};
  e.tick({...s,generating:true},0);e.tick(s,500);e.tick(s,3000);
  for(let i=0;i<2;i++){
    const action=e.tick(s,e.deadline);assert(action);const sentAt=e.deadline;e.sent(action.epoch,sentAt);
    s={...s,responseToken:`turn:${i+2}`};e.tick(s,sentAt+100);e.tick(s,sentAt+500);e.tick(s,sentAt+3000);
  }
  assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'DUPLICATE_RESPONSE_LOOP');assert.equal(e.stats.count,2);
});
test('a different assistant turn cancels countdown even when its text is identical',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,responseToken:'count:1'};e.tick(s,0);e.tick(s,2500);
  assert.equal(e.tick({...s,responseToken:'count:2'},3500),null);assert.equal(e.lastReason,'RESPONSE_CHANGED');
});
test('a new assistant turn restarts quiet verification despite identical text',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,responseToken:'count:1'};e.tick(s,0);
  const next={...s,responseToken:'count:2'};e.tick(next,2400);e.tick(next,2500);
  assert.equal(e.state,'IDLE');e.tick(next,4900);assert.equal(e.state,'COUNTDOWN');
});
test('an empty fast response is acknowledged only with a new stable assistant identity',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,responseToken:'turn:1'};e.tick(s,0);e.tick(s,2500);
  const action=e.tick(s,3500);e.sent(action.epoch,3500);
  e.tick({...s,hash:null},4000);assert.equal(e.state,'WAITING_FOR_GENERATION');
  const empty={...s,hash:null,responseToken:'turn:2'};e.tick(empty,4500);assert.equal(e.state,'GENERATING');
  e.tick(empty,5000);e.tick(empty,7500);assert.equal(e.state,'COUNTDOWN');assert.equal(e.deadline,37500);
});
test('quota arriving before our submitted user turn can perform one proven ownership handoff',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'project-request',taskToken:'user:1',responseToken:'assistant:1'};
  e.tick(s,0);e.tick(s,2500);const action=e.tick(s,3500);e.sent(action.epoch,3500);
  e.tick({...s,error:'RATE_LIMIT'},4000);assert.equal(e.allowOwnTaskHandoff,true);
  const submitted={...s,taskHash:'our-continue',taskToken:'user:2',ownSubmittedTask:true};
  e.tick(submitted,124000);assert.equal(e.state,'RECOVERING');assert.equal(e.allowOwnTaskHandoff,false);
  e.tick(submitted,129000);const next=e.tick(submitted,130000);
  assert.equal(next.taskHash,'our-continue');assert.equal(next.taskToken,'user:2');assert.equal(e.stats.count,1);
});
test('an unproven new user turn after quota cannot complete our submitted-task handoff',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'project-request',taskToken:'user:1'};
  e.tick(s,0);e.tick(s,2500);const action=e.tick(s,3500);e.sent(action.epoch,3500);e.tick({...s,error:'RATE_LIMIT'},4000);
  e.tick({...s,taskHash:'other-request',taskToken:'user:2'},124000);
  assert.equal(e.lastReason,'RESPONSE_CHANGED');assert.equal(e.stats.count,1);
});
test('Stop visible before our user turn and quota notice still permits one proven own-task handoff',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'project-request',taskToken:'user:1',responseToken:'assistant:1'};
  e.tick(s,0);e.tick(s,2500);const action=e.tick(s,3500);e.sent(action.epoch,3500);
  e.tick({...s,generating:true},3600);assert.equal(e.state,'GENERATING');
  const partial={...s,completed:false};e.tick({...partial,error:'RATE_LIMIT'},3700);
  assert.equal(e.allowOwnTaskHandoff,true);
  const submitted={...partial,taskHash:'our-continue',taskToken:'user:2',ownSubmittedTask:true},check=e.nextCheck;
  e.tick(submitted,check);e.tick(submitted,check+5000);e.tick(submitted,check+15000);
  const next=e.tick(submitted,check+16000);assert.equal(next.basis,'quota-recovery');assert.equal(next.taskToken,'user:2');assert.equal(e.stats.count,1);
});
test('acknowledged generation with an early quota notice still rejects an unrelated user turn',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'project-request',taskToken:'user:1'};
  e.tick(s,0);e.tick(s,2500);const action=e.tick(s,3500);e.sent(action.epoch,3500);
  e.tick({...s,generating:true},3600);e.tick({...s,completed:false,error:'RATE_LIMIT'},3700);
  e.tick({...s,taskHash:'other-task',taskToken:'user:2'},e.nextCheck);
  assert.equal(e.lastReason,'RESPONSE_CHANGED');assert.equal(e.stats.count,1);
});
test('the ownership proof cannot authorize task changes without a pending submitted send',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'project-request',taskToken:'user:1'};
  e.tick({...s,error:'RATE_LIMIT'},0);e.tick({...s,taskHash:'our-continue',taskToken:'user:2',ownSubmittedTask:true},120000);
  assert.equal(e.lastReason,'RESPONSE_CHANGED');assert.equal(e.stats.count,0);
});
test('quota capturing an already appended own turn cannot later adopt another user turn',()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'project-request',taskToken:'user:1'};
  e.tick(s,0);e.tick(s,2500);const action=e.tick(s,3500);e.sent(action.epoch,3500);
  const submitted={...s,taskHash:'our-continue',taskToken:'user:2',ownSubmittedTask:true};
  e.tick({...submitted,error:'RATE_LIMIT'},4000);assert.equal(e.allowOwnTaskHandoff,false);
  e.tick({...submitted,taskToken:'user:3'},124000);assert.equal(e.lastReason,'RESPONSE_CHANGED');
});
for(const waiting of [false,true])test(`identical user text with a different turn identity cancels ${waiting?'quota waiting':'countdown'}`,()=>{
  const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
  const s={...base,taskHash:'identical-text',taskToken:'user:1'};
  if(waiting)e.tick({...s,error:'RATE_LIMIT'},0);else{e.tick(s,0);e.tick(s,2500);}
  e.tick({...s,taskToken:'user:2'},waiting?120000:3500);assert.equal(e.lastReason,'RESPONSE_CHANGED');
});
test('new identical responses completed between quota checks still trigger the loop safeguard',()=>{
  const e=new Engine({delaySeconds:1,maxConsecutive:'unlimited',maxHours:'unlimited'});e.arm('chat-1',0);
  let s={...base,responseToken:'turn:1'},now=0;
  e.tick({...s,generating:true},0);e.tick(s,500);e.tick(s,3000);
  for(let i=0;i<2;i++){
    now=e.deadline;const action=e.tick(s,now);assert(action);e.sent(action.epoch,now);
    s={...s,responseToken:`turn:${i+2}`};e.tick({...s,error:'RATE_LIMIT'},now+100);
    now=e.nextCheck;e.tick(s,now);e.tick(s,now+5000);
  }
  assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'DUPLICATE_RESPONSE_LOOP');assert.equal(e.stats.count,2);
});
test('rechecking the same pre-quota response never counts it as another completion',()=>{
  const e=new Engine({delaySeconds:1,maxHours:'unlimited'});e.arm('chat-1',0);
  const s={...base,responseToken:'turn:1'};e.tick({...s,generating:true},0);e.tick(s,500);e.tick(s,3000);
  let now=3100;
  for(let i=0;i<4;i++){
    e.tick({...s,error:'RATE_LIMIT'},now);now=e.nextCheck;e.tick(s,now);now+=5000;e.tick(s,now);
    assert.equal(e.state,'COUNTDOWN');assert.equal(e.repeats,0);now+=100;
  }
  assert.equal(e.stats.count,0);
});
test('new empty responses completed between quota checks preserve empty-loop protection',()=>{
  const e=new Engine({delaySeconds:1,maxHours:'unlimited'});e.arm('chat-1',0);
  const first={...base,hash:null,responseToken:'turn:1'};e.tick({...first,generating:true},0);e.tick(first,500);e.tick(first,3000);
  const action=e.tick(first,33000);e.sent(action.epoch,33000);
  const second={...first,responseToken:'turn:2'};e.tick({...second,error:'RATE_LIMIT'},33100);
  const check=e.nextCheck;e.tick(second,check);e.tick(second,check+5000);
  assert.equal(e.lastReason,'EMPTY_RESPONSE_LOOP');assert.equal(e.stats.count,1);
});

test('two hundred acknowledged turns with quota and service outages preserve send invariants and the cap',()=>{
  const cap=200,e=new Engine({delaySeconds:1,maxConsecutive:cap,maxHours:'unlimited'});
  e.arm('chat-1',0);let now=0,previousSend=-Infinity;
  const observe=(s,time)=>{const action=e.tick(s,time);if(action){assert.equal(s.error,null);assert.equal(s.generating,false);assert.equal(s.humanDraft,false);assert.equal(s.ready,true);assert.equal(action.conversation,s.conversation);assert.equal(action.hash,s.hash);assert.equal(action.taskHash,s.taskHash);assert.equal(action.responseToken,s.responseToken);assert.equal(e.tick(s,time),null);}return action;};
  for(let i=0;i<cap;i++){
    let s={...base,hash:`reply-${i}`,taskHash:`task-${i}`,responseToken:`turn-${i}`};
    assert.equal(observe({...s,generating:true},now),null);now+=500;
    if(i%9===0){
      s={...s,completed:false};assert.equal(observe({...s,error:'RATE_LIMIT'},now),null);
      now=e.nextCheck;assert.equal(observe({...s,error:'RATE_LIMIT'},now),null);
      now=e.nextCheck;assert.equal(observe(s,now),null);now+=5000;assert.equal(observe(s,now),null);now+=10000;assert.equal(observe(s,now),null);
    }else{assert.equal(observe(s,now),null);now+=2500;assert.equal(observe(s,now),null);}
    assert.equal(e.state,'COUNTDOWN');
    if(i%11===0){
      assert.equal(observe({...s,error:'SERVER'},now+100),null);now=e.nextCheck;
      assert.equal(observe(s,now),null);now+=5000;assert.equal(observe(s,now),null);
      if(!s.completed){now+=10000;assert.equal(observe(s,now),null);}
      assert.equal(e.state,'COUNTDOWN');
    }
    now=e.deadline;const action=observe(s,now);assert(action,`turn ${i}`);assert(now-previousSend>=5000);
    assert.equal(e.sent(action.epoch,now),true);assert.equal(e.sent(action.epoch,now),false);previousSend=now;
    assert.equal(e.stats.count,i+1);now+=1000;
  }
  const last={...base,hash:'final-reply',taskHash:'final-task',responseToken:'final-turn'};
  observe({...last,generating:true},now);observe(last,now+500);observe(last,now+3000);
  assert.equal(e.state,'PAUSED');assert.equal(e.lastReason,'MAX_CONTINUATIONS');assert.equal(e.stats.count,cap);assert.equal(e.stats.failures,0);
});
test('every pre-send blocking signal prevents an action across completed and explicit interrupted starts',()=>{
  const changes=[{error:'RATE_LIMIT'},{error:'NETWORK'},{error:'SERVER'},{error:'UNKNOWN'},{generating:true},{humanDraft:true},{ready:false},{conversation:'other-chat'},{taskHash:'other-task'},{hash:'other-response'},{responseToken:'other-turn'}];
  for(const completed of [true,false])for(const change of changes){
    const e=new Engine({delaySeconds:1});e.arm('chat-1',0,true);
    const s={...base,completed,taskHash:'task',responseToken:'turn'};e.tick(s,0);e.tick(s,completed?2500:10000);
    assert.equal(e.state,'COUNTDOWN');assert.equal(e.tick({...s,...change},e.deadline),null,JSON.stringify({completed,change}));assert.equal(e.stats.count,0);
  }
});
