import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
const {code}=await transform(await readFile(new URL('../src/api/api.js',import.meta.url),'utf8'),{loader:'js',format:'cjs'});
function tab(token){
 const session=new Map([['wms_token',JSON.stringify(token)]]);let beforeRequest;
 const client={interceptors:{request:{use:cb=>{beforeRequest=cb;}},response:{use(){}}}};
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,console,sessionStorage:{getItem:key=>session.get(key)},localStorage:{getItem:()=>JSON.stringify('other-tab-token')},require:name=>name==='axios'?{create:()=>client}:name==='sonner'?{toast:{error(){}}}: {API_ORIGIN:''}});
 return {session,request:()=>beforeRequest({headers:{}})};
}
test('old tab expiration cannot overwrite another station credential or borrow its token',()=>{
 const pick=tab('pick-token'),pack=tab('pack-token');
 assert.equal(pick.request().headers.Authorization,'Bearer pick-token');
 assert.equal(pack.request().headers.Authorization,'Bearer pack-token');
 pick.session.set('wms_token','null');
 assert.equal(pick.request().headers.Authorization,undefined);
 assert.equal(pack.request().headers.Authorization,'Bearer pack-token');
});
