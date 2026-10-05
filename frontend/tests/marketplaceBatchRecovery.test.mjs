import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as intake from '../src/utils/marketplaceIntake.mjs';
import {buildUnifiedConversion} from '../src/utils/unifiedMarketplace.mjs';

const source=await readFile(new URL('../src/components/admin/MarketplaceBatchManager.jsx',import.meta.url),'utf8');
const rows=[
 ['Name','Lineitem quantity','Lineitem sku','Lineitem name','Lineitem price','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount'],
 ['#SYN-ORIGINAL',2,'00123','Local product A',100,'paid','unfulfilled','TWD',200,0,0,200,0,0],
 ['#SYN-OTHER',1,'00124','Local product B',50,'paid','unfulfilled','TWD',50,0,0,50,0,0],
];
const settings={store:'Local Store',customerCode:'00020',customerName:'Local Customer',warehouseCode:'003',date:'2026-10-05',batchSequence:'1',batchNumber:'TEST-RECOVERY',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,skuMappings:{'00123':{erpSku:'00123',erpName:'Local product A',barcode:'00123',confirmed:true,barcodeConfirmed:true},'00124':{erpSku:'00124',erpName:'Local product B',barcode:'00124',confirmed:true,barcodeConfirmed:true}}};
const converted=buildUnifiedConversion(rows,settings);
const originalShipping={recipient:'Local recipient',phone:'0900000000',address:'Local address 1',postalCode:'00100',method:'超商取貨付款',storeName:'Local store',storeCode:'000123',trackingNumber:'',note:'Local note',paymentCard:'PRIVATE_CARD'};
const currentShipping={...originalShipping,phone:'0900000001',address:'Local address 2',storeCode:'000456'};
const fixture={id:19,batchNumber:settings.batchNumber,platform:'Shopify',store:settings.store,createdAt:'2026-10-05T01:00:00.000Z',archivedAt:null,settings:converted.effectiveSettings,orders:converted.parsed.orders.map((order,index)=>({...order,shipping:index?{recipient:'Other recipient',address:'Other address'}:originalShipping})),items:converted.parsed.items,headers:converted.output.headers,rows:converted.output.rows,summary:converted.output.summary,prepick:converted.prepick,financials:intake.prepareEcountFinancials({headers:converted.output.headers,rows:converted.output.rows,settings:converted.effectiveSettings,orders:converted.parsed.orders,items:converted.parsed.items,summary:converted.output.summary}).financials,links:[]};
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const apiError=message=>Object.assign(Error(message),{response:{data:{message}}});

