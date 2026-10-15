import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as editorHelpers from '../src/utils/cartonEditor.js';
import * as scanHelpers from '../src/utils/cartonScan.js';

const source=await readFile(new URL('../src/components/CartonsPage.jsx',import.meta.url),'utf8');
const {code}=await transform(`${source}\nexport { SerialLookup, QrLabel };`,{loader:'jsx',format:'cjs'});
function page({role='admin',scope='orders',storage=new Map(),component='CartonsPage',onOpen=()=>{}}={}) {
    const hooks=[],effects=[],timers=new Map(),reads=[],posts=[];let cursor=0,dirty=false,tree,timerId=0,mounted=true,updatesAfterUnmount=0;
    let session='token-A';
    const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
    const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{if(!mounted)updatesAfterUnmount++;const next=typeof value==='function'?value(hooks[i].value):value;if(next!==hooks[i].value){hooks[i].value=next;dirty=true;}}];},
        useRef(initial){const i=cursor++;return hooks[i]||={current:initial};},
        useCallback(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={fn,deps};return hooks[i].fn;},
        useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){const cleanup=hooks[i]?.cleanup;hooks[i]={deps};effects.push(()=>{cleanup?.();hooks[i].cleanup=fn();});}}
    };
    const deferred=(bucket,fields)=>new Promise((resolve,reject)=>bucket.push({...fields,resolve:data=>resolve({data}),reject}));
    const api={getSessionIdentity:()=>session,get:(url,options)=>deferred(reads,{url,options}),post:(url,body,options)=>deferred(posts,{url,body,options}),patch:(url,body,options)=>deferred(posts,{url,body,options,method:'PATCH'})};
    const imports={react,'@/api/api':api,'@/utils/cartonScan':scanHelpers,'@/utils/cartonEditor':editorHelpers,'@/ui':{Button:'Button'},'./CartonDialog':{CartonDialog:'CartonDialog'},'./CartonItemEditor':{CartonItemEditor:'CartonItemEditor',cartonFieldClass:'field'},sonner:{toast:{success:()=>{},info:()=>{},error:()=>{}}}};
    const generic=new Proxy({}, {get:(_,key)=>key==='__esModule'?false:String(key)}),module={exports:{}};
    vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports[name]||generic,React:react,crypto:webcrypto,console,
        setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
        sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
    let user={id:7,name:'Manager',role,management_scope:scope};
    const render=()=>{for(let i=0;i<20;i++){cursor=0;dirty=false;tree=module.exports[component]({user,onOpen});while(effects.length)effects.shift()();if(!dirty)return tree;}throw new Error('render did not settle');};
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
    render();return{render,find,text,button,dialog,line,input,reads,posts,storage,advance,settle,unmount,updatesAfterUnmount:()=>updatesAfterUnmount,
        read:url=>reads.findLast(call=>call.url===url),
        changeUser:patch=>{user={...user,...patch};return render();},changeSession:(value,rerender=true)=>{session=value;if(rerender)return render();},
        tab:name=>find(render(),node=>node.props?.role==='tab'&&text(node).trim()===name),
        submit:()=>find(render(),node=>node.type==='form').props.onSubmit({preventDefault(){}})};
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
    const suggested=view.read('/api/box-specs/next-number');assert.ok(suggested);
    view.input('起始號碼').props.onChange({target:{value:'5'}});suggested.resolve({prefix:'N',nextNumber:21});await view.settle();assert.equal(view.input('起始號碼').props.value,'5');
    view.input('建立箱數').props.onChange({target:{value:'20'}});assert.match(view.text(view.render()),/N.*5.*N.*24.*每箱.*10.*共.*200/s);
});

test('unknown numbered batch survives closing the detail and reopens with the exact UUID, range and quantity before retry',async()=>{
    const view=page();await load(view);view.find(view.render(),node=>node.props?.role==='tab'&&view.text(node).trim()==='箱規').props.onClick();view.advance();
    const spec={specId:'BSP-1',status:'active',contentRevision:1,lines:[{itemCode:'SKU',quantity:10}]};view.reads.at(-1).resolve({items:[spec]});await view.settle();
    const open=view.button('BSP-1').props.onClick();view.reads.at(-1).resolve(spec);await open;await view.settle();view.read('/api/box-specs/next-number').resolve({prefix:'N',nextNumber:1});await view.settle();
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
    view.read('/api/box-specs').resolve({items:[spec]});await retry;assert.equal(view.storage.size,0);
});

