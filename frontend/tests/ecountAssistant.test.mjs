import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';
import { CHANNEL, assistantError, createAssistantBridge, createAssistantRunner, jobLabels, pendingAssistantKey } from '../src/utils/ecountAssistant.mjs';

function harness({ saveAllowed=true, saveError, resultErrorOnce=false, persistFailureAt=0, afterFailureHook, afterReadHook, previewError, resultErrors=[], saveResult, withLock }={}) {
    const apiCalls=[],bridgeCalls=[],writes=[];let pending=null,writesCount=0,current=true,resultFailures=resultErrorOnce?1:0;
    const queuedErrors=[...resultErrors];
    const job={id:'11111111-1111-4111-8111-111111111111',companyCode:'FIXTURE-CO',voucherNumber:'2026/10/16-1'};
    const plan={mode:'test',testWriteEnabled:true,companyCode:job.companyCode,voucherNumber:job.voucherNumber,rows:[{rowId:'original-line',metadata:'N1 出 5 件；N2 出 10 件；N3 出 10 件'}]};
    let apiResult={verified:true,job:{...job,status:'verified'}};
    const api={async post(path,body,options){
        apiCalls.push({path,body:structuredClone(body),options});
        if(path.endsWith('/claim'))return {data:{job,leaseToken:'fixture-lease'}};
        if(path.endsWith('/prepare'))return {data:{plan,planFingerprint:'a'.repeat(64),saveAllowed}};
        if(path.endsWith('/result')){
            if(queuedErrors.length)throw queuedErrors.shift();
            if(resultFailures-- > 0)throw Object.assign(new Error('Synthetic WMS response loss'),{code:'ECONNRESET'});
        }
        return {data:apiResult};
    }};
    const bridge={async request(type,payload){
        bridgeCalls.push({type,payload:structuredClone(payload)});
        if(type==='READ_DOCUMENT'){await afterReadHook?.();return {before:{companyCode:job.companyCode,voucherNumber:job.voucherNumber},capabilities:{}};}
        if(type==='PREVIEW_PLAN'&&previewError)throw Object.assign(new Error(previewError),{code:previewError});
        if(type==='SAVE_PLAN'){
            if(saveError){afterFailureHook?.();throw Object.assign(new Error(saveError),{code:saveError});}
            return saveResult??{outcome:'saved',after:{fixtureReadback:true}};
        }
        if(type==='READ_BACK')return {outcome:'saved',after:{fixtureReadback:true}};
        return {};
    }};
    const store={read:()=>pending,write(value){writesCount++;if(writesCount===persistFailureAt)throw new Error('Storage quota fixture');pending=structuredClone(value);writes.push(structuredClone(value));},clear(){pending=null;}};
    const runner=createAssistantRunner({api,bridge,actorId:1,workerId:'fixture-worker',store,isCurrent:()=>current,uuid:randomUUID,now:()=>1000000,...(withLock?{withLock}:{})});
    return {runner,store,apiCalls,bridgeCalls,writes,job,plan,setCurrent:value=>{current=value;},setResult:value=>{apiResult=value;}};
}