// Real component callbacks, real accounting snapshot, and local API responses.
// No server, database, platform credentials, or real orders are used.
async function manager({params='batch=19&order=%23SYN-ORIGINAL',record=fixture,getWait=null,postResponder=null,changed=true}={}){
 const {code}=await transform(source,{loader:'jsx',format:'cjs'});
 const hooks=[],effects=[],requests=[],scrolls=[],records=new Map([[19,structuredClone(record)],[20,{...structuredClone(record),id:20,batchNumber:'SYN-SECOND'}]]);
 let query=new URLSearchParams(params),cursor=0,dirty=false,tree,mounted=true,sessionValid=true,lateUpdates=0;
 let props={enabled:true,currentSession:()=>sessionValid,refreshKey:0,user:{id:7,role:'dispatcher'}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{if(!mounted)lateUpdates++;const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];},
  useRef(initial){const i=cursor++;return hooks[i]||=( {current:initial});},
  useEffect(callback,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){const cleanup=hooks[i]?.cleanup;hooks[i]={deps};effects.push(()=>{cleanup?.();hooks[i].cleanup=callback();});}},
 };
 const api={
  get:async(url,options)=>{
   requests.push({method:'get',url,options});if(getWait)await getWait(url);
   if(url==='/api/marketplace-intakes')return {data:{intakes:[],facets:[],total:0,orders:0,pageSize:20}};
   if(url.startsWith('/api/warehouse-intakes/'))return {data:{flow:{erp_confirmed_at:null}}};
   const id=Number(url.split('/').at(-1));return {data:structuredClone(records.get(id))};
  },
  post:async(url,body)=>{
   requests.push({method:'post',url,body});if(postResponder)return await postResponder(url,body,records);
   const id=Number(url.split('/')[3]);
   if(url.endsWith('/shipping-preview'))return {data:{intakeId:id,orderNumber:body.orderNumber,previousShipping:structuredClone(records.get(id).orders.find(order=>order.sourceOrderNumber===body.orderNumber).shipping),currentShipping,changed,previewFingerprint:'current-contact-preview',sourceFingerprint:'original-source'}};
   if(url.endsWith('/shipping-update')){records.get(id).orders.find(order=>order.sourceOrderNumber===body.orderNumber).shipping=structuredClone(currentShipping);return {data:{ok:true,intakeId:id,orderNumber:body.orderNumber,updated:true}};}
   throw Error(`Unexpected POST ${url}`);
  },
  patch:async()=>{throw Error('Recovery must not archive or restore');},
  delete:async()=>{throw Error('Recovery must not delete orders');},
 };
 const imports={react,'react-router-dom':{Link:'Link',useSearchParams:()=>[query,(update)=>{query=typeof update==='function'?update(new URLSearchParams(query)):new URLSearchParams(update);dirty=true;}]},'lucide-react':{},'../../ui':{Button:'Button'},'@/api/api.js':api,'../../utils/marketplaceIntake.mjs':intake,'../../api/origin':{API_ORIGIN:''},'./AdminDashboard':{AdminDashboard:'AdminDashboard'}};
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in imports))throw Error(`Unexpected import ${name}`);return imports[name];},console,crypto:webcrypto,document:{createElement(){throw Error('Recovery must not download sales');}},Object});
 const expand=node=>{
  if(Array.isArray(node))return node.map(expand);if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function')return expand(node.type(node.props));
  if(node.props?.ref)node.props.ref.current={scrollIntoView:()=>scrolls.push(node.props['aria-label']||node.props.id),showModal(){},close(){}};
  return {...node,props:{...node.props,children:(node.props?.children||[]).map(expand)}};
 };
 const render=()=>{if(!mounted)return tree;for(let i=0;i<15;i++){cursor=0;dirty=false;tree=expand(module.exports.default(props));while(effects.length)effects.shift()();if(!dirty)return tree;}throw Error('Render did not settle');};
 const text=node=>Array.isArray(node)?node.map(text).join(' '):node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):text(node.props?.children||[]);
 const find=(node,predicate)=>{if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return;}if(!node||typeof node!=='object')return;if(predicate(node))return node;return find(node.props?.children||[],predicate);};
 const all=predicate=>{const result=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;if(predicate(node))result.push(node);walk(node.props.children);};walk(render());return result;};
 const order=(number='#SYN-ORIGINAL')=>find(render(),node=>node.props?.['aria-label']===`商城訂單 ${number}`);
 const button=(label,number)=>find(number?order(number):render(),node=>node.type==='Button'&&text(node).includes(label));
 const flush=async()=>{for(let i=0;i<15;i++){await Promise.resolve();render();}};
 render();await flush();
 return {render,text,find,all,order,button,requests,scrolls,records,flush,navigate(value){query=new URLSearchParams(value);render();},setSession(value){sessionValid=value;},setProps(value){props={...props,...value};render();},query:()=>query,unmount(){mounted=false;hooks.forEach(h=>h?.cleanup?.());},lateUpdates:()=>lateUpdates};
}
const posts=view=>view.requests.filter(request=>request.method==='post');

test('original order navigation focuses its saved details and shipping without opening the other order',async()=>{
 const view=await manager(),focused=view.order(),other=view.order('#SYN-OTHER');
 assert.equal(focused.props.open,true);assert.match(focused.props.className,/border-blue-500/);assert.match(focused.props.className,/min-w-0/);assert.ok(!other.props.open);
 assert.match(view.text(focused),/Local recipient.*0900000000.*Local address 1.*000123/s);
 assert.doesNotMatch(view.text(focused),/Other recipient|PRIVATE_CARD/);
 assert.match(view.text(other),/Other recipient/);assert.ok(view.scrolls.includes('商城訂單 #SYN-ORIGINAL'));
 assert.equal(posts(view).length,0);assert.ok(view.button('更新收件資料','#SYN-ORIGINAL'));
 const outer=view.all(node=>node.type==='details').find(node=>view.text(node.props.children[0])==='訂單、商品與金額');assert.equal(outer.props.open,true);
 const close=view.find(view.render(),node=>node.type==='button'&&view.text(node).includes('關閉明細'));close.props.onClick();view.render();
 assert.equal(view.query().get('batch'),null);assert.equal(view.query().get('order'),null);
});

