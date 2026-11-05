import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as helpers from '../src/utils/ecountAssistant.mjs';

const source=await readFile(new URL('../src/components/EcountAssistantPage.jsx',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'jsx',format:'cjs'});
function page({storage=new Map(),extension={controller:null,binding:null},locks={held:false},initialUser={id:7,name:'Manager',role:'admin'},deferType=null,unknownSave=false}={}){
    const hooks=[],effects=[],timers=new Map(),reads=[],posts=[],messages=[],transports=[],lockCalls=[];
    let cursor=0,dirty=false,tree,mounted=true,timerId=0,updatesAfterUnmount=0,session='token-A',user={...initialUser},deferred;
    const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
    const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{if(!mounted)updatesAfterUnmount++;const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];},
        useRef(initial){const i=cursor++;return hooks[i]||={current:initial};},
        useCallback(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={fn,deps};return hooks[i].fn;},
        useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){const cleanup=hooks[i]?.cleanup;hooks[i]={deps};effects.push(()=>{cleanup?.();hooks[i].cleanup=fn();});}}
    };
    const job={id:'11111111-1111-4111-8111-111111111111',companyCode:'EXCLUSIVE-TEST',voucherNumber:'2026/10/16-1',orderId:71};
    const plan={schemaVersion:1,companyCode:job.companyCode,voucherNumber:job.voucherNumber,mode:'test',saveAllowed:true,testWriteEnabled:true,rows:[{rowId:'1',itemCode:'TEST',expectedQuantity:'25',metadata:'[CORELY-WMS:71]N1 出 5 件；N2 出 10 件；N3 出 10 件[/CORELY-WMS:71]'}]};
    const status=()=>({mode:'test',enabled:true,canManage:['dispatcher','admin','superadmin'].includes(user.role),jobs:[]});
    const api={getSessionIdentity:()=>session,async get(url,options){reads.push({url,options});return{data:status()};},async post(url,body,options){
        posts.push({url,body:structuredClone(body),options});
        if(url.endsWith('/claim'))return{data:{job,leaseToken:'fixture-lease',leaseExpiresAt:new Date(Date.now()+120000).toISOString()}};
        if(url.endsWith('/prepare'))return{data:{plan,planFingerprint:'a'.repeat(64),saveAllowed:true,leaseExpiresAt:new Date(Date.now()+120000).toISOString()}};
        if(url.endsWith('/recover'))return{data:{testVerified:true,verified:false}};
        if(url.endsWith('/result'))return{data:unknownSave?{verified:false,testVerified:false,readOnlyRecoveryRequired:true}:{verified:false,testVerified:true}};
        return{data:{}};
    }};
    function createAssistantBridge(){
        const nonce=randomUUID().replaceAll('-','');let closed=false;
        const transport={nonce,close(){closed=true;},async request(type,payload){
            if(closed)throw new Error('助手連線已關閉');messages.push({nonce,type,payload:structuredClone(payload)});
            if(type==='HELLO'){
                if(extension.controller&&(extension.controller.nonce!==nonce||extension.controller.actorId!==payload.actorId))extension.binding=null;
                extension.controller={nonce,actorId:payload.actorId};return{protocolVersion:1};
            }
            if(type==='GET_CAPABILITIES')return{bound:!!extension.binding&&extension.binding.nonce===nonce,mode:'preview',saveEnabled:false};
            if(type===deferType)return new Promise((resolve,reject)=>{deferred={type,resolve,reject};});
            if(type==='READ_DOCUMENT')return{before:{companyCode:job.companyCode,voucherNumber:job.voucherNumber},capabilities:{acceptanceTestExclusiveDocument:true}};
            if(type==='SAVE_PLAN'){
                if(unknownSave)throw Object.assign(new Error('fixture lost vendor response'),{code:'SAVE_RESULT_UNKNOWN'});
                return{outcome:'test_verified',after:{fixtureReadback:true}};
            }
            if(type==='READ_BACK')return{outcome:'saved',after:{fixtureReadback:true}};
            return{};
        }};transports.push(transport);return transport;
    }
    const importedHelpers={...helpers,createAssistantBridge};
    const generic=new Proxy({}, {get:(_,key)=>key==='__esModule'?false:String(key)}),module={exports:{}};
    vm.runInNewContext(code,{module,exports:module.exports,require:name=>({react,'@/api/api':api,'@/utils/ecountAssistant.mjs':importedHelpers,'@/ui':{PageHeader:'PageHeader'}}[name]||generic),React:react,crypto:webcrypto,console,
        localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
        navigator:{locks:{async request(name,options,work){lockCalls.push({name,options});if(locks.held)return work(null);locks.held=true;try{return await work({name});}finally{locks.held=false;}}}},
        setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
    const children=node=>node&&typeof node==='object'?(node.props?.children||[]).flat(Infinity):[];
    const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):children(node).map(text).join(' ');
    const find=(node,predicate)=>{if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of children(node)){const result=find(child,predicate);if(result)return result;}};
    const render=()=>{for(let i=0;i<30;i++){cursor=0;dirty=false;tree=module.exports.EcountAssistantPage({user});while(effects.length)effects.shift()();if(!dirty)return tree;}throw new Error('render did not settle');};
    const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();return render();};
    const button=name=>find(render(),node=>node.type==='button'&&text(node).trim()===name);
    render();return{render,settle,text,button,storage,extension,posts,reads,messages,transports,lockCalls,job,plan,
        bind:()=>{extension.binding={...extension.controller};},
        resolveDeferred:value=>{assert.ok(deferred,'expected an in-flight bridge request');deferred.resolve(value);deferred=null;},
        deferredType:()=>deferred?.type,
        changeUser:patch=>{user={...user,...patch};return render();},changeSession:value=>{session=value;return render();},
        unmount:()=>{mounted=false;for(const hook of hooks)hook?.cleanup?.();},updatesAfterUnmount:()=>updatesAfterUnmount};
}
async function connectAndBind(view){
    await view.settle();await view.button('連接 Chrome 助手').props.onClick();await view.settle();
    view.bind();await view.button('重新連接助手').props.onClick();await view.settle();
    assert.match(view.text(view.render()),/已綁定 ECOUNT 分頁/,'popup binding must survive reconnect on the same controller');
}

