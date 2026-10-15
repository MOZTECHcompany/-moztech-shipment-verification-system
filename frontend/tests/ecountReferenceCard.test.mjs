import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as helpers from '../src/utils/ecountReference.mjs';
import * as scan from '../src/utils/cartonScan.js';

const source=await readFile(new URL('../src/components/EcountReferenceCard.jsx',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'jsx',format:'cjs'});
function page({role='dispatcher',storage=new Map(),emptyOrder=false}={}) {
    const hooks=[],effects=[],reads=[],posts=[],copied=[],toasts=[];let cursor=0,dirty=false,tree,mounted=true,afterUnmount=0,session='session-7';
    let user={id:7,role,name:'Clerk'},orderData=emptyOrder?{order:null}:{order:{id:11,status:'completed'},stateToken:'a'.repeat(64)};
    const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
    const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]={value:typeof initial==='function'?initial():initial};return[hooks[index].value,value=>{if(!mounted)afterUnmount++;const next=typeof value==='function'?value(hooks[index].value):value;if(next!==hooks[index].value){hooks[index].value=next;dirty=true;}}];},
        useRef(initial){const index=cursor++;return hooks[index]||={current:initial};},
        useCallback(fn,deps){const index=cursor++;if(!hooks[index]||!same(hooks[index].deps,deps))hooks[index]={fn,deps};return hooks[index].fn;},
        useEffect(fn,deps){const index=cursor++;if(!hooks[index]||!same(hooks[index].deps,deps)){const cleanup=hooks[index]?.cleanup;hooks[index]={deps};effects.push(()=>{cleanup?.();hooks[index].cleanup=fn();});}}
    };
    const deferred=(bucket,fields)=>new Promise((resolve,reject)=>bucket.push({...fields,resolve:data=>resolve({data}),reject}));
    const api={getSessionIdentity:()=>session,get:(url,options)=>deferred(reads,{url,options}),post:(url,body,options)=>deferred(posts,{url,body,options})};
    const imports={react,'@/api/api':api,'@/utils/cartonScan':scan,'@/utils/ecountReference.mjs':helpers,'@/ui':{Button:'Button'},'./CartonDialog':{CartonDialog:'CartonDialog'},sonner:{toast:{success:message=>toasts.push({kind:'success',message}),info:message=>toasts.push({kind:'info',message})}}};
    const generic=new Proxy({}, {get:(_,key)=>key==='__esModule'?false:String(key)}),module={exports:{}};
    vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports[name]||generic,React:react,crypto:webcrypto,console,navigator:{clipboard:{writeText:async text=>copied.push(text)}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
    const render=()=>{for(let index=0;index<20;index++){cursor=0;dirty=false;tree=module.exports.EcountReferenceCard({orderData,user});while(effects.length)effects.shift()();if(!dirty)return tree;}throw Error('render did not settle');};
    const children=node=>node&&typeof node==='object'?[...(node.props?.children||[]).flat(Infinity),node.props?.footer]:[];
    const find=(node,predicate)=>{if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of children(node)){const found=find(child,predicate);if(found)return found;}};
    const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):children(node).map(text).join(' ');
    const button=name=>find(render(),node=>['button','Button'].includes(node.type)&&text(node).trim()===name);
    const input=name=>find(render(),node=>['input','textarea'].includes(node.type)&&node.props['aria-label']===name);
    const settle=async()=>{for(let index=0;index<15;index++)await Promise.resolve();return render();};
    const unmount=()=>{mounted=false;for(const hook of hooks)hook?.cleanup?.();};
    render();return{render,find,text,button,input,reads,posts,storage,copied,toasts,settle,unmount,afterUnmount:()=>afterUnmount,updateOrder:value=>{orderData=value;render();},updateToken:token=>{orderData={...orderData,stateToken:token};render();},updateRole:value=>{user={...user,role:value};render();},changeSession:value=>{session=value;}};
}
const dto=(overrides={})=>({orderId:11,wmsVoucherNumber:'WT-11',shipmentReference:'WMS-11',fingerprint:'a'.repeat(64),ready:true,blockers:[],rows:[{allocationId:1,cartonId:'N1',cartonLineId:1,orderItemId:3,itemCode:'00123',quantity:2,actualSN:[]}],looseRows:[],totals:[{itemCode:'00123',quantity:2,boxedQuantity:2,looseQuantity:0,actualSN:[]}],cartonSummary:[{cartonId:'N1',quantity:2}],reference:null,status:'unlinked',canManage:true,history:[],...overrides});
const response=request=>dto({commandId:request.body.commandId,replayed:false,status:request.body.confirmation?'manual_checked':'reference_only',reference:{companyCode:request.body.companyCode,voucherNumber:request.body.voucherNumber,revision:1,confirmedFingerprint:request.body.confirmation?'a'.repeat(64):null}});
const load=async(view,data=dto())=>{view.reads.at(-1).resolve(data);await view.settle();};
const open=async(view,data=dto())=>{view.button('銷貨單核對').props.onClick();await load(view,data);};
const identify=view=>{view.input('ECOUNT公司代碼').props.onChange({target:{value:'COMPANY-01'}});view.input('原ECOUNT銷貨單號').props.onChange({target:{value:'2026/10/15-1'}});};