test('Shopify contact preview requires an explicit save and reloads the same original record without a sales or task action',async()=>{
 const view=await manager();const before=structuredClone(view.records.get(19));
 await view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.render();
 assert.equal(posts(view).length,1);assert.equal(posts(view)[0].url,'/api/marketplace-intakes/19/orders/shipping-preview');
 assert.deepEqual(JSON.parse(JSON.stringify(posts(view)[0].body)),{orderNumber:'#SYN-ORIGINAL'});
 assert.match(view.text(view.order()),/已保存.*0900000000.*Shopify 最新.*0900000001/s);
 assert.equal(view.records.get(19).orders[0].shipping.phone,'0900000000');
 const save=view.button('保存收件資料','#SYN-ORIGINAL');assert.equal(save.props.disabled,false);
 await save.props.onClick();await view.flush();
 const submitted=posts(view)[1];assert.equal(submitted.url,'/api/marketplace-intakes/19/orders/shipping-update');
 assert.deepEqual(Object.keys(submitted.body).sort(),['commandId','expectedActorId','orderNumber','previewFingerprint']);
 assert.equal(submitted.body.expectedActorId,7);assert.equal(submitted.body.orderNumber,'#SYN-ORIGINAL');assert.equal(submitted.body.previewFingerprint,'current-contact-preview');
 assert.match(submitted.body.commandId,/^[0-9a-f-]{36}$/);
 assert.match(view.text(view.order()),/0900000001.*Local address 2.*收件資料已更新/s);
 assert.equal(view.button('保存收件資料'),undefined);assert.ok(view.button('更新收件資料','#SYN-ORIGINAL'));
 assert.equal(view.requests.filter(r=>r.method==='get'&&r.url==='/api/marketplace-intakes/19').length,2);
 assert.deepEqual(view.records.get(19).items,before.items);assert.deepEqual(view.records.get(19).rows,before.rows);assert.equal(view.records.get(19).batchNumber,before.batchNumber);
 assert.ok(posts(view).every(r=>/\/orders\/shipping-(preview|update)$/.test(r.url)));
});

test('unchanged contact and a business-change error do not offer a save or modify sales',async()=>{
 const unchanged=await manager({changed:false});await unchanged.button('更新收件資料','#SYN-ORIGINAL').props.onClick();unchanged.render();
 assert.match(unchanged.text(unchanged.order()),/收件資料已是最新/);assert.equal(unchanged.button('保存收件資料'),undefined);assert.equal(posts(unchanged).length,1);
 const failed=await manager({postResponder:async()=>{throw apiError('商品或金額已變更，請另行核對');}});
 await failed.button('更新收件資料','#SYN-ORIGINAL').props.onClick();failed.render();
 assert.match(failed.text(failed.order()),/商品或金額已變更/);assert.ok(failed.find(failed.order(),node=>node.props?.role==='alert'));assert.equal(failed.button('保存收件資料'),undefined);assert.ok(failed.button('更新收件資料','#SYN-ORIGINAL'));
 assert.deepEqual(failed.records.get(19).items,fixture.items);
});

test('a second preview click is gated and a late response after batch navigation never displays or applies the old contact',async()=>{
 const wait=defer();const view=await manager({postResponder:async(url,body)=>{await wait.promise;return {data:{intakeId:19,orderNumber:body.orderNumber,previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:'late-preview'}};}});
 const button=view.button('更新收件資料','#SYN-ORIGINAL');const pending=button.props.onClick();const second=button.props.onClick();assert.equal(posts(view).length,1);
 view.navigate('batch=20&order=%23SYN-OTHER');await view.flush();
 await button.props.onClick();assert.equal(posts(view).length,1,'a retained callback cannot request an old batch');
 wait.resolve();await Promise.all([pending,second]);await view.flush();
 assert.equal(view.button('保存收件資料'),undefined);assert.ok(!view.order().props.open);assert.equal(view.order('#SYN-OTHER').props.open,true);
 assert.equal(view.button('更新收件資料','#SYN-OTHER').props.disabled,false,'late requests do not leave the new page busy');
});

