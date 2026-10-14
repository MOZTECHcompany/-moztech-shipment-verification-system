import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as editorHelpers from '../src/utils/cartonEditor.js';
import * as scanHelpers from '../src/utils/cartonScan.js';

const source=await readFile(new URL('../src/components/CartonsPage.jsx',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'jsx',format:'cjs'});
function page({role='admin',scope='orders',storage=new Map()}={}) {
    const hooks=[],effects=[],timers=new Map(),reads=[],posts=[];let cursor=0,dirty=false,tree,timerId=0,mounted=true,updatesAfterUnmount=0;
    const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
    const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{if(!mounted)updatesAfterUnmount++;const next=typeof value==='function'?value(hooks[i].value):value;if(next!==hooks[i].value){hooks[i].value=next;dirty=true;}}];},
        useRef(initial){const i=cursor++;return hooks[i]||={current:initial};},
        useCallback(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={fn,deps};return hooks[i].fn;},
        useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){const cleanup=hooks[i]?.cleanup;hooks[i]={deps};effects.push(()=>{cleanup?.();hooks[i].cleanup=fn();});}}
    };
    const deferred=(bucket,fields)=>new Promise((resolve,reject)=>bucket.push({...fields,resolve:data=>resolve({data}),reject}));
    const api={get:(url,options)=>deferred(reads,{url,options}),post:(url,body,options)=>deferred(posts,{url,body,options}),patch:(url,body,options)=>deferred(posts,{url,body,options,method:'PATCH'})};
    const imports={react,'@/api/api':api,'@/utils/cartonScan':scanHelpers,'@/utils/cartonEditor':editorHelpers,'@/ui':{Button:'Button'},'./CartonDialog':{CartonDialog:'CartonDialog'},'./CartonItemEditor':{CartonItemEditor:'CartonItemEditor',cartonFieldClass:'field'},sonner:{toast:{success:()=>{},info:()=>{},error:()=>{}}}};
    const generic=new Proxy({}, {get:(_,key)=>key==='__esModule'?false:String(key)}),module={exports:{}};
    vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports[name]||generic,React:react,crypto:webcrypto,console,
        setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
        sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
    const user={id:7,name:'Manager',role,management_scope:scope};
    const render=()=>{for(let i=0;i<20;i++){cursor=0;dirty=false;tree=module.exports.CartonsPage({user});while(effects.length)effects.shift()();if(!dirty)return tree;}throw new Error('render did not settle');};
    const children=node=>node&&typeof node==='object'?[...(node.props?.children||[]).flat(Infinity),node.props?.footer]:[];
    const find=(node,predicate)=>{if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of children(node)){const result=find(child,predicate);if(result)return result;}};
    const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):children(node).map(text).join(' ');
    const button=name=>find(render(),node=>['button','Button'].includes(node.type)&&text(node).trim()===name);
    const dialog=name=>find(render(),node=>node.type==='CartonDialog'&&node.props.title===name&&node.props.open);
    const line=index=>{let n=0;return find(render(),node=>node.type==='CartonItemEditor'&&n++===index);};
    const input=name=>find(render(),node=>node.type==='input'&&node.props['aria-label']===name);
    const advance=()=>{render();for(const[id,fn]of [...timers]){timers.delete(id);fn();}render();};
    const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();return render();};
    const unmount=()=>{mounted=false;for(const hook of hooks)hook?.cleanup?.();};
    render();return{render,find,text,button,dialog,line,input,reads,posts,storage,advance,settle,unmount,updatesAfterUnmount:()=>updatesAfterUnmount};
}
const saved=(request,status='draft')=>({cartonId:request.body.cartonId,status,contentRevision:1,stateRevision:1,allocations:[],lines:request.body.lines.map((line,i)=>({...line,lineId:i+1,remainingQuantity:line.quantity,remainingSN:line.actualSN}))});
const load=async view=>{view.advance();view.reads.at(-1).resolve({cartons:[]});await view.settle();};
const enterPhysical=view=>{view.button('新增箱號').props.onClick();view.line(0).props.onSelect({itemCode:'SKU-01',productName:'Fixture product',importedBarcode:'00123'});view.line(0).props.onChange({quantity:2});view.button('確認內容').props.onClick();};

