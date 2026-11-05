import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL } from '../src/policy.mjs';
import { fingerprint,businessSnapshot } from '../src/engine.mjs';
import { voucher } from '../fixtures/native-cas-adapter.mjs';

const jobId='11111111-1111-4111-8111-111111111111',nonce='a'.repeat(32);
async function setup(){
  const stores={local:new Map(),session:new Map()},listeners={},operations=[];
  const tabs=new Map([[1,{id:1}],[2,{id:2,url:'https://loginib.ecount.com/ec56/view/erp'}]]);
  let snapshot=voucher(),duringInjection=null,afterIntent=null;
  const storage=kind=>({
    get:async key=>key===null?Object.fromEntries(stores[kind]):{[key]:structuredClone(stores[kind].get(key))},
    set:async value=>{for(const [key,item]of Object.entries(value)){stores[kind].set(key,structuredClone(item));if(kind==='local'&&key===`receipt:1:${jobId}`&&item.state==='saving')await afterIntent?.();}},
    remove:async key=>{stores[kind].delete(key);}
  });
  globalThis.chrome={runtime:{id:'test-extension',onMessage:{addListener:fn=>listeners.message=fn}},storage:{local:storage('local'),session:storage('session')},tabs:{get:async id=>tabs.get(id),query:async()=>[tabs.get(2)],onRemoved:{addListener:fn=>listeners.removed=fn},onUpdated:{addListener:fn=>listeners.updated=fn}},scripting:{executeScript:async({args})=>{
    const operation=args[0].operation;operations.push(operation);await duringInjection?.(operation);
    return [{documentId:'erp-document-1',result:operation==='probe'?{ok:true,diagnostic:{recognizedTitle:true,formId:'original-form',capabilities:{loggedIn:true,existingVoucher:true,identityLocked:true,atomicMetadataOnlyUpdate:false,optimisticConcurrency:false,versionToken:snapshot.versionToken,acceptanceTestExclusiveDocument:true,testMetadataMaxLength:200}}}:{ok:true,snapshot:structuredClone(snapshot),uiEvidence:{formId:'original-form'},capabilities:{loggedIn:true}}}];
  }}};
  const source={id:'test-extension',tab:tabs.get(1),frameId:0,documentId:'controller-document-1',url:'https://wms.corely.cc/settings/ecount-assistant'};
  const send=(type,payload={})=>new Promise(resolve=>listeners.message({channel:CHANNEL,nonce,requestId:crypto.randomUUID(),type,payload},source,resolve));
  const popup=payload=>new Promise(resolve=>listeners.message(payload,{id:'test-extension',url:'chrome-extension://test-extension/popup.html'},resolve));
  await import(`../src/service-worker.mjs?binding-race=${crypto.randomUUID()}`);
  await send('HELLO',{actorId:1});await popup({type:'POPUP_BIND',controllerTabId:1});operations.length=0;
  const plan={schemaVersion:1,companyCode:snapshot.companyCode,voucherNumber:snapshot.voucherNumber,businessFingerprint:await fingerprint(businessSnapshot(snapshot)),expectedVersionToken:snapshot.versionToken,metadataFieldLabel:'WMS箱號明細',rows:[{rowId:'line-1',itemCode:'TEST-PRODUCT',expectedQuantity:'25',metadata:'TEST-BOX 25'}],mode:'test',testWriteEnabled:true,saveAllowed:true,acceptanceProof:null};
  const planFingerprint=await fingerprint(plan);
  const permit={saveAllowed:true,testSaveAllowed:true,mode:'test',testWriteEnabled:true,companyCode:snapshot.companyCode,voucherNumber:snapshot.voucherNumber,jobId,planFingerprint,expiresAt:Date.now()+60000};
  return {stores,operations,send,popup,plan,planFingerprint,permit,onInjection:fn=>duringInjection=fn,onIntent:fn=>afterIntent=fn};
}