const carton=(cartonId,overrides={})=>({cartonId,status:'sealed',contentRevision:1,stateRevision:1,allocations:[],lines:[{itemCode:'SKU',quantity:10,remainingQuantity:10,actualSN:[],remainingSN:[]}],...overrides});
const specFixture=()=>({specId:'BSP-REUSE',status:'active',contentRevision:2,lines:[{itemCode:'SKU',quantity:10}]});
const openSpec=async(view,spec=specFixture())=>{
    view.tab('箱規').props.onClick();view.advance();view.read('/api/box-specs').resolve({items:[spec]});await view.settle();
    const opening=view.button(spec.specId).props.onClick();view.read(`/api/box-specs/${spec.specId}`).resolve(spec);await opening;await view.settle();return spec;
};
const pane=(view,label)=>view.find(view.render(),node=>node.props?.['aria-label']===label);
const noEmpty=view=>assert.doesNotMatch(view.text(view.render()),/尚無符合|尚未建立箱規|尚未建立實體箱/);
const labels=view=>{
    const result=[];const walk=node=>{if(!node||typeof node!=='object')return;if(node.type?.name==='QrLabel')result.push(node.props.carton);for(const child of(node.props?.children||[]).flat(Infinity))walk(child);};walk(view.render());return result;
};

test('first load and rapid delayed tab changes show only the selected tab and never flash an empty state',async()=>{
    const view=page();noEmpty(view);assert.equal(pane(view,'實體箱清單').props['aria-busy'],true);
    view.advance();const oldPhysical=view.read('/api/cartons');noEmpty(view);
    view.tab('箱規').props.onClick();noEmpty(view);assert.equal(pane(view,'箱規清單').props['aria-busy'],true);
    view.advance();const oldSpec=view.read('/api/box-specs');
    oldPhysical.resolve({cartons:[carton('OLD-PHYSICAL')]});await view.settle();assert.equal(view.button('OLD-PHYSICAL'),undefined);noEmpty(view);
    view.tab('SN查詢').props.onClick();oldSpec.resolve({items:[specFixture()]});await view.settle();assert.equal(view.button('BSP-REUSE'),undefined);
    view.tab('箱規').props.onClick();noEmpty(view);view.advance();const current=view.read('/api/box-specs');assert.notEqual(current,oldSpec);
    current.resolve({items:[]});await view.settle();assert.match(view.text(view.render()),/尚未建立箱規/);assert.equal(pane(view,'箱規清單').props['aria-busy'],false);
});

test('returning to a cached tab keeps its own rows while refreshing and ignores the previous tab response',async()=>{
    const view=page();view.advance();view.read('/api/cartons').resolve({cartons:[carton('N1')]});await view.settle();
    view.tab('箱規').props.onClick();view.advance();const specRead=view.read('/api/box-specs');assert.equal(view.button('N1'),undefined);
    view.tab('實體箱／SN').props.onClick();assert.ok(view.button('N1'));assert.equal(pane(view,'實體箱清單').props['aria-busy'],true);noEmpty(view);
    specRead.resolve({items:[specFixture()]});await view.settle();assert.equal(view.button('BSP-REUSE'),undefined);assert.ok(view.button('N1'));
    view.advance();view.read('/api/cartons').resolve({cartons:[carton('N2')]});await view.settle();assert.equal(view.button('N1'),undefined);assert.ok(view.button('N2'));
});

test('typing keeps the table during debounce and only the newest search response may replace it',async()=>{
    const view=page();view.advance();view.read('/api/cartons').resolve({cartons:[carton('N1')]});await view.settle();
    view.input('搜尋箱號或品號').props.onChange({target:{value:'A'}});assert.ok(view.button('N1'));noEmpty(view);assert.equal(pane(view,'實體箱清單').props['aria-busy'],true);
    view.advance();const first=view.read('/api/cartons');assert.equal(first.options.params.q,'A');
    view.input('搜尋箱號或品號').props.onChange({target:{value:'AB'}});assert.ok(view.button('N1'));view.advance();const second=view.read('/api/cartons');assert.equal(second.options.params.q,'AB');
    second.resolve({cartons:[carton('AB-2')]});await view.settle();first.resolve({cartons:[carton('STALE-A')]});await view.settle();
    assert.ok(view.button('AB-2'));assert.equal(view.button('STALE-A'),undefined);assert.equal(view.button('N1'),undefined);
    view.input('搜尋箱號或品號').props.onChange({target:{value:''}});assert.ok(view.button('N1'),'the empty-query cache belongs to this tab and session');noEmpty(view);
});