test('changing the focused order clears the preview and rejects a retained save callback',async()=>{
 const view=await manager();await view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.render();
 const save=view.button('保存收件資料','#SYN-ORIGINAL');assert.ok(save);
 view.navigate('batch=19&order=%23SYN-OTHER');await save.props.onClick();view.render();
 assert.equal(view.button('保存收件資料'),undefined);assert.equal(posts(view).length,1);assert.equal(view.records.get(19).orders[0].shipping.phone,'0900000000');
});

test('a late original-order save cannot report success or reload details in another batch',async()=>{
 const wait=defer();const view=await manager({postResponder:async(url,body)=>{
  if(url.endsWith('/shipping-preview'))return {data:{intakeId:19,orderNumber:body.orderNumber,previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:'contact-preview'}};
  await wait.promise;return {data:{ok:true,intakeId:19,orderNumber:body.orderNumber,updated:true}};
 }});
 await view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.render();
 const pending=view.button('保存收件資料','#SYN-ORIGINAL').props.onClick();view.navigate('batch=20&order=%23SYN-OTHER');await view.flush();
 wait.resolve();await pending;await view.flush();
 assert.doesNotMatch(view.text(view.render()),/收件資料已更新/);
 assert.equal(view.requests.filter(r=>r.method==='get'&&r.url==='/api/marketplace-intakes/19').length,1);
 assert.equal(view.button('更新收件資料','#SYN-OTHER').props.disabled,false);
});

test('discarding an old preview leaves a newer batch preview locked until its own response finishes',async()=>{
 const old=defer(),next=defer();const view=await manager({postResponder:async(url,body)=>{
  const intakeId=Number(url.split('/')[3]);await(intakeId===19?old.promise:next.promise);
  return {data:{intakeId,orderNumber:body.orderNumber,previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:`contact-${intakeId}`}};
 }});
 const first=view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.navigate('batch=20&order=%23SYN-OTHER');await view.flush();
 const second=view.button('更新收件資料','#SYN-OTHER').props.onClick();view.render();old.resolve();await first;view.render();
 assert.equal(view.button('查詢中…','#SYN-OTHER').props.disabled,true);
 assert.equal(view.button('保存收件資料'),undefined);
 next.resolve();await second;view.render();assert.ok(view.button('保存收件資料','#SYN-OTHER'));assert.equal(posts(view).length,2);
});

test('cancelled or failed shipping review cannot reuse its previous save decision',async()=>{
 const cancelled=await manager();await cancelled.button('更新收件資料','#SYN-ORIGINAL').props.onClick();cancelled.render();
 const oldSave=cancelled.button('保存收件資料','#SYN-ORIGINAL');
 const cancel=cancelled.find(cancelled.order(),node=>node.type==='button'&&cancelled.text(node)==='取消');cancel.props.onClick();await oldSave.props.onClick();cancelled.render();
 assert.equal(posts(cancelled).length,1);assert.equal(cancelled.button('保存收件資料'),undefined);
 const failed=await manager({postResponder:async(url,body)=>{
  if(url.endsWith('/shipping-preview'))return {data:{intakeId:19,orderNumber:body.orderNumber,previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:'contact-preview'}};
  throw apiError('收件資料已變更，請重新查詢');
 }});
 await failed.button('更新收件資料','#SYN-ORIGINAL').props.onClick();failed.render();const failedSave=failed.button('保存收件資料','#SYN-ORIGINAL');
 await failedSave.props.onClick();failed.render();await failedSave.props.onClick();
 assert.equal(posts(failed).length,2);assert.equal(failed.button('保存收件資料'),undefined);assert.match(failed.text(failed.order()),/收件資料已變更/);
 assert.equal(failed.records.get(19).orders[0].shipping.phone,'0900000000');
});

