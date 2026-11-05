const { config,snapshot,businessFingerprint,buildPlan,verifyAfter,mergeMetadata,verifyFrozenAttempt }=require('../services/ecountBrowserContract');
const { enqueueEcountBrowserSafely,createEcountBrowserService,canRetryJob,publicJob }=require('../services/ecountBrowserService');
const { buildEcountManifest,digest }=require('../services/ecountReferenceManifest');
const copy=value=>structuredClone(value);
function manifest(){return buildEcountManifest({order:{id:7,status:'completed',voucher_number:'W7',document_type:'shipment'},items:[{id:11,product_code:'0001',quantity:25,picked_quantity:25,packed_quantity:25,quantity_sign:1}],instances:[],exceptions:[],allocations:[5,10,10].map((quantity,index)=>({id:String(index),carton_id:'N'+(index+1),content_revision:1,status:'packed',lines:[{lineId:index+1,orderItemId:11,itemCode:'0001',quantity,quantitySign:1,actualSN:[]}]}))});}
const binding={company_code:'001234',voucher_number:'2026/10/16-1'};
function before(){return {schemaVersion:1,companyCode:'001234',voucherNumber:'2026/10/16-1',versionToken:'native-v1',capturedAt:'2026-10-16T01:00:00.000Z',customerCode:'0002',warehouseCode:'W1',currencyCode:'TWD',approvalStatus:'approved',linkedDocuments:['source-123'],totals:{netAmount:'25.00',taxAmount:'1.25',grossAmount:'26.25'},otherBusinessFields:{taxType:'1',salesperson:'001'},rows:[{rowId:'1',itemCode:'0001',sourceLineId:null,quantity:'25',unitPrice:'1.00',netAmount:'25.00',taxAmount:'1.25',grossAmount:'26.25',warehouseCode:'W1',actualSN:[],metadata:'既有備註：請保留'}]};}
const testConfig=()=>config({ECOUNT_BROWSER_ASSISTANT_MODE:'test',ECOUNT_BROWSER_ASSISTANT_TEST_WRITE_ENABLED:'true',ECOUNT_BROWSER_ASSISTANT_DOCUMENTS:JSON.stringify([{companyCode:'001234',voucherNumber:'2026/10/16-1'}])});
const caps={acceptanceTestExclusiveDocument:true,atomicMetadataOnlyUpdate:false,optimisticConcurrency:false,versionToken:'native-v1'};
test('disabled enqueue does no SQL or pool work and invalid mode defaults off',async()=>{
 const db={query:jest.fn()};expect(await enqueueEcountBrowserSafely(db,7,{env:{}})).toEqual({enqueued:false,reason:'disabled'});expect(db.query).not.toHaveBeenCalled();expect(config({ECOUNT_BROWSER_ASSISTANT_MODE:'unexpected'}).mode).toBe('off');
});
test('queue failure rolls only to savepoint and allows existing scan transaction to continue',async()=>{
 const calls=[],db={query:jest.fn(async sql=>{calls.push(sql);if(sql.startsWith('SELECT * FROM orders'))throw Object.assign(Error('unavailable'),{code:'42P01'});return{rows:[]};})};
 expect(await enqueueEcountBrowserSafely(db,7,{env:{ECOUNT_BROWSER_ASSISTANT_MODE:'preview'},logger:{warn:jest.fn()}})).toEqual({enqueued:false,reason:'queue_deferred'});
 expect(calls).toEqual(['SAVEPOINT ecount_browser_enqueue','SELECT * FROM orders WHERE id=$1','ROLLBACK TO SAVEPOINT ecount_browser_enqueue','RELEASE SAVEPOINT ecount_browser_enqueue']);
});
test('plan maps N1=5,N2=10,N3=10 without changing original 25 or leading-zero identities',()=>{
 const planned=buildPlan(manifest(),binding,before(),caps,testConfig());expect(planned.saveAllowed).toBe(true);expect(planned.plan.rows[0]).toEqual({rowId:'1',itemCode:'0001',expectedQuantity:'25',metadata:'既有備註：請保留\n[CORELY-WMS:7]WMS-7 | N1 出 5 件; N2 出 10 件; N3 出 10 件[/CORELY-WMS:7]'});expect(planned.before).toEqual(before());
});
test('generated metadata separators use ASCII without normalizing existing notes or literal carton identifiers',()=>{
 const b=before(),planned=buildPlan(manifest(),binding,b,caps,testConfig()),generated=planned.plan.rows[0].metadata.slice(b.rows[0].metadata.length);
 expect(generated).not.toMatch(/[｜；]/);expect(generated).toContain('WMS-7 | N1 出 5 件; N2 出 10 件; N3 出 10 件');
 const literal=manifest();literal.rows[0].cartonId='N｜1；原箱碼';b.rows[0].metadata='原有備註｜保留；不可正規化';
 const result=buildPlan(literal,binding,b,caps,testConfig());expect(result.plan.rows[0].metadata).toMatch(/^原有備註｜保留；不可正規化\n/);expect(result.plan.rows[0].metadata).toContain('N｜1；原箱碼 出 5 件');expect(result.before).toEqual(b);
});
test('metadata changes only own complete block and preserves unrelated bytes including whitespace',()=>{
 const previous='  備註\n[CORELY-WMS:7]old[/CORELY-WMS:7]\n尾端  ';
 expect(mergeMetadata(previous,7,'new')).toBe('  備註\n[CORELY-WMS:7]new[/CORELY-WMS:7]\n尾端  ');
 for(const value of ['[CORELY-WMS:8]other[/CORELY-WMS:8]','[CORELY-WMS:7]bad','[/CORELY-WMS:7][CORELY-WMS:7]','[CORELY-WMS:7]x[/CORELY-WMS:7][CORELY-WMS:8]y[/CORELY-WMS:8]','[CORELY-WMS:7][CORELY-WMS:8]x[/CORELY-WMS:8][/CORELY-WMS:7]'])expect(()=>mergeMetadata(value,7,'new')).toThrow();
});
test('test write needs exact document allowlist, explicit opt-in and exclusive test capability',()=>{
 for(const settings of [config({ECOUNT_BROWSER_ASSISTANT_MODE:'preview'}),{...testConfig(),testWriteEnabled:false},{...testConfig(),documents:[{companyCode:'1234',voucherNumber:'2026/10/16-1'}]},{...testConfig(),documents:[]}])expect(buildPlan(manifest(),binding,before(),caps,settings).saveAllowed).toBe(false);
 expect(buildPlan(manifest(),binding,before(),{...caps,acceptanceTestExclusiveDocument:false},testConfig()).saveAllowed).toBe(false);
 expect(buildPlan(manifest(),binding,before(),{...caps,versionToken:'other'},testConfig()).saveAllowed).toBe(false);
});
test('live save cannot inherit exclusive test permission or a claimed manual line check',()=>{
 const settings={...testConfig(),mode:'live'};expect(buildPlan(manifest(),binding,before(),caps,settings).saveAllowed).toBe(false);
 const live={...settings,acceptanceProof:'a'.repeat(64),concurrencyCapability:'native-compare-and-set'};
 expect(buildPlan(manifest(),binding,before(),caps,live).saveAllowed).toBe(false);
 expect(buildPlan(manifest(),binding,before(),{...caps,atomicMetadataOnlyUpdate:true,optimisticConcurrency:true},live).saveAllowed).toBe(true);
});
test('strict snapshot rejects missing business fields, numerical money conversion and unknown ignored fields',()=>{
 for(const change of [value=>{delete value.approvalStatus;},value=>{value.rows[0].unitPrice=1;},value=>{delete value.rows[0].actualSN;},value=>{value.ignoredWarehouse='W2';},value=>{value.rows[0].quantity='-25';},value=>{value.rows.push(copy(value.rows[0]));}]){const value=before();change(value);expect(()=>snapshot(value)).toThrow();}
});
test.each(['quantity','unitPrice','netAmount','taxAmount','grossAmount','warehouseCode','sourceLineId','itemCode','actualSN'])('readback refuses changed row business field %s',field=>{
 const b=before(),planned=buildPlan(manifest(),binding,b,caps,testConfig()),after=copy(b);after.rows[0].metadata=planned.plan.rows[0].metadata;
 after.rows[0][field]=field==='actualSN'?['not-the-same']:field==='sourceLineId'?'new-source':field==='quantity'?'24':['itemCode','warehouseCode'].includes(field)?'different':'2.00';
 expect(()=>verifyAfter(b,after,planned.plan)).toThrow();
});
test.each(['customerCode','warehouseCode','currencyCode','approvalStatus','linkedDocuments','totals','otherBusinessFields'])('readback refuses changed document business field %s',field=>{
 const b=before(),planned=buildPlan(manifest(),binding,b,caps,testConfig()),after=copy(b);after.rows[0].metadata=planned.plan.rows[0].metadata;
 after[field]=field==='linkedDocuments'?[]:field==='totals'?{...after.totals,grossAmount:'26.24'}:field==='otherBusinessFields'?{taxType:'2'}:'different';expect(()=>verifyAfter(b,after,planned.plan)).toThrow();
});
test('only expected metadata and observation/version may differ; partial or wrong readback cannot succeed',()=>{
 const b=before(),planned=buildPlan(manifest(),binding,b,caps,testConfig()),after=copy(b);after.versionToken='native-v2';after.capturedAt='2026-10-16T01:01:00.000Z';after.rows[0].metadata=planned.plan.rows[0].metadata;
 expect(businessFingerprint(b)).toBe(businessFingerprint(after));expect(verifyAfter(b,after,planned.plan)).toEqual(after);
 after.rows[0].metadata+='unexpected';expect(()=>verifyAfter(b,after,planned.plan)).toThrow();
});
test('same SKU duplicate rows never guess without exact unique source row matching',()=>{
 const b=before();b.rows[0].quantity='5';b.rows.push({...copy(b.rows[0]),rowId:'2',quantity:'20'});expect(()=>buildPlan(manifest(),binding,b,caps,testConfig())).toThrow();
});
test('wrong company, wrong dated voucher, signed order and incomplete shipment cannot prepare',()=>{
 for(const patch of [{companyCode:'1234'},{voucherNumber:'2026/10/16-2'}])expect(()=>buildPlan(manifest(),binding,{...before(),...patch},caps,testConfig())).toThrow();
 const m=manifest();m.ready=false;expect(()=>buildPlan(m,binding,before(),caps,testConfig())).toThrow();
});
test('fresh role and actor identity are checked even when browser feature disabled',async()=>{
 for(const [user,body,status]of [[{id:3,role:'picker'},{expectedActorId:3},403],[{id:3,role:'admin'},{expectedActorId:4},409],[null,{expectedActorId:3},401]]){
  const db={release:jest.fn(),query:jest.fn(async sql=>({rows:sql.startsWith('SELECT id,username')&&user?[user]:[]}))};
  const service=createEcountBrowserService({pool:{connect:async()=>db},env:{}});
  await expect(service.claim({...body,commandId:'00000000-0000-4000-8000-000000000001',workerId:'00000000-0000-4000-8000-000000000002'},{id:3,role:'superadmin'})).rejects.toMatchObject({status});
  expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
 }
});
test('retry eligibility never treats unknown, prepared or verified jobs as safe to resend',()=>{
 for(const status of ['queued','claimed','prepared','uncertain','verified','test_verified','superseded_verified','blocked','superseded'])expect(canRetryJob({status,plan:{saveAllowed:false},definite_no_save:true})).toBe(false);
 expect(canRetryJob({status:'previewed',plan:{saveAllowed:false}})).toBe(true);
 expect(canRetryJob({status:'previewed',plan:{saveAllowed:true}})).toBe(false);
 expect(canRetryJob({status:'failed',definite_no_save:true})).toBe(true);
 for(const definite_no_save of [false,undefined,null,'true'])expect(canRetryJob({status:'failed',definite_no_save})).toBe(false);
 expect(publicJob({status:'failed',definite_no_save:true}).canRetry).toBe(true);
});
test('company proof mappings preserve exact configured identity only in test mode, without inventing allowed sale documents',()=>{
 const mappings=[{companyCode:'00001234',companyName:'合成測試公司甲',taxId:'12345678'},{companyCode:'00005678',companyName:'合成測試公司乙',taxId:'87654321'}];
 const env={ECOUNT_BROWSER_ASSISTANT_MODE:'test',ECOUNT_BROWSER_ASSISTANT_COMPANIES:JSON.stringify(mappings)};
 expect(config(env).companyMappings).toEqual(mappings);expect(config(env).documents).toEqual([]);
 for(const mode of ['off','preview','live','invalid'])expect(config({...env,ECOUNT_BROWSER_ASSISTANT_MODE:mode}).companyMappings).toEqual([]);
});
test('ambiguous, oversized or malformed company proof mappings fail closed as a whole',()=>{
 const original={companyCode:'00001234',companyName:'合成測試公司甲',taxId:'12345678'};
 const invalid=[null,{},'invalid-json',[{...original,companyCode:'x'.repeat(65)}],[{...original,companyName:'x'.repeat(129)}],[{...original,companyCode:' 00001234'}],[{...original,companyName:'公司\n甲'}],[{...original,taxId:12345678}],[{...original,taxId:'1234567'}],[{...original,expectedCompanyCode:'other'}],Array.from({length:101},(_,i)=>({...original,companyCode:String(i),companyName:String(i),taxId:String(i).padStart(8,'0')}))];
 for(const key of ['companyCode','companyName','taxId'])invalid.push([original,{companyCode:'other-code',companyName:'other-name',taxId:'87654321',[key]:original[key]}]);
 for(const value of invalid)expect(config({ECOUNT_BROWSER_ASSISTANT_MODE:'test',ECOUNT_BROWSER_ASSISTANT_COMPANIES:JSON.stringify(value)}).companyMappings).toEqual([]);
 expect(config({ECOUNT_BROWSER_ASSISTANT_MODE:'test',ECOUNT_BROWSER_ASSISTANT_COMPANIES:'not-json'}).companyMappings).toEqual([]);
});
test('historical readback proves the exact frozen before/plan/document without trusting replacement WMS data',()=>{
 const b=before(),prepared=buildPlan(manifest(),binding,b,caps,testConfig()),plan={...prepared.plan,saveAllowed:true,acceptanceProof:null,mode:'test',testWriteEnabled:true};
 const job={company_code:binding.company_code,voucher_number:binding.voucher_number,before_snapshot:b,plan,plan_fingerprint:digest(plan)};
 const after=copy(b);after.rows[0].metadata=plan.rows[0].metadata;after.versionToken='after-save';
 expect(verifyFrozenAttempt(job,after)).toEqual(after);
 for(const change of [value=>{value.company_code='other';},value=>{value.voucher_number='2026/10/16-2';},value=>{value.plan.saveAllowed=false;},value=>{value.plan.rows[0].metadata='forged';},value=>{value.before_snapshot.rows[0].quantity='24';},value=>{value.plan_fingerprint='a'.repeat(64);}]){const changed=copy(job);change(changed);expect(()=>verifyFrozenAttempt(changed,after)).toThrow();}
 const changedAfter=copy(after);changedAfter.rows[0].unitPrice='999.00';expect(()=>verifyFrozenAttempt(job,changedAfter)).toThrow();
});
