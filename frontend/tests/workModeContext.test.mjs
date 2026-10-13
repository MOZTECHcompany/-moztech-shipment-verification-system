import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as capabilities from '../src/utils/workCapabilities.js';

const source=await readFile(new URL('../src/contexts/WorkModeContext.jsx',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'jsx',format:'cjs'});
const settings={work_types:['pick','pack'],work_date:'2026-10-13',default_stage:'pack',choice_stage:'pick',today_assignment:{stage:'pack',assigned_by_name:'主管'}};

function tab({storage=new Map(),user={id:7,role:'picker',work_types:['pick','pack']}}={}) {
    const hooks=[],effects=[],reads=[],writes=[];
    let cursor=0,dirty=false,tree,currentUser=user,mounted=true,updatesAfterUnmount=0;
    const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
    const react={
        createContext:()=>({Provider:'Provider'}),createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{if(!mounted)updatesAfterUnmount++;const next=typeof value==='function'?value(hooks[i].value):value;if(next!==hooks[i].value){hooks[i].value=next;dirty=true;}}];},
        useRef(initial){const i=cursor++;return hooks[i]||=( {current:initial});},
        useCallback(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={fn,deps};return hooks[i].fn;},
        useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){const cleanup=hooks[i]?.cleanup;hooks[i]={deps};effects.push(()=>{cleanup?.();hooks[i].cleanup=fn();});}}
    };
    const deferred=(bucket,fields)=>new Promise((resolve,reject)=>bucket.push({...fields,resolve:data=>resolve({data}),reject}));
    const imports={react,'../api/api':{get:url=>deferred(reads,{url}),put:(url,body)=>deferred(writes,{url,body})},'../utils/workCapabilities':capabilities};
    const module={exports:{}};
    vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports[name],sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
    const render=()=>{for(let i=0;i<12;i++){cursor=0;dirty=false;tree=module.exports.WorkModeProvider({user:currentUser,children:'app'});while(effects.length)effects.shift()();if(!dirty)return tree.props.value;}throw new Error('render did not settle');};
    const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();return render();};
    const unmount=()=>{mounted=false;for(const hook of hooks)hook?.cleanup?.();};
    render();return{reads,writes,storage,render,settle,unmount,updateUser:next=>{currentUser=next;return render();},updatesAfterUnmount:()=>updatesAfterUnmount};
}

test('first tab must confirm a stage even when another tab chose a different stage or a supervisor assigned today',async()=>{
    const first=tab();first.reads[0].resolve(settings);await first.settle();
    assert.equal(first.render().stage,null);
    assert.equal(first.render().recommendedStage,'pack','a new supervisor assignment is recommended before an earlier personal choice');
    assert.equal(first.render().assignment.stage,'pack');
    const pending=first.render().selectStage('pack');
    assert.equal(first.render().stage,null,'a request is not a confirmed choice');
    assert.equal(first.render().choosing,true);
    const second=tab();second.reads[0].resolve(settings);await second.settle();
    first.writes[0].resolve({...settings,choice_stage:'pack'});assert.equal(await pending,true);await first.settle();
    assert.equal(first.render().stage,'pack');assert.equal(second.render().stage,null,'other tab never silently changes mode');
    const refreshed=tab({storage:first.storage});refreshed.reads[0].resolve({...settings,default_stage:'pick'});await refreshed.settle();
    assert.equal(refreshed.render().stage,'pack','this tab restores its own confirmed choice');
});

test('rejected or uncertain choice preserves the prior phase and cannot claim a newly selected phase',async()=>{
    const storage=new Map([[capabilities.workModeStorageKey(7,'2026-10-13'),'pick']]);
    const view=tab({storage});view.reads[0].resolve(settings);await view.settle();
    const pending=view.render().selectStage('pack');
    assert.equal(await view.render().selectStage('pick'),false,'only one switch request is allowed');
    view.writes[0].reject(new Error('timeout'));assert.equal(await pending,false);await view.settle();
    assert.equal(view.render().stage,'pick');assert.match(view.render().error,/未確認/);
    assert.equal(storage.get(capabilities.workModeStorageKey(7,'2026-10-13')),'pick');
});

test('cached mode is rejected after a capability removal, and late responses cannot update a different account',async()=>{
    const storage=new Map([[capabilities.workModeStorageKey(7,'2026-10-13'),'pack']]);
    const view=tab({storage});view.reads[0].resolve({...settings,work_types:['pick']});await view.settle();
    assert.equal(view.render().stage,null);assert.equal(await view.render().selectStage('pack'),false);
    const other=tab();other.updateUser({id:8,role:'packer',work_types:['pick','pack']});
    other.reads[0].resolve(settings);await other.settle();assert.equal(other.render().loading,true);
    other.reads[1].resolve({...settings,choice_stage:'pack'});await other.settle();assert.equal(other.render().stage,null);
});

test('leaving the app during a confirmed choice does not update unmounted state or save that choice into a later account',async()=>{
    const view=tab();view.reads[0].resolve(settings);await view.settle();
    const pending=view.render().selectStage('pack');view.unmount();
    view.writes[0].resolve(settings);assert.equal(await pending,false);
    assert.equal(view.updatesAfterUnmount(),0);assert.equal(view.storage.size,0);
});