test('reference-only saving records an explicit company/document, never guesses a voucher or pre-fills external evidence',async()=>{
 const view=page();await load(view);await open(view);
 assert.equal(view.input('原ECOUNT銷貨單號').props.value,'');assert.equal(view.input('ECOUNT原單明細').props.value,'');
 identify(view);const save=view.button('儲存單號').props.onClick;save();save();assert.equal(view.posts.length,1);
 const request=view.posts[0];assert.equal(request.body.confirmation,null);assert.equal(request.body.companyCode,'COMPANY-01');assert.equal(request.body.expectedActorId,7);
 assert.equal(JSON.parse(view.storage.get(helpers.pendingEcountReferenceKey(7,11))).commandId,request.body.commandId,'recovery is durable before POST returns');
 request.resolve(response(request));await view.settle();assert.equal(view.storage.size,0);assert.match(view.text(view.render()),/待人工核對/);
});

test('manual checking requires external TSV and both acknowledgments; submitted identities stay literal',async()=>{
 const view=page();await load(view);await open(view);identify(view);
 view.button('儲存人工核對').props.onClick();assert.equal(view.posts.length,0);
 view.input('已存在原ECOUNT銷貨單').props.onChange({target:{checked:true}});view.input('已補箱號且不重複扣庫').props.onChange({target:{checked:true}});
 view.button('儲存人工核對').props.onClick();assert.equal(view.posts.length,0,'WMS rows must never become external evidence');
 view.input('ECOUNT原單明細').props.onChange({target:{value:'品項\t數量\t序號/批號\n00123\t2.00\t'}});
 view.button('儲存人工核對').props.onClick();const request=view.posts[0];assert.equal(request.body.confirmation.kind,'manual-line-check');assert.deepEqual(JSON.parse(JSON.stringify(request.body.confirmation.lines)),[{itemCode:'00123',quantity:2}]);
 request.resolve(response(request));await view.settle();assert.match(view.text(view.render()),/已人工核對/);assert.doesNotMatch(view.text(view.render()),/回寫成功|官方驗證/);
});

test('refresh during an unresolved POST restores and retries only the original command/body',async()=>{
 const storage=new Map(),first=page({storage});await load(first);await open(first);identify(first);first.button('儲存單號').props.onClick();
 const request=first.posts[0],body=JSON.parse(JSON.stringify(request.body));first.unmount();
 const fresh=page({storage});await load(fresh);await open(fresh);assert.equal(fresh.input('ECOUNT公司代碼').props.disabled,true);assert.ok(fresh.button('重新確認原操作'));
 fresh.button('重新確認原操作').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(fresh.posts[0].body)),body);
 fresh.posts[0].resolve(response(fresh.posts[0]));await fresh.settle();assert.equal(storage.size,0);
 request.reject(new Error('abandoned browser response'));await Promise.resolve();assert.equal(first.afterUnmount(),0);
});

test('ordinary scan changes do not add per-scan GET traffic and cannot confirm using an old snapshot',async()=>{
 const view=page();await load(view);await open(view);identify(view);const count=view.reads.length;
 view.updateToken('b'.repeat(64));assert.equal(view.reads.length,count);assert.match(view.text(view.render()),/內容已更新/);assert.equal(view.button('儲存單號').props.disabled,true);
 view.button('儲存單號').props.onClick();assert.equal(view.posts.length,0);
});

test('fresh read-only permission and changed roles suppress writes and discard late responses from the old session',async()=>{
 const readOnly=page({role:'picker'});await load(readOnly,dto({canManage:false}));assert.equal(readOnly.button('銷貨單核對'),undefined);assert.equal(readOnly.button('儲存人工核對'),undefined);
 const view=page();const original=view.reads[0];view.updateRole('picker');original.resolve(dto());await view.settle();assert.equal(view.button('銷貨單核對'),undefined);
 view.reads.at(-1).resolve(dto({canManage:false}));await view.settle();assert.match(view.text(view.render()),/未綁定/);
});