test('unknown apply commit retries the same command and preserves the original sales snapshot',async()=>{
 let attempts=0;
 const view=await manager({postResponder:async(url,body,records)=>{
  if(url.endsWith('/shipping-preview'))return {data:{intakeId:19,orderNumber:body.orderNumber,previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:'contact-preview'}};
  attempts++;
  if(attempts===1){records.get(19).orders[0].shipping=structuredClone(currentShipping);throw Object.assign(Error('Service unavailable'),{response:{status:503,data:{message:'保存結果未確認，請重試。'}}});}
  return {data:{ok:true,intakeId:19,orderNumber:body.orderNumber,updated:true,reused:true}};
 }});
 await view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.render();
 await view.button('保存收件資料','#SYN-ORIGINAL').props.onClick();view.render();
 assert.match(view.text(view.order()),/保存結果未確認，請重試/);
 const retry=view.button('保存收件資料','#SYN-ORIGINAL');assert.ok(retry);assert.equal(retry.props.disabled,false);
 await retry.props.onClick();await view.flush();
 const applies=posts(view).filter(request=>request.url.endsWith('/shipping-update'));
 assert.equal(applies.length,2);assert.equal(applies[0].body.commandId,applies[1].body.commandId);assert.equal(applies[0].body.previewFingerprint,applies[1].body.previewFingerprint);
 assert.match(view.text(view.order()),/0900000001.*收件資料已更新/s);assert.equal(view.button('保存收件資料'),undefined);
 assert.deepEqual(view.records.get(19).rows,fixture.rows);assert.deepEqual(view.records.get(19).items,fixture.items);
});

test('an uncertain save decision is discarded after navigation or a session change',async()=>{
 for(const change of [view=>view.navigate('batch=20&order=%23SYN-OTHER'),view=>{view.setSession(false);view.setProps({enabled:false,user:{id:8,role:'dispatcher'}});}]){
  const view=await manager({postResponder:async(url,body)=>{
   if(url.endsWith('/shipping-preview'))return {data:{intakeId:19,orderNumber:body.orderNumber,previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:'contact-preview'}};
   throw Object.assign(Error('timeout'),{code:'ECONNABORTED'});
  }});
  await view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.render();await view.button('保存收件資料','#SYN-ORIGINAL').props.onClick();view.render();
  const retry=view.button('保存收件資料','#SYN-ORIGINAL');assert.ok(retry);change(view);await retry.props.onClick();view.render();
  assert.equal(view.button('保存收件資料'),undefined);assert.equal(posts(view).length,2);
 }
});

test('account changes reject an existing preview save and discard a late preview after unmount',async()=>{
 const view=await manager();await view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.render();
 const save=view.button('保存收件資料','#SYN-ORIGINAL');view.setSession(false);await save.props.onClick();assert.equal(posts(view).length,1);
 view.setProps({enabled:false,user:{id:8,role:'dispatcher'}});assert.equal(view.button('保存收件資料'),undefined);
 const wait=defer();const late=await manager({postResponder:async(url,body)=>{await wait.promise;return {data:{intakeId:19,orderNumber:body.orderNumber,previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:'late-preview'}};}});
 const pending=late.button('更新收件資料','#SYN-ORIGINAL').props.onClick();late.unmount();wait.resolve();await pending;
 assert.equal(late.lateUpdates(),0);assert.equal(posts(late).length,1);
});

test('invalid server preview identities or a missing confirmation fingerprint never offer a save',async()=>{
 for(const payload of [{intakeId:20},{orderNumber:'#SYN-OTHER'},{previewFingerprint:''},{currentShipping:null}]){
  const view=await manager({postResponder:async()=>({data:{intakeId:19,orderNumber:'#SYN-ORIGINAL',previousShipping:originalShipping,currentShipping,changed:true,previewFingerprint:'valid',...payload}})});
  await view.button('更新收件資料','#SYN-ORIGINAL').props.onClick();view.render();
  assert.equal(view.button('保存收件資料'),undefined);assert.equal(posts(view).length,1);assert.match(view.text(view.order()),/請重新查詢/);
 }
});

test('linked, archived, or other-platform orders never advertise the Shopify contact update action',async()=>{
 for(const record of [{...fixture,links:[{source_order_number:'#SYN-ORIGINAL',order_id:37}]},{...fixture,archivedAt:'2026-10-05T01:00:00Z'},{...fixture,platform:'1Shop'}]){
  const view=await manager({record});assert.equal(view.button('更新收件資料','#SYN-ORIGINAL'),undefined);assert.equal(posts(view).length,0);
 }
});
