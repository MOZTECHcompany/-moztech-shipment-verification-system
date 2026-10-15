import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCompanyMappings,inspectEcountCompany } from '../src/company-evidence.mjs';
const mapping={companyCode:'TEST-CO',companyName:'TEST COMPANY',taxId:'12345678'};
test('company mappings are explicit and reject aliases, unknown keys or ambiguous legal identities',()=>{assert.deepEqual(validateCompanyMappings([mapping]),[mapping]);assert.deepEqual(validateCompanyMappings(undefined),[]);for(const rows of [[mapping,{...mapping,companyCode:'OTHER'}],[mapping,{...mapping,companyName:'OTHER'}],[{...mapping,taxId:'123'}],[{...mapping,token:'never'}]])assert.throws(()=>validateCompanyMappings(rows));});
test('company proof reads only visible company name and readonly tax identifier',()=>{
  const element=value=>({value,getClientRects:()=>[{}]});
  const name=element(mapping.companyName),tax={...element(mapping.taxId),readOnly:true};
  const form={textContent:'公司基本資訊',getClientRects:()=>[{}],querySelector:selector=>selector==='#tabBasic'?{}:null,querySelectorAll:selector=>selector==='input[data-cid="COM_DES"]'?[name]:selector==='input[data-cid="BUSINESS_NO"]'?[tax]:[]};
  globalThis.window={};window.top=window;globalThis.location={origin:'https://loginib.ecount.com',pathname:'/ec56/view/erp'};globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.document={querySelectorAll:selector=>selector==='[id^="EMG004M_"]'?[form]:[]};
  assert.deepEqual(inspectEcountCompany(),{ok:true,companyName:mapping.companyName,taxId:mapping.taxId});
  tax.readOnly=false;assert.equal(inspectEcountCompany().errorCode,'COMPANY_ID_NOT_VERIFIED');tax.readOnly=true;
  location.origin='https://evil.example';assert.equal(inspectEcountCompany().errorCode,'ERP_ORIGIN_NOT_ALLOWED');
  delete globalThis.window;delete globalThis.location;delete globalThis.getComputedStyle;delete globalThis.document;
});
