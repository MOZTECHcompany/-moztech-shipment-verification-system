import * as scope from '../src/utils/managementScope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const source=await fs.readFile(new URL('../src/components/WarehouseRelease.jsx',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'jsx',format:'cjs'}),module={exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require:name=>{
 if(name==='@/api/api.js')return {};
 if(name==='@/utils/managementScope')return scope;
 if(name==='@/ui')return {Button:()=>null};
 if(name==='./OrderBarcode')return {OrderBarcode:({value,label})=>React.createElement('span',{'data-barcode':value},label)};
 if(name==='react-to-print')return {useReactToPrint:()=>()=>{}};
 return require(name);
}});
test('one print packet includes the whole prepick sheet and every independently barcoded order beyond one screen',()=>{
 const orders=Array.from({length:75},(_,i)=>({id:i+1,source_order_number:'ORDER-'+i,work_barcode:'WT'+String(i).padStart(18,'0'),expected_items:[{productCode:'SKU',productName:'商品',barcode:'000123',quantity:2}]}));
 const data={batch:{batch_number:'WMS-TEST',source_platform:'Shopify',source_store:'測試'},flow:{print_owner_name:'主管',erp_receipt:{vouchers:['ERP-1']}},orders,products:[{productCode:'SKU',productName:'商品',barcode:'000123',quantity:150}]};
 const html=renderToStaticMarkup(React.createElement(module.exports.WarehousePaper,{data,kind:'all'}));
 assert.equal((html.match(/Corely WMS · 預揀總表/g)||[]).length,1);
 assert.equal((html.match(/Corely WMS · 訂單作業明細/g)||[]).length,75);
 assert.equal((html.match(/data-barcode="WT/g)||[]).length,75);
 assert.equal((html.match(/data-barcode="000123"/g)||[]).length,76);
 assert.match(html,/ORDER-74/);assert.match(html,/150/);assert.match(html,/page-break-after:always/);
});

test('order papers show concise delivery information per order while the prepick total stays anonymous',()=>{
 const data={batch:{batch_number:'WMS-SHIPPING',source_platform:'Shopify',source_store:'測試'},flow:{erp_receipt:{vouchers:['ERP-SHIPPING']}},orders:[{id:1,source_order_number:'DELIVERY-1',work_barcode:'WTDELIVERY1',shipping:{recipient:'收件甲',phone:'0900000000',address:'測試地址 1 號',postalCode:'00100',method:'超商取貨付款',storeName:'測試門市',storeCode:'000123',trackingNumber:'000456',note:'外盒 <請保留>'},expected_items:[{productCode:'SKU',productName:'商品',barcode:'000123',quantity:1}]},{id:2,source_order_number:'LEGACY-2',work_barcode:'WTLEGACY2',expected_items:[{productCode:'SKU',productName:'商品',barcode:'000123',quantity:1}]}],products:[{productCode:'SKU',productName:'商品',barcode:'000123',quantity:2}]};
 const html=renderToStaticMarkup(React.createElement(module.exports.WarehousePaper,{data,kind:'all'}));
 for(const value of ['收件：收件甲 · 0900000000','地址：00100 測試地址 1 號','配送：超商取貨付款 · 測試門市 · 000123','物流單號：000456','出貨備註：外盒 &lt;請保留&gt;'])assert.ok(html.includes(value),value);
 assert.equal((html.match(/收件：/g)||[]).length,1);
 assert.equal((html.match(/data-barcode="WT/g)||[]).length,2);
 assert.equal((html.match(/data-barcode="000123"/g)||[]).length,3);
 const prepick=renderToStaticMarkup(React.createElement(module.exports.WarehousePaper,{data,kind:'prepick'}));
 assert.doesNotMatch(prepick,/收件甲|0900000000|測試地址|外盒/);
 const legacy=renderToStaticMarkup(React.createElement(module.exports.WarehousePaper,{data:{...data,orders:[data.orders[1]]},kind:'orders'}));
 assert.doesNotMatch(legacy,/收件：|地址：|配送：|物流單號：|出貨備註：/);
});
