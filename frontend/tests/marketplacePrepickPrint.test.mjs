import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as intake from '../src/utils/marketplaceIntake.mjs';

const require=createRequire(import.meta.url);
const source=await fs.readFile(new URL('../src/components/admin/MarketplacePrepickPrint.jsx',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'jsx',format:'cjs'}),module={exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require:name=>{
 if(name==='../../utils/marketplaceIntake.mjs')return intake;
 if(name==='../../ui')return {Button:({children})=>React.createElement('button',null,children)};
 if(name==='react-to-print')return {useReactToPrint:()=>()=>{}};
 return require(name);
}});

test('printing an old batch uses its effective marketplace name and ERP specification without rewriting the saved prepick',()=>{
 const record={batchNumber:'WMS-PRINT',platform:'Shopify',store:'測試店鋪',settings:{date:'2026-10-02',skuMappings:{NEW0001:{erpSku:'ERP0001',erpName:'ERP 過短品名',spec:'iPhone Pro'}}},items:[{sku:'NEW0001',productName:'商城保護貼 iPhone Pro（無貼膜神器）'}],prepick:{headers:['分類（對照設定）','來源SKU','ECOUNT品項編碼','已確認國際條碼','商品名稱','實體數量','商城訂單數','來源商城訂單','來源組合／分組','用途'],rows:[['未分類','NEW0001','ERP0001','0001','ERP 過短品名',2,1,'ORDER-1','','預揀']]}};
 const before=structuredClone(record);
 const html=renderToStaticMarkup(React.createElement(module.exports.default,{record,isCurrentSession:()=>true}));
 assert.match(html,/商城保護貼 iPhone Pro（無貼膜神器）/);
 assert.match(html,/規格：iPhone Pro/);
 assert.match(html,/ERP0001/);assert.match(html,/0001/);
 assert.doesNotMatch(html,/ERP 過短品名/);
 assert.deepEqual(record,before);
});