test('a failed search retains visible rows with its error and never reports an empty result',async()=>{
    const view=page();view.advance();view.read('/api/cartons').resolve({cartons:[carton('N1')]});await view.settle();
    view.input('搜尋箱號或品號').props.onChange({target:{value:'bad'}});view.advance();view.read('/api/cartons').reject({response:{status:503,data:{message:'查詢暫時失敗'}}});await view.settle();
    assert.ok(view.button('N1'));assert.match(view.text(view.render()),/查詢暫時失敗/);noEmpty(view);assert.equal(pane(view,'實體箱清單').props['aria-busy'],false);
});

test('actor, permission and token changes discard list caches and reject their delayed responses',async()=>{
    for(const change of [view=>view.changeUser({id:8}),view=>view.changeUser({role:'picker'}),view=>view.changeSession('token-B')]){
        const view=page();view.advance();view.read('/api/cartons').resolve({cartons:[carton('PRIVATE-N1')]});await view.settle();
        view.input('搜尋箱號或品號').props.onChange({target:{value:'N'}});view.advance();const previous=view.read('/api/cartons');
        change(view);assert.equal(view.button('PRIVATE-N1'),undefined);noEmpty(view);view.advance();const current=view.read('/api/cartons');
        previous.resolve({cartons:[carton('PREVIOUS-SESSION')]});await view.settle();assert.equal(view.button('PREVIOUS-SESSION'),undefined);noEmpty(view);
        current.resolve({cartons:[carton('CURRENT-SESSION')]});await view.settle();assert.ok(view.button('CURRENT-SESSION'));
        view.input('搜尋箱號或品號').props.onChange({target:{value:''}});assert.equal(view.button('PRIVATE-N1'),undefined);
    }
});

test('a token replaced without a render cannot apply an old response or open an old detail',async()=>{
    const view=page();view.advance();const request=view.read('/api/cartons');view.changeSession('token-B',false);
    request.resolve({cartons:[carton('OLD-TOKEN')]});await view.settle();assert.equal(view.button('OLD-TOKEN'),undefined);
    view.advance();view.read('/api/cartons').resolve({cartons:[carton('CURRENT')]});await view.settle();const opening=view.button('CURRENT').props.onClick();
    view.changeUser({id:8});view.read('/api/cartons/CURRENT').resolve(carton('CURRENT'));await opening;await view.settle();assert.equal(view.dialog('CURRENT'),undefined);
});

test('delayed serial responses cannot cross query, session or component lifetime and use a stable result pane',async()=>{
    const opened=[],view=page({component:'SerialLookup',onOpen:(...args)=>opened.push(args)});
    assert.match(pane(view,'SN 查詢結果').props.className,/scrollbar-gutter:stable/);
    view.input('SN 查詢').props.onChange({target:{value:'SN-A'}});const first=view.submit();
    view.input('SN 查詢').props.onChange({target:{value:'SN-B'}});const second=view.submit();
    view.reads[1].resolve({items:[{serialNumber:'SN-B',cartonId:'N2',readyForPicking:true}]});await second;await view.settle();
    view.reads[0].resolve({items:[{serialNumber:'SN-A',cartonId:'N1'}]});await first;await view.settle();assert.equal(view.button('N1'),undefined);assert.ok(view.button('N2'));
    view.button('N2').props.onClick();assert.deepEqual(opened,[['N2','physical']]);
    const stale=view.submit();view.changeSession('token-B');view.reads.at(-1).resolve({items:[{serialNumber:'OLD',cartonId:'OLD-N'}]});await stale;await view.settle();assert.equal(view.button('OLD-N'),undefined);assert.equal(view.button('N2'),undefined);
    const abandoned=view.submit();view.unmount();view.reads.at(-1).resolve({items:[{serialNumber:'SN-B',cartonId:'N3'}]});await abandoned;assert.equal(view.updatesAfterUnmount(),0);
});

