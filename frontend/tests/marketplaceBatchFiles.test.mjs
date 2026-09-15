import test from 'node:test';
import assert from 'node:assert/strict';
import {savedBatchTables} from '../src/utils/marketplaceBatchFiles.mjs';
const r={batchNumber:'SYN',platform:'Shopify',store:'Synthetic',settings:{date:'2026-09-16',skuMappings:{NEW0012:{erpSku:'NEW0012',erpName:'Film',barcode:'not-confirmed',barcodeConfirmed:false}}},prepick:{headers:['SKU','Qty'],rows:[['NEW0012',2]]},reportHeaders:['Order','Total'],reportRows:[['SYN-01',123]],items:[{sku:'NEW0012',sourceOrderNumber:'SYN-01',sourceLineId:'LINE-1',quantity:2,lineSubtotalMinor:12300}],links:[{source_order_number:'SYN-01',work_barcode:'WT-SYN'}]};
test('saved downloads preserve exact source identifier, amounts and work barcode without current converter draft',()=>{
 const tables=savedBatchTables(r,'prepick');
 assert.deepEqual(tables[1].rows,[['SKU','Qty'],['NEW0012',2]]);
 assert.deepEqual(tables[2].rows[1],['SYN-01','LINE-1','NEW0012','NEW0012','Film','',2,123,'WT-SYN']);
 assert.match(tables[0].rows.flat().join(' '),/不是 ECOUNT 理貨回匯檔/);
 const confirmed=structuredClone(r);confirmed.settings.skuMappings.NEW0012.barcodeConfirmed=true;confirmed.settings.skuMappings.NEW0012.barcode='0012';
 assert.equal(savedBatchTables(confirmed,'prepick')[2].rows[1][5],'0012');
});