test('a rebind to the same actor/document invalidates an in-flight read and does not return stale ERP data',async()=>{
  const s=await setup();
  s.onInjection(operation=>{if(operation==='read'){const current=s.stores.session.get('operatorBinding');s.stores.session.set('operatorBinding',{...current,bindingId:crypto.randomUUID()});}});
  const result=await s.send('READ_DOCUMENT',{companyCode:s.plan.companyCode,voucherNumber:s.plan.voucherNumber});
  assert.deepEqual(result,{ok:false,errorCode:'BIND_ECOUNT_TAB_FIRST'});
  assert.deepEqual(s.operations,['read']);delete globalThis.chrome;
});

test('rebind during apply capabilities rejects before intent and never injects a save',async()=>{
  const s=await setup();
  assert.equal((await s.send('PREVIEW_PLAN',{jobId,plan:s.plan,planFingerprint:s.planFingerprint})).ok,true);s.operations.length=0;
  s.onInjection(operation=>{if(operation==='probe'){const current=s.stores.session.get('operatorBinding');s.stores.session.set('operatorBinding',{...current,bindingId:crypto.randomUUID()});}});
  const result=await s.send('SAVE_PLAN',{jobId,planFingerprint:s.planFingerprint,permit:s.permit});
  assert.deepEqual(result,{ok:true,result:{outcome:'not_attempted',saveAttempted:false,errorCode:'BIND_ECOUNT_TAB_FIRST'}});
  assert.equal(s.stores.local.has(`receipt:1:${jobId}`),false);assert.deepEqual(s.operations,['probe']);delete globalThis.chrome;
});

test('unbind after durable intent stops the next injection and preserves uncertain recovery instead of claiming no attempt',async()=>{
  const s=await setup();
  assert.equal((await s.send('PREVIEW_PLAN',{jobId,plan:s.plan,planFingerprint:s.planFingerprint})).ok,true);s.operations.length=0;
  s.onIntent(()=>s.stores.session.delete('operatorBinding'));
  const result=await s.send('SAVE_PLAN',{jobId,planFingerprint:s.planFingerprint,permit:s.permit});
  assert.deepEqual(result,{ok:true,result:{outcome:'uncertain',errorCode:'BIND_ECOUNT_TAB_FIRST'}});
  assert.equal(s.stores.local.get(`receipt:1:${jobId}`).state,'uncertain');
  assert.deepEqual(s.operations,['probe','read']);assert.equal(s.operations.includes('save'),false);delete globalThis.chrome;
});

test('popup cannot rebind, unbind or verify company during an in-flight run and start a concurrent writer',async()=>{
  const s=await setup(),original=structuredClone(s.stores.session.get('operatorBinding'));
  s.onInjection(async operation=>{
    if(operation!=='read')return;
    for(const type of ['POPUP_BIND','POPUP_UNBIND','POPUP_VERIFY_COMPANY'])assert.deepEqual(await s.popup({type,controllerTabId:1}),{ok:false,errorCode:'ASSISTANT_BUSY'});
  });
  assert.equal((await s.send('READ_DOCUMENT',{companyCode:s.plan.companyCode,voucherNumber:s.plan.voucherNumber})).ok,true);
  assert.deepEqual(s.stores.session.get('operatorBinding'),original);
  assert.equal((await s.popup({type:'POPUP_UNBIND'})).ok,true);
  assert.equal(s.stores.session.has('operatorBinding'),false);delete globalThis.chrome;
});

test('a popup mutation holds its lock across native scripting awaits so a run cannot start with the old binding',async()=>{
  const s=await setup();let release,entered;
  const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  s.onInjection(async operation=>{if(operation==='probe'){entered();await gate;}});
  const binding=s.popup({type:'POPUP_BIND',controllerTabId:1});await ready;
  assert.deepEqual(await s.send('READ_DOCUMENT',{companyCode:s.plan.companyCode,voucherNumber:s.plan.voucherNumber}),{ok:false,errorCode:'ASSISTANT_BUSY'});
  assert.deepEqual(await s.popup({type:'POPUP_UNBIND'}),{ok:false,errorCode:'ASSISTANT_BUSY'});
  release();assert.equal((await binding).ok,true);s.onInjection(null);
  assert.equal((await s.send('READ_DOCUMENT',{companyCode:s.plan.companyCode,voucherNumber:s.plan.voucherNumber})).ok,true);delete globalThis.chrome;
});