test('plain usage help distinguishes templates, new boxes, original reprints and serial history',async()=>{
    const view=page({role:'picker'});view.button('怎麼使用').props.onClick();const help=view.dialog('箱號怎麼使用');assert.ok(help);
    const text=view.text(help);for(const phrase of ['可重複使用','重印此箱貼紙','下一個箱號','不會複製其他箱的 SN','異動紀錄'])assert.ok(text.includes(phrase));
    assert.equal(view.posts.length,0);help.props.onClose();assert.equal(view.dialog('箱號怎麼使用'),undefined);
});

test('individual reprint keeps the original carton, remaining quantity and serials with no write',async()=>{
    const view=page({role:'picker'}),record=carton('N5',{allocations:[{id:1}],lines:[{itemCode:'SKU',quantity:10,remainingQuantity:4,actualSN:['A','B'],remainingSN:['B']}]});
    view.advance();view.read('/api/cartons').resolve({cartons:[record]});await view.settle();const opening=view.button('N5').props.onClick();view.read('/api/cartons/N5').resolve(record);await opening;await view.settle();
    view.button('重印此箱貼紙').props.onClick();assert.ok(view.dialog('箱號貼紙'));assert.equal(view.posts.length,0);assert.equal(labels(view)[0],record);
    assert.equal(labels(view)[0].lines[0].remainingQuantity,4);assert.deepEqual(labels(view)[0].lines[0].actualSN,['A','B']);
    assert.match(view.text(view.dialog('箱號貼紙')),/原裝件數.*目前餘量/);
});

test('a reopened saved spec lists and reprints an existing composite batch without creating any box',async()=>{
    const view=page({role:'picker'});await load(view);const spec=await openSpec(view);
    const batch={specId:spec.specId,creatorId:9,creationId:'SAME-UUID',createdAt:'2026-10-15T00:00:00Z',contentRevision:1,cartonIds:['N1','N2'],count:2};
    view.read(`/api/box-specs/${spec.specId}/batches`).resolve({items:[batch],hasMore:true,nextCursor:'older-page'});await view.settle();
    const reprint=view.button('重印整批貼紙').props.onClick();const detail=view.read(`/api/box-specs/${spec.specId}/batches/9/SAME-UUID`);assert.ok(detail);assert.equal(view.posts.length,0);
    const original=[carton('N1',{lines:[{itemCode:'SKU',quantity:10,remainingQuantity:5,actualSN:[],remainingSN:[]}]}),carton('N2')];
    detail.resolve({...batch,cartons:[original[1],original[0]]});await reprint;await view.settle();assert.deepEqual(labels(view).map(row=>row.cartonId),['N1','N2']);assert.equal(labels(view)[0].lines[0].remainingQuantity,5);assert.equal(view.posts.length,0);
    view.dialog('箱號貼紙').props.onClose();const more=view.button('載入較早批次').props.onClick();const next=view.read(`/api/box-specs/${spec.specId}/batches`);assert.equal(next.options.params.cursor,'older-page');next.resolve({items:[{...batch,creatorId:10}],hasMore:false,nextCursor:null});await more;await view.settle();
    const section=pane(view,'已建立的批次');assert.equal(view.text(section).match(/重印整批貼紙/g).length,2,'same UUID from separate creators is retained');
});

test('reprint refuses incomplete, draft or rejected batches and never falls back to create',async()=>{
    for(const outcome of ['incomplete','draft','rejected']){
        const view=page();await load(view);const spec=await openSpec(view);const batch={specId:spec.specId,creatorId:7,creationId:'UUID',createdAt:'2026-10-15T00:00:00Z',cartonIds:['N1','N2'],count:2};
        view.read(`/api/box-specs/${spec.specId}/batches`).resolve({items:[batch],hasMore:false});await view.settle();const pending=view.button('重印整批貼紙').props.onClick();const request=view.read(`/api/box-specs/${spec.specId}/batches/7/UUID`);
        if(outcome==='rejected')request.reject({response:{status:409,data:{message:'原批包含尚未確認的實體箱'}}});
        else request.resolve({...batch,cartons:outcome==='incomplete'?[carton('N1')]:[carton('N1'),carton('N2',{status:'draft'})]});
        await pending;await view.settle();assert.equal(view.dialog('箱號貼紙'),undefined);assert.equal(view.posts.length,0);assert.match(view.text(view.dialog(spec.specId)),/不完整|尚未確認/);
    }
});