test('blockers and legacy reference warnings stay visible, and changing an existing original document needs a reason',async()=>{
 const data=dto({ready:false,status:'reference_only',reference:{companyCode:'COMPANY-01',voucherNumber:'OLD',revision:2},blockers:[{code:'NOT_READY',message:'尚未完成裝箱'}],referenceWarning:'來源回執待核對'});
 const view=page();await load(view,data);await open(view,data);assert.match(view.text(view.render()),/來源回執待核對/);assert.match(view.text(view.render()),/尚未完成裝箱/);assert.equal(view.button('儲存人工核對').props.disabled,true);
 view.input('原ECOUNT銷貨單號').props.onChange({target:{value:'NEW'}});view.button('儲存單號').props.onClick();assert.equal(view.posts.length,0);assert.match(view.text(view.render()),/變更原因/);
 view.input('核對變更原因').props.onChange({target:{value:'原單號更正'}});view.button('儲存單號').props.onClick();assert.equal(view.posts[0].body.expectedRevision,2);view.posts[0].resolve(response(view.posts[0]));await view.settle();
});

test('definite server rejection keeps its explanation, clears pending state and never replaces the external evidence',async()=>{
 const view=page();await load(view);await open(view);identify(view);view.input('ECOUNT原單明細').props.onChange({target:{value:'00123\t2'}});
 view.input('已存在原ECOUNT銷貨單').props.onChange({target:{checked:true}});view.input('已補箱號且不重複扣庫').props.onChange({target:{checked:true}});view.button('儲存人工核對').props.onClick();
 view.posts[0].reject({response:{status:409,data:{message:'原單範圍與實際出貨不一致'}}});await view.settle();view.reads.at(-1).resolve(dto());await view.settle();
 assert.equal(view.storage.size,0);assert.match(view.text(view.render()),/原單範圍與實際出貨不一致/);assert.equal(view.input('ECOUNT原單明細').props.value,'00123\t2');assert.equal(view.posts.length,1);
});

test('replaying an original command displays the latest changed status rather than a stale artificial confirmation',async()=>{
 const view=page();await load(view);await open(view);identify(view);view.button('儲存單號').props.onClick();const request=view.posts[0];
 request.reject(new Error('lost reply'));await view.settle();view.button('重新確認原操作').props.onClick();
 const retry=view.posts[1];retry.resolve({...response(retry),status:'changed',fingerprint:'b'.repeat(64),reference:{...response(retry).reference,confirmedFingerprint:'a'.repeat(64)}});await view.settle();
 assert.match(view.text(view.render()),/內容有變，待重新核對/);assert.equal(view.storage.size,0);assert.equal(view.posts.length,2);assert.equal(retry.body.commandId,request.body.commandId);
});

test('read-only reconciliation displays loose items alongside physical boxes without inventing a carton identity',async()=>{
 const view=page({role:'packer'});await load(view,dto({canManage:false,looseRows:[{orderItemId:4,itemCode:'LOOSE-ONLY',productName:'散件商品',quantity:3,actualSN:[]}],totals:[{itemCode:'00123',quantity:2},{itemCode:'LOOSE-ONLY',quantity:3}]}));
 const content=view.text(view.render());assert.match(content,/N1/);assert.match(content,/未使用箱號/);assert.match(content,/散件商品/);assert.match(content,/5.*件/);assert.equal(view.button('銷貨單核對'),undefined);
});

test('saving an unchanged document is a no-op and cannot clear a prior manual check or changed warning',async()=>{
 for(const status of ['manual_checked','changed']) {
  const data=dto({status,reference:{companyCode:'COMPANY-01',voucherNumber:'2026/10/15-1',revision:2,confirmedFingerprint:'a'.repeat(64)}});
  const view=page();await load(view,data);await open(view,data);assert.equal(view.button('儲存單號').props.disabled,true);view.button('儲存單號').props.onClick();assert.equal(view.posts.length,0);assert.equal(view.storage.size,0);
  view.input('原ECOUNT銷貨單號').props.onChange({target:{value:'2026 . 10 . 15 - 0001'}});assert.equal(view.button('儲存單號').props.disabled,true);view.button('儲存單號').props.onClick();assert.equal(view.posts.length,0);
 }
});