test('three-step carton create uses an automatic identity, requires a real count and waits for seal before presenting print',async()=>{
    const view=page();await load(view);view.button('新增箱號').props.onClick();assert.equal(view.line(0).props.line.quantity,'');
    view.button('確認內容').props.onClick();assert.match(view.text(view.render()),/實際數量/);assert.equal(view.posts.length,0);
    view.line(0).props.onSelect({itemCode:'SKU-01',productName:'Fixture product'});view.line(0).props.onChange({quantity:2,hasSerials:true});
    view.line(0).props.onScan('000Vendor-a');view.line(0).props.onScan('000Vendor-A');
    view.button('確認內容').props.onClick();assert.equal(view.posts.length,0);
    const action=view.button('確認建箱並列印').props.onClick,pending=action();await action();
    assert.equal(view.posts.length,1);assert.match(view.posts[0].body.cartonId,/^CTN-/);
    const dispatched=JSON.parse(view.storage.get(editorHelpers.pendingCartonEditorKey(7)));assert.equal(dispatched.editor.id,view.posts[0].body.cartonId);assert.equal(dispatched.editor.unknown,true,'refresh recovery exists before the HTTP response');
    assert.deepEqual(JSON.parse(JSON.stringify(view.posts[0].body.lines[0].actualSN)),['000Vendor-a','000Vendor-A']);
    const record=saved(view.posts[0]);view.posts[0].resolve(record);await view.settle();assert.equal(view.posts.length,2);assert.match(view.posts[1].url,/\/seal$/);assert.equal(view.dialog('箱號貼紙'),undefined);
    view.posts[1].resolve({...record,status:'sealed'});await view.settle();assert.ok(view.dialog('箱號貼紙'));
    view.reads.at(-1).resolve({cartons:[{...record,status:'sealed'}]});await pending;
    assert.equal(view.storage.size,0,'known confirmation clears recovery');
});

test('a failed seal keeps the confirmed draft identity and retries only seal without creating another carton',async()=>{
    const view=page();await load(view);enterPhysical(view);
    const pending=view.button('確認建箱並列印').props.onClick();const record=saved(view.posts[0]);view.posts[0].resolve(record);await view.settle();
    view.posts[1].reject({response:{status:409,data:{message:'Fixture seal conflict'}}});await pending;await view.settle();
    assert.equal(view.dialog('箱號貼紙'),undefined);
    assert.equal(view.storage.size,0,'definite rejection does not leave a pending write');
    const retry=view.button('確認建箱並列印').props.onClick();assert.equal(view.posts.length,3);assert.match(view.posts[2].url,/\/seal$/);
    assert.equal(view.posts.filter(call=>call.url==='/api/cartons').length,1);
    view.posts[2].resolve({...record,status:'sealed'});await view.settle();view.reads.at(-1).resolve({cartons:[]});await retry;
});

test('a create result after leaving retains recovery evidence without applying a label or touching unmounted UI',async()=>{
    const view=page();await load(view);enterPhysical(view);const pending=view.button('確認建箱並列印').props.onClick();
    view.unmount();view.posts[0].resolve(saved(view.posts[0]));await pending;
    assert.equal(view.updatesAfterUnmount(),0);assert.equal(view.posts.length,1,'no seal continues under an abandoned session');
    const stored=JSON.parse(view.storage.get(editorHelpers.pendingCartonEditorKey(7)));assert.equal(stored.editor.id,view.posts[0].body.cartonId);assert.equal(stored.editor.unknown,true);
});

test('unknown create results survive refresh and must be read back using the same carton identity before any new write',async()=>{
    const view=page();await load(view);enterPhysical(view);const pending=view.button('確認建箱並列印').props.onClick();
    const request=view.posts[0];request.reject(new Error('connection lost'));await pending;await view.settle();
    assert.ok(view.button('核對儲存結果'));view.button('取消').props.onClick();assert.ok(view.dialog('新增箱號'));
    const refreshed=page({storage:view.storage});assert.ok(refreshed.button('核對儲存結果'));
    const check=refreshed.button('核對儲存結果').props.onClick();assert.equal(refreshed.posts.length,0);assert.equal(refreshed.reads[0].url,`/api/cartons/${request.body.cartonId}`);
    refreshed.reads[0].resolve(saved(request));await refreshed.settle();refreshed.reads.at(-1).resolve({cartons:[]});await check;
    const retry=refreshed.button('確認建箱並列印').props.onClick();assert.match(refreshed.posts[0].url,/\/seal$/);refreshed.posts[0].resolve(saved(request,'sealed'));await refreshed.settle();refreshed.reads.at(-1).resolve({cartons:[]});await retry;
});