test('actual assistant page connects, binds in popup and reconnects on the same nonce',async()=>{
    const view=page();await connectAndBind(view);
    const hello=view.messages.filter(row=>row.type==='HELLO');assert.ok(hello.length>=1);assert.equal(new Set(hello.map(row=>row.nonce)).size,1);
    assert.match(view.text(view.render()),/已綁定 ECOUNT 分頁/);assert.equal(view.posts.length,0);
});

test('closing the assistant page retains local recovery intent and reopening uses the original actor worker',async()=>{
    const view=page({unknownSave:true});await connectAndBind(view);
    await view.button('處理下一筆').props.onClick();await view.settle();
    const key=helpers.pendingAssistantKey(7),intent=JSON.parse(view.storage.get(key)),worker=view.storage.get('wms_ecount_assistant_worker:7');
    assert.ok(intent);assert.equal(intent.workerId,worker);assert.equal(view.messages.filter(row=>row.type==='SAVE_PLAN').length,1);
    view.unmount();const reopened=page({storage:view.storage,extension:view.extension,unknownSave:true});await reopened.settle();
    assert.ok(reopened.button('唯讀確認上次結果'));await connectAndBind(reopened);
    assert.equal(reopened.storage.get('wms_ecount_assistant_worker:7'),worker);
    await reopened.button('唯讀確認上次結果').props.onClick();await reopened.settle();
    assert.equal(reopened.storage.has(key),false);assert.equal(reopened.messages.filter(row=>row.type==='SAVE_PLAN').length,0);
    assert.equal(reopened.messages.filter(row=>row.type==='READ_BACK').length,1);assert.equal(reopened.posts.at(-1).body.workerId,worker);assert.match(reopened.posts.at(-1).url,/\/recover$/);
});

test('switching account during document read resets busy and stops before prepare or vendor save',async()=>{
    const view=page({deferType:'READ_DOCUMENT'});await connectAndBind(view);
    const running=view.button('處理下一筆').props.onClick();await view.settle();assert.equal(view.deferredType(),'READ_DOCUMENT');
    view.changeUser({id:8,name:'Another manager'});view.changeSession('token-B');await view.settle();
    assert.equal(view.button('連接 Chrome 助手').props.disabled,false);
    view.resolveDeferred({before:{},capabilities:{}});await running;await view.settle();
    assert.equal(view.posts.filter(row=>row.url.endsWith('/prepare')).length,0);assert.equal(view.messages.filter(row=>row.type==='SAVE_PLAN').length,0);assert.equal(view.button('連接 Chrome 助手').props.disabled,false);
});

test('revoking management role during preview stops the old runner before vendor save',async()=>{
    const view=page({deferType:'PREVIEW_PLAN'});await connectAndBind(view);
    const running=view.button('處理下一筆').props.onClick();await view.settle();assert.equal(view.deferredType(),'PREVIEW_PLAN');
    view.changeUser({role:'picker'});await view.settle();view.resolveDeferred({});await running;await view.settle();
    assert.equal(view.messages.filter(row=>row.type==='SAVE_PLAN').length,0,'an old manager runner cannot save after role revocation');
    assert.equal(view.button('處理下一筆'),undefined);
    view.changeUser({role:'admin'});await view.settle();assert.equal(view.button('連接 Chrome 助手').props.disabled,false);
});

test('another assistant tab holding the actor Web Lock prevents any second claim or save',async()=>{
    const locks={held:true},view=page({locks});await connectAndBind(view);
    await view.button('處理下一筆').props.onClick();await view.settle();
    assert.equal(view.posts.length,0);assert.equal(view.messages.filter(row=>row.type==='SAVE_PLAN').length,0);assert.match(view.text(view.render()),/另一個 WMS 分頁正在處理/);
});

test('stored pending work from another actor never appears as the current actor recovery or triggers a save',async()=>{
    const storage=new Map([[helpers.pendingAssistantKey(8),JSON.stringify({actorId:8,workerId:'foreign-worker'})]]),view=page({storage});await view.settle();
    assert.equal(view.button('唯讀確認上次結果'),undefined);assert.equal(view.messages.length,0);assert.equal(view.posts.length,0);
});