test('assistant preview never stores or sends a vendor save',async()=>{
    const f=harness({saveAllowed:false});assert.equal((await f.runner.runOne('preview')).verified,true);
    assert.deepEqual(f.bridgeCalls.map(c=>c.type),['READ_DOCUMENT','PREVIEW_PLAN']);assert.equal(f.writes.length,0);
    assert.equal(f.apiCalls.at(-1).body.outcome,'preview');assert.equal(f.store.read(),null);
});
test('failure to durably persist save intent prevents every vendor save',async()=>{
    const f=harness({persistFailureAt:1});await assert.rejects(f.runner.runOne('test'),/Storage quota/);
    assert.ok(!f.bridgeCalls.some(c=>c.type==='SAVE_PLAN'));assert.equal(f.apiCalls.at(-1).body.outcome,'failed');assert.equal(f.apiCalls.at(-1).body.vendorSaveAttempted,false);assert.equal(f.store.read(),null);
});
test('a local mode mismatch releases prepared work as definitely not saved',async()=>{
    const f=harness();await assert.rejects(f.runner.runOne('live'),/回寫模式已改變/);
    assert.ok(!f.bridgeCalls.some(c=>c.type==='SAVE_PLAN'));assert.equal(f.apiCalls.at(-1).body.errorCode,'LOCAL_PRE_SAVE_FAILED');
    assert.equal(f.apiCalls.at(-1).body.vendorSaveAttempted,false);assert.equal(f.store.read(),null);
});
test('successful automatic metadata save persists intent before save and clears only verified receipt',async()=>{
    const f=harness();const result=await f.runner.runOne('test');assert.equal(result.verified,true);
    assert.equal(f.writes[0].stage,'save-intent');assert.equal(f.writes[1].stage,'result');assert.equal(f.store.read(),null);
    assert.deepEqual(f.bridgeCalls.map(c=>c.type),['READ_DOCUMENT','PREVIEW_PLAN','SAVE_PLAN']);
    assert.equal(f.apiCalls.at(-1).body.outcome,'saved');assert.equal(f.apiCalls.at(-1).body.expectedActorId,1);
    assert.equal(f.bridgeCalls.at(-1).payload.permit.expiresAt,1090000);
});
test('unknown vendor save retains receipt and recovery only reads back without a second save',async()=>{
    const f=harness({saveError:'SAVE_RESULT_UNKNOWN'});f.setResult({verified:false,job:{status:'uncertain'}});
    assert.equal((await f.runner.runOne('test')).job.status,'uncertain');assert.ok(f.store.read());
    await assert.rejects(f.runner.runOne('test'),/上次操作尚待確認/);
    f.setResult({verified:true,job:{status:'verified'}});assert.equal((await f.runner.recover()).verified,true);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);assert.equal(f.store.read(),null);
});
test('an uncertain WMS receipt proceeds through READ_BACK then recover, never SAVE_PLAN',async()=>{
    const f=harness({saveError:'SAVE_RESULT_UNKNOWN'});f.setResult({verified:false,job:{status:'uncertain'}});
    await f.runner.runOne('test');await f.runner.recover();
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);assert.equal(f.bridgeCalls.filter(c=>c.type==='READ_BACK').length,1);
    assert.ok(f.apiCalls.at(-1).path.endsWith('/recover'));assert.ok(f.store.read());
});
test('a confirmed historical write clears recovery without calling the newer shipment verified or saving again',async()=>{
    const f=harness({saveError:'SAVE_RESULT_UNKNOWN'});f.setResult({verified:false,job:{status:'uncertain'}});
    await f.runner.runOne('test');
    const history={historicalVerified:true,newShipmentVerified:false,verified:false,testVerified:false,job:{status:'superseded_verified'}};
    f.setResult(history);assert.deepEqual(await f.runner.recover(),history);assert.equal(f.store.read(),null);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);
    assert.equal(jobLabels[history.job.status],'舊版回寫已確認，須處理新版');
});
test('historical confirmation after readback clears only the old recovery evidence',async()=>{
    const f=harness({persistFailureAt:2});await assert.rejects(f.runner.runOne('test'),/Storage quota/);
    f.setResult({historicalVerified:true,newShipmentVerified:false,verified:false,testVerified:false});
    const receipt=await f.runner.recover();assert.equal(receipt.historicalVerified,true);assert.equal(receipt.verified,false);
    assert.equal(f.store.read(),null);assert.equal(f.bridgeCalls.filter(c=>c.type==='READ_BACK').length,1);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);
});
test('unknown UI save messages instruct read-only recovery instead of another save',()=>{
    assert.match(assistantError({code:'READBACK_REOPEN_ORIGINAL_REQUIRED'}),/關閉目前畫面.*不要再次儲存/);
    assert.match(assistantError({code:'SAVE_UI_CONFIRMATION_PENDING'}),/唯讀確認上次結果/);
});
test('lost WMS result replays the identical command and body, without resaving ECOUNT',async()=>{
    const f=harness({resultErrorOnce:true});await assert.rejects(f.runner.runOne('test'),/Synthetic WMS response loss/);
    const original=f.apiCalls.at(-1);assert.equal(f.store.read().stage,'result');
    assert.equal((await f.runner.recover()).verified,true);assert.deepEqual(f.apiCalls.at(-1),original);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);assert.equal(f.bridgeCalls.filter(c=>c.type==='READ_BACK').length,0);assert.equal(f.store.read(),null);
});
test('lost post-save persistence retains original intent so recovery is read-only',async()=>{
    const f=harness({persistFailureAt:2});await assert.rejects(f.runner.runOne('test'),/Storage quota/);
    assert.equal(f.store.read().stage,'save-intent');assert.equal((await f.runner.recover()).verified,true);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);assert.equal(f.bridgeCalls.filter(c=>c.type==='READ_BACK').length,1);assert.ok(f.apiCalls.at(-1).path.endsWith('/recover'));
});
test('account change after document read stops before preview or vendor save',async()=>{
    let f;f=harness({afterReadHook:()=>f.setCurrent(false)});await assert.rejects(f.runner.runOne('test'),/登入人員已變更/);
    assert.deepEqual(f.bridgeCalls.map(c=>c.type),['READ_DOCUMENT']);assert.equal(f.apiCalls.length,1);assert.equal(f.store.read(),null);
});
test('an account change during unknown save preserves intent and makes no WMS result request under another identity',async()=>{
    let f;f=harness({saveError:'SAVE_RESULT_UNKNOWN',afterFailureHook:()=>f.setCurrent(false)});
    await assert.rejects(f.runner.runOne('test'),/登入人員已變更/);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);assert.ok(f.store.read());assert.ok(!f.apiCalls.some(c=>c.path.endsWith('/result')));
    await assert.rejects(f.runner.recover(),/登入人員已變更/);assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);
});
test('recovery is bound to the original actor and worker; keys keep accounts separate',async()=>{
    const f=harness({resultErrorOnce:true});await assert.rejects(f.runner.runOne('test'));
    f.store.write({...f.store.read(),actorId:2});await assert.rejects(f.runner.recover(),/找不到此人員/);
    f.store.write({...f.store.read(),actorId:1,workerId:'other-worker'});await assert.rejects(f.runner.recover(),/找不到此人員/);
    assert.notEqual(pendingAssistantKey(1),pendingAssistantKey(2));assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);
});
test('a definite stale WMS result allows only READ_BACK recovery, never another ECOUNT save',async()=>{
    const stale=()=>Object.assign(new Error('Expired result receipt fixture'),{response:{status:409,data:{code:'ECOUNT_BROWSER_LEASE_EXPIRED'}}});
    const f=harness({resultErrors:[stale(),stale()]});await assert.rejects(f.runner.runOne('test'),/Expired/);
    assert.equal((await f.runner.recover()).verified,true);assert.equal(f.bridgeCalls.filter(c=>c.type==='READ_BACK').length,1);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);assert.ok(f.apiCalls.at(-1).path.endsWith('/recover'));assert.equal(f.store.read(),null);
});
test('an unknown WMS network result must replay before any readback recovery or further save',async()=>{
    const unknown=()=>Object.assign(new Error('Unknown network result fixture'),{code:'ECONNRESET'});
    const f=harness({resultErrors:[unknown(),unknown()]});await assert.rejects(f.runner.runOne('test'),/Unknown network/);
    await assert.rejects(f.runner.recover(),/Unknown network/);assert.equal(f.bridgeCalls.filter(c=>c.type==='READ_BACK').length,0);
    assert.equal(f.bridgeCalls.filter(c=>c.type==='SAVE_PLAN').length,1);assert.ok(f.store.read());
    assert.equal((await f.runner.recover()).verified,true);assert.equal(f.store.read(),null);
    const results=f.apiCalls.filter(c=>c.path.endsWith('/result'));assert.equal(results.length,3);assert.ok(results.every(c=>c.body.commandId===results[0].body.commandId));
});
test('a definite preview failure reports failed preparation and never persists save intent or saves',async()=>{
    const f=harness({previewError:'UNVERIFIED_FIELD_LENGTH'});await assert.rejects(f.runner.runOne('test'),{code:'UNVERIFIED_FIELD_LENGTH'});
    assert.equal(f.apiCalls.at(-1).body.outcome,'failed');assert.equal(f.apiCalls.at(-1).body.vendorSaveAttempted,false);assert.equal(f.apiCalls.at(-1).body.errorCode,'UNVERIFIED_FIELD_LENGTH');
    assert.ok(!f.bridgeCalls.some(c=>c.type==='SAVE_PLAN'));assert.equal(f.store.read(),null);assert.equal(f.writes.length,0);
});
test('proven not-attempted vendor rejection becomes retryable failed bookkeeping, never a successful writeback',async()=>{
    const f=harness({saveResult:{outcome:'not_attempted',saveAttempted:false,errorCode:'PREVIEW_REQUIRED'}});f.setResult({verified:false,job:{status:'failed',canRetry:true}});
    const result=await f.runner.runOne('test');assert.equal(result.verified,false);assert.equal(result.job.status,'failed');assert.equal(f.apiCalls.at(-1).body.outcome,'failed');
    assert.equal(f.apiCalls.at(-1).body.vendorSaveAttempted,false);assert.equal(f.store.read(),null);
});
test('a not-attempted label without explicit false save evidence stays uncertain and cannot clear recovery intent',async()=>{
    const f=harness({saveResult:{outcome:'not_attempted',errorCode:'UNKNOWN_SAVE_BOUNDARY'}});f.setResult({verified:false,job:{status:'uncertain'}});
    const result=await f.runner.runOne('test');assert.equal(result.job.status,'uncertain');assert.equal(f.apiCalls.at(-1).body.outcome,'uncertain');assert.equal(f.apiCalls.at(-1).body.vendorSaveAttempted,undefined);assert.ok(f.store.read());
});
test('cross-tab lock denial prevents every claim, browser action and persistence',async()=>{
    const f=harness({withLock:()=>{throw new Error('Another WMS tab owns lock');}});
    await assert.rejects(async()=>f.runner.runOne('test'),/owns lock/);assert.equal(f.apiCalls.length,0);assert.equal(f.bridgeCalls.length,0);assert.equal(f.writes.length,0);
    await assert.rejects(async()=>f.runner.recover(),/owns lock/);assert.equal(f.apiCalls.length,0);
});
test('two independent runners sharing a Web-Lock-compatible exclusive gate never claim concurrently',async()=>{
    let locked=false,releaseRead,readStarted;const entered=new Promise(resolve=>{readStarted=resolve;});
    const withLock=async work=>{if(locked)throw new Error('Another tab');locked=true;try{return await work();}finally{locked=false;}};
    const a=harness({saveAllowed:false,withLock,afterReadHook:async()=>{readStarted();await new Promise(resolve=>{releaseRead=resolve;});}}),b=harness({withLock});
    const first=a.runner.runOne('preview');await entered;await assert.rejects(b.runner.runOne('test'),/Another tab/);assert.equal(b.apiCalls.length,0);assert.equal(b.bridgeCalls.length,0);
    releaseRead();await first;assert.equal(locked,false);
});