test('refreshing an in-flight create restores only the already dispatched identity and must read its result before retrying',async()=>{
    const view=page();await load(view);enterPhysical(view);const pending=view.button('確認建箱並列印').props.onClick();
    const request=view.posts[0];view.unmount();const refreshed=page({storage:view.storage});
    assert.ok(refreshed.button('核對儲存結果'),'a hard refresh need not wait for an HTTP error callback');
    const check=refreshed.button('核對儲存結果').props.onClick();assert.equal(refreshed.posts.length,0);assert.equal(refreshed.reads[0].url,`/api/cartons/${request.body.cartonId}`);
    request.reject(new Error('abandoned page'));await pending;
    refreshed.reads[0].resolve(saved(request));await refreshed.settle();refreshed.reads.at(-1).resolve({cartons:[]});await check;
    assert.equal(refreshed.storage.size,0);assert.equal(view.updatesAfterUnmount(),0);
});

test('physical list uses natural box order and staff cannot open a create or edit interface',async()=>{
    const view=page({role:'picker'});view.advance();const rows=['N20','N2','N1'].map(cartonId=>({cartonId,status:'sealed',lines:[]}));view.reads[0].resolve({cartons:rows});await view.settle();
    assert.equal(view.button('新增箱號'),undefined);assert.equal(view.button('匯入箱號'),undefined);
    const text=view.text(view.render());assert.ok(text.indexOf('N1')<text.indexOf('N2'));assert.ok(text.indexOf('N2')<text.indexOf('N20'));
});

test('a delayed suggested start number never replaces a number the manager entered explicitly',async()=>{
    const view=page();await load(view);view.find(view.render(),node=>node.props?.role==='tab'&&view.text(node).trim()==='箱規').props.onClick();view.advance();
    const spec={specId:'BSP-1',status:'active',contentRevision:1,lines:[{itemCode:'SKU',quantity:10}]};view.reads.at(-1).resolve({items:[spec]});await view.settle();
    const opening=view.button('BSP-1').props.onClick();view.reads.at(-1).resolve(spec);await opening;await view.settle();
    const suggested=view.reads.at(-1);assert.equal(suggested.url,'/api/box-specs/next-number');
    view.input('起始號碼').props.onChange({target:{value:'5'}});suggested.resolve({prefix:'N',nextNumber:21});await view.settle();assert.equal(view.input('起始號碼').props.value,'5');
    view.input('建立箱數').props.onChange({target:{value:'20'}});assert.match(view.text(view.render()),/N.*5.*N.*24.*每箱.*10.*共.*200/s);
});

test('unknown numbered batch survives closing the detail and reopens with the exact UUID, range and quantity before retry',async()=>{
    const view=page();await load(view);view.find(view.render(),node=>node.props?.role==='tab'&&view.text(node).trim()==='箱規').props.onClick();view.advance();
    const spec={specId:'BSP-1',status:'active',contentRevision:1,lines:[{itemCode:'SKU',quantity:10}]};view.reads.at(-1).resolve({items:[spec]});await view.settle();
    const open=view.button('BSP-1').props.onClick();view.reads.at(-1).resolve(spec);await open;await view.settle();view.reads.at(-1).resolve({prefix:'N',nextNumber:1});await view.settle();
    view.input('建立箱數').props.onChange({target:{value:'2'}});
    const first=view.button('建立實體箱並列印').props.onClick();view.posts[0].reject(new Error('lost response'));await first;await view.settle();
    const original=JSON.parse(JSON.stringify(view.posts[0].body));assert.equal(original.prefix,'N');assert.equal(original.startNumber,1);assert.equal(original.count,2);
    view.dialog('BSP-1').props.onClose();const reopen=view.button('BSP-1').props.onClick();view.reads.at(-1).resolve(spec);await reopen;await view.settle();
    assert.equal(view.input('起始號碼').props.value,'1');assert.equal(view.input('建立箱數').props.value,'2');assert.equal(view.input('建立箱數').props.disabled,true);
    const retry=view.button('重新確認建箱結果').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(view.posts[1].body)),original);
    const cartons=[2,1].map(n=>({cartonId:'N'+n,status:'sealed',contentRevision:1,lines:[{itemCode:'SKU',quantity:10,remainingQuantity:10}]}));
    view.posts[1].resolve({creationId:original.creationId,cartons});await view.settle();
    const all=[];const visit=node=>{if(!node||typeof node!=='object')return;if(node.type?.name==='QrLabel')all.push(node.props.carton.cartonId);for(const child of(node.props?.children||[]).flat(Infinity))visit(child);};visit(view.render());
    assert.deepEqual(all,['N1','N2'],'print uses the requested numeric order even if response rows arrive out of order');
    view.reads.at(-1).resolve({items:[spec]});await retry;assert.equal(view.storage.size,0);
});