test('a successful twenty-box batch refreshes the next number and reuses the saved spec with a new command',async()=>{
    const view=page();await load(view);const spec=await openSpec(view);view.read('/api/box-specs/next-number').resolve({nextNumber:1});view.read(`/api/box-specs/${spec.specId}/batches`).resolve({items:[],hasMore:false});await view.settle();
    view.input('建立箱數').props.onChange({target:{value:'20'}});const first=view.button('建立實體箱並列印').props.onClick();const firstBody=JSON.parse(JSON.stringify(view.posts[0].body));
    assert.equal(firstBody.startNumber,1);assert.equal(firstBody.count,20);assert.equal(firstBody.lines,undefined,'the specification is reused; no physical SN list is copied');
    view.posts[0].resolve({creationId:firstBody.creationId,cartons:Array.from({length:20},(_,index)=>carton(`N${index+1}`))});await view.settle();view.read('/api/box-specs').resolve({items:[spec]});await first;await view.settle();
    assert.equal(view.input('起始號碼').props.value,'');assert.equal(view.button('建立實體箱並列印').props.disabled,true);assert.ok(view.read('/api/box-specs/next-number'));
    view.read('/api/box-specs/next-number').resolve({nextNumber:21});await view.settle();view.dialog('箱號貼紙').props.onClose();assert.equal(view.input('起始號碼').props.value,'21');
    const second=view.button('建立實體箱並列印').props.onClick();const secondBody=JSON.parse(JSON.stringify(view.posts[1].body));assert.equal(secondBody.startNumber,21);assert.equal(secondBody.count,20);assert.notEqual(secondBody.creationId,firstBody.creationId);
    view.posts[1].resolve({creationId:secondBody.creationId,cartons:Array.from({length:20},(_,index)=>carton(`N${index+21}`))});await view.settle();view.read('/api/box-specs').resolve({items:[spec]});await second;assert.deepEqual(labels(view).map(row=>row.cartonId),Array.from({length:20},(_,index)=>`N${index+21}`));assert.equal(view.storage.size,0);
});

test('equivalent whitespace typing does not invalidate a pending normalized query',async()=>{
    const view=page();view.advance();view.input('搜尋箱號或品號').props.onChange({target:{value:' A '}});view.advance();const current=view.read('/api/cartons');assert.equal(current.options.params.q,'A');
    view.input('搜尋箱號或品號').props.onChange({target:{value:'A'}});current.resolve({cartons:[carton('MATCH-A')]});await view.settle();assert.ok(view.button('MATCH-A'));assert.equal(pane(view,'實體箱清單').props['aria-busy'],false);
});

test('a write completed after changing search refreshes the current query instead of leaving it loading forever',async()=>{
    const view=page();await load(view);enterPhysical(view);const pending=view.button('確認建箱並列印').props.onClick();const record=saved(view.posts[0]);
    view.input('搜尋箱號或品號').props.onChange({target:{value:'CURRENT'}});view.advance();view.read('/api/cartons').resolve({cartons:[carton('CURRENT-OLD')]});await view.settle();
    view.posts[0].resolve(record);await view.settle();view.posts[1].resolve({...record,status:'sealed'});await view.settle();const refreshing=view.read('/api/cartons');assert.equal(refreshing.options.params.q,'CURRENT');
    refreshing.resolve({cartons:[carton('CURRENT-NEW')]});await pending;await view.settle();assert.ok(view.button('CURRENT-NEW'));assert.equal(pane(view,'實體箱清單').props['aria-busy'],false);
});