test('restored external evidence shows every literal SN while retry keeps the original grouped command unchanged',async()=>{
 const body={commandId:webcrypto.randomUUID(),expectedActorId:7,expectedRevision:0,expectedFingerprint:'a'.repeat(64),companyCode:'COMPANY-01',voucherNumber:'2026/10/15-1',confirmation:{kind:'manual-line-check',lines:[{itemCode:'00123',quantity:2,actualSN:['00-a','00-A']}],acknowledgeExistingSales:true,acknowledgeMetadataSaved:true}};
 const view=page({storage:new Map([[helpers.pendingEcountReferenceKey(7,11),JSON.stringify(body)]])});await load(view);await open(view);
 assert.equal(view.input('ECOUNT原單明細').props.value,'00123\t1\t00-a\n00123\t1\t00-A');view.button('重新確認原操作').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(view.posts[0].body)),body);
 view.posts[0].resolve(response(view.posts[0]));await view.settle();assert.equal(view.storage.size,0);
});

test('large external paste is not silently cut and all 1040 user-provided SN rows reach the original command',async()=>{
 const view=page();await load(view);await open(view);identify(view);assert.equal(view.input('ECOUNT原單明細').props.maxLength,undefined);
 const input=Array.from({length:1040},(_,index)=>`00123\t1\t000Vendor-${String(index).padStart(4,'0')}`).join('\n');view.input('ECOUNT原單明細').props.onChange({target:{value:input}});
 view.input('已存在原ECOUNT銷貨單').props.onChange({target:{checked:true}});view.input('已補箱號且不重複扣庫').props.onChange({target:{checked:true}});view.button('儲存人工核對').props.onClick();
 const request=view.posts[0];assert.equal(request.body.confirmation.lines.length,1040);assert.equal(request.body.confirmation.lines.at(-1).actualSN[0],'000Vendor-1039');
 request.resolve(response(request));await view.settle();assert.equal(view.storage.size,0);
});

test('pending command recovery waits for the real order snapshot instead of reading only the initial undefined identity',async()=>{
 const body={commandId:webcrypto.randomUUID(),expectedActorId:7,expectedRevision:0,expectedFingerprint:'a'.repeat(64),companyCode:'COMPANY-01',voucherNumber:'2026/10/15-1',confirmation:null};
 const view=page({emptyOrder:true,storage:new Map([[helpers.pendingEcountReferenceKey(7,11),JSON.stringify(body)]])});assert.equal(view.reads.length,0);
 view.updateOrder({order:{id:11,status:'completed'},stateToken:'a'.repeat(64)});await load(view);assert.match(view.text(view.render()),/上次操作待確認/);await open(view);
 view.button('重新確認原操作').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(view.posts[0].body)),body);view.posts[0].resolve(response(view.posts[0]));await view.settle();assert.equal(view.storage.size,0);
});

test('a fresh login can confirm the original pending command while an old session rejection cannot clear its durable recovery',async()=>{
 const view=page();await load(view);await open(view);identify(view);view.button('儲存單號').props.onClick();const old=view.posts[0];
 view.changeSession('session-fresh');view.updateRole('dispatcher');await load(view);await open(view);view.button('重新確認原操作').props.onClick();const retry=view.posts[1];
 old.reject({response:{status:403,data:{message:'old session rejected'}}});await view.settle();assert.equal(JSON.parse(view.storage.get(helpers.pendingEcountReferenceKey(7,11))).commandId,retry.body.commandId);assert.equal(view.button('重新確認原操作').props.disabled,true);
 retry.resolve(response(retry));await view.settle();assert.equal(view.storage.size,0);assert.equal(retry.body.commandId,old.body.commandId);
});

test('canonical no-op responses preserve the server status without announcing a newly saved manual confirmation',async()=>{
 for(const status of ['manual_checked','changed']) {
  const body={commandId:webcrypto.randomUUID(),expectedActorId:7,expectedRevision:2,expectedFingerprint:'a'.repeat(64),companyCode:'COMPANY-01',voucherNumber:'2026 . 10 . 15 - 0001',confirmation:null};
  const data=dto({status,reference:{companyCode:'COMPANY-01',voucherNumber:'2026/10/15-1',revision:2,confirmedFingerprint:'a'.repeat(64)}});
  const view=page({storage:new Map([[helpers.pendingEcountReferenceKey(7,11),JSON.stringify(body)]])});await load(view,data);await open(view,data);view.button('重新確認原操作').props.onClick();
  view.posts[0].resolve({...data,commandId:body.commandId,replayed:true,unchanged:true});await view.settle();assert.equal(view.storage.size,0);
  assert.equal(view.toasts.at(-1).kind,'info');assert.equal(view.toasts.at(-1).message,status==='changed'?'原單未變更，內容仍待重新核對':'原單未變更');assert.equal(view.toasts.some(toast=>toast.message==='已保存人工核對紀錄'),false);
 }
});