function fakeWindow(){
    const listeners=new Set(),sent=[];
    const target={location:{origin:'https://wms.corely.cc'},addEventListener(type,fn){assert.equal(type,'message');listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);},postMessage(data,origin){sent.push({data,origin});}};
    return {target,sent,emit(data,overrides={}){for(const listener of listeners)listener({source:target,origin:target.location.origin,data,...overrides});}};
}
test('bridge ignores forged origin, source, nonce, direction, type and request ID',async()=>{
    const f=fakeWindow(),bridge=createAssistantBridge({target:f.target,random:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),randomUUID},timeoutMs:1000});
    let resolved=false;const promise=bridge.request('PING').then(value=>{resolved=true;return value;});
    const request=f.sent[0].data,reply={...request,direction:'extension-to-page',type:'RESULT',payload:{ok:true,result:{ready:true}}};
    for(const [data,event]of [[reply,{origin:'https://attacker.invalid'}],[reply,{source:{}}],[{...reply,nonce:'forged'},{}],[{...reply,direction:'page-to-extension'},{}],[{...reply,type:'SAVE_PLAN'},{}],[{...reply,requestId:randomUUID()},{}]])f.emit(data,event);
    await Promise.resolve();assert.equal(resolved,false);f.emit(reply);assert.deepEqual(await promise,{ready:true});assert.equal(f.sent[0].origin,'https://wms.corely.cc');bridge.close();
});
test('bridge timeout, close and explicit extension error fail closed',async()=>{
    const f=fakeWindow(),bridge=createAssistantBridge({target:f.target,random:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),randomUUID},timeoutMs:10});
    await assert.rejects(bridge.request('PING'),{code:'EXTENSION_TIMEOUT'});
    const failed=bridge.request('READ_DOCUMENT');const request=f.sent.at(-1).data;
    f.emit({...request,direction:'extension-to-page',type:'RESULT',payload:{ok:false,errorCode:'TEMPORARY_DRAFT'}});await assert.rejects(failed,{code:'TEMPORARY_DRAFT'});
    const pending=bridge.request('PING');bridge.close();await assert.rejects(pending,/助手連線已關閉/);await assert.rejects(bridge.request('SAVE_PLAN'),/助手連線已關閉/);
});
test('bridge enforces UTF8 byte bounds and rejects circular payloads before postMessage',async()=>{
    const f=fakeWindow(),bridge=createAssistantBridge({target:f.target,random:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),randomUUID},timeoutMs:10});
    await assert.rejects(bridge.request('PREVIEW_PLAN',{metadata:'箱'.repeat(70000)}),/超過助手上限/);assert.equal(f.sent.length,0);
    const circular={};circular.self=circular;await assert.rejects(bridge.request('PREVIEW_PLAN',circular),/格式無效/);assert.equal(f.sent.length,0);bridge.close();
});