test('a late create from another actor keeps its original recovery but cannot reopen the old editor or seal',async()=>{
    const view=page();await load(view);enterPhysical(view);const pending=view.button('確認建箱並列印').props.onClick();const request=view.posts[0];
    view.changeUser({id:8,role:'picker'});request.resolve(saved(request));await pending;await view.settle();assert.equal(view.dialog('新增箱號'),undefined);assert.equal(view.dialog('編輯箱內內容'),undefined);assert.equal(view.posts.length,1);
    const recovery=JSON.parse(view.storage.get(editorHelpers.pendingCartonEditorKey(7)));assert.equal(recovery.editor.id,request.body.cartonId);assert.equal(recovery.lines[0].itemCode,'SKU-01');assert.equal(view.storage.has(editorHelpers.pendingCartonEditorKey(8)),false);
});

test('closing a pending batch reprint cancels its labels and reopening can reprint again',async()=>{
    const view=page();await load(view);const spec=await openSpec(view);const batch={specId:spec.specId,creatorId:7,creationId:'UUID',createdAt:'2026-10-15T00:00:00Z',cartonIds:['N1'],count:1};
    view.read(`/api/box-specs/${spec.specId}/batches`).resolve({items:[batch],hasMore:false});await view.settle();const pending=view.button('重印整批貼紙').props.onClick();const stale=view.read(`/api/box-specs/${spec.specId}/batches/7/UUID`);
    view.dialog(spec.specId).props.onClose();await view.settle();stale.resolve({...batch,cartons:[carton('N1')]});await pending;await view.settle();assert.equal(view.dialog('箱號貼紙'),undefined);
    const opening=view.button(spec.specId).props.onClick();view.read(`/api/box-specs/${spec.specId}`).resolve(spec);await opening;await view.settle();view.read(`/api/box-specs/${spec.specId}/batches`).resolve({items:[batch],hasMore:false});await view.settle();assert.equal(view.button('重印整批貼紙').props.disabled,false);
});

test('batch history and label responses from a previous actor cannot reveal rows or print labels',async()=>{
    const view=page();await load(view);const spec=await openSpec(view);const batch={specId:spec.specId,creatorId:7,creationId:'UUID',createdAt:'2026-10-15T00:00:00Z',cartonIds:['N1'],count:1};
    const history=view.read(`/api/box-specs/${spec.specId}/batches`);history.resolve({items:[batch],hasMore:false});await view.settle();const pending=view.button('重印整批貼紙').props.onClick();const detail=view.read(`/api/box-specs/${spec.specId}/batches/7/UUID`);
    view.changeUser({id:8,role:'picker'});detail.resolve({...batch,cartons:[carton('N1')]});await pending;await view.settle();assert.equal(view.dialog('箱號貼紙'),undefined);assert.equal(view.dialog(spec.specId),undefined);assert.equal(view.posts.length,0);
});

test('an older batch page failure preserves visible batches and the exact cursor for a read-only retry',async()=>{
    const view=page({role:'picker'});await load(view);const spec=await openSpec(view);const batch={specId:spec.specId,creatorId:7,creationId:'UUID',createdAt:'2026-10-15T00:00:00Z',cartonIds:['N1'],count:1};
    view.read(`/api/box-specs/${spec.specId}/batches`).resolve({items:[batch],hasMore:true,nextCursor:'exact-older-cursor'});await view.settle();
    const failed=view.button('載入較早批次').props.onClick();const first=view.read(`/api/box-specs/${spec.specId}/batches`);assert.equal(first.options.params.cursor,'exact-older-cursor');first.reject({response:{status:503,data:{message:'批次查詢暫時失敗'}}});await failed;await view.settle();
    assert.match(view.text(pane(view,'已建立的批次')),/N1.*批次查詢暫時失敗/s);assert.ok(view.button('重印整批貼紙'));assert.ok(view.button('載入較早批次'));
    const retried=view.button('載入較早批次').props.onClick();const second=view.read(`/api/box-specs/${spec.specId}/batches`);assert.equal(second.options.params.cursor,'exact-older-cursor');second.resolve({items:[{...batch,creationId:'OLDER',cartonIds:['N0']}],hasMore:false,nextCursor:null});await retried;await view.settle();
    const text=view.text(pane(view,'已建立的批次'));assert.match(text,/N1.*N0/s);assert.doesNotMatch(text,/批次查詢暫時失敗/);assert.equal(view.button('載入較早批次'),undefined);assert.equal(view.posts.length,0);
});
