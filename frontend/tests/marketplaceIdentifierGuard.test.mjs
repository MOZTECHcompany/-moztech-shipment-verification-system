import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {prepareEcountFinancials,groupedSalesRecord,productIdentifierIssue} from '../src/utils/marketplaceIntake.mjs';
const require=createRequire(import.meta.url);
const {verifyCatalogMappings}=require('../../backend/src/services/marketplaceProductCatalog.js');
test('damaged saved snapshots cannot be redownloaded or regrouped',()=>{
 const record={items:[{sku:'4.71E+12'}],settings:{salesExportMode:'product-200-v1'}};
 assert.throws(()=>prepareEcountFinancials(record),/科學記號/);
 assert.throws(()=>prepareEcountFinancials(groupedSalesRecord(record)),/科學記號/);
});
test('catalog verification rejects damaged source or mapping even without a reference file',async()=>{
 for(const mapping of [{key:'4.71E+12',erpSku:'4711299273094'},{key:'OK',erpSku:'4.71E+12'},{key:'OK',erpSku:'OK',barcode:'4.71E+12'}]){
  await assert.rejects(verifyCatalogMappings(null,{skuMappings:{[mapping.key]:mapping}},[mapping.key],async()=>null),/科學記號/);
 }
});
test('numeric display formatting is distinct from lossy scientific-notation text',()=>{
 assert.equal(productIdentifierIssue(4711299273094),'');
 for(const s of ['00001','NEW47112992730942','47112992713422','SKU-1E2'])assert.equal(productIdentifierIssue(s),'');
 assert.match(productIdentifierIssue(9007199254740992),/精度/);
});
