// Offline Chrome DOM contract checks using sanitized company form structure.
// Every https request is intercepted before networking; this is not ECOUNT acceptance.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
(async()=>{
    if(process.env.WMS_ASSISTANT_LOCAL_TEST!=='1')throw Error('Explicit synthetic opt-in required');
    const root=path.resolve(__dirname,'../..'),output=process.env.WMS_ASSISTANT_TEST_OUTPUT,fixturePath=process.env.WMS_ASSISTANT_DOM_FIXTURE;
    if(!output||!path.isAbsolute(output)||!fixturePath||!path.isAbsolute(fixturePath))throw Error('External evidence and sanitized fixture paths required');
    const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8')),escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const attrs=pairs=>(pairs||[]).filter(([key])=>['class','data-item-key','data-sid','data-columnid'].includes(key)).map(([key,value])=>` ${key}="${escape(value)}"`).join('');
    const table=fixture.tables[0];
    const tableHTML=`<table class="table-grid-input">${table.rows.map(row=>`<tr${attrs(row.attrs)}>${row.cells.map(cell=>`<td${attrs(cell.attrs)}>${cell.fields.length?cell.fields.map(field=>field.tag==='INPUT'?`<input data-item-key="${escape(field.key)}" value="${escape(field.value)}">`:`<${field.tag.toLowerCase()} data-item-key="${escape(field.key)}">${field.tag==='SPAN'?escape(cell.text):''}</${field.tag.toLowerCase()}>`).join(''):escape(cell.text)}</td>`).join('')}</tr>`).join('')}</table>`;
    const formHTML=`<!doctype html><html><head><style>span{display:inline-block;min-width:1px;min-height:1px}td{min-width:20px;padding:3px}input{min-width:30px}</style></head><body><div id="IInventoryInputPage_TEST"><h1 data-item-key="menu_name_header_data_model">輸入銷貨單(修改)</h1><div data-item-key="data_dt_no_salesXmaster">2026 / 10 / <input data-item-key="day_salesXmaster" value="16" readonly> - 2</div><input data-item-key="cust_salesXmaster-input" value="TEST-WMS-20261016"><input data-item-key="wh_salesXmaster-input" value="TEST-WAREHOUSE"><button data-item-key="confirm_header_data_model">批准</button><button data-item-key="foreign_currency_salesXmaster">新臺幣</button><button>臨時保存</button>${tableHTML}</div></body></html>`;
    const {inspectEcountDocument}=await import(pathToFileURL(root+'/tools/ecount-browser-assistant/src/dom-adapter.mjs'));
    const {inspectEcountCompany}=await import(pathToFileURL(root+'/tools/ecount-browser-assistant/src/company-evidence.mjs'));
    const {businessFingerprint}=require('../src/services/ecountBrowserContract');
    const {chromium}=require(process.env.WMS_PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch({headless:true});
    const context=await browser.newContext(),page=await context.newPage(),url='https://loginib.ecount.com/ec56/view/erp';
    const report={synthetic:true,realEcountAcceptance:false,networkRequestsSentToEcount:0,fixtureSHA256:createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'),checks:[],allPassed:false};
    const write=()=>fs.writeFileSync(path.join(output,'dom-browser-acceptance.json'),JSON.stringify(report,null,2));
    await context.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html; charset=utf-8',body:formHTML}):route.abort());
    const step=async(name,work)=>{try{await work();report.checks.push({name,passed:true});write();console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:String(error.message).slice(0,2000)});write();throw error;}};
    const companyEvidence={basis:'visible-company-name-and-readonly-tax-id',companyCode:'SYNTHETIC-CO',companyName:'Synthetic test company',taxId:'00000000',erpDocumentId:'synthetic-native-document-id'};
    const input={operation:'read',expected:{companyCode:'SYNTHETIC-CO',voucherNumber:'2026/10/16-2'},companyEvidence};
    const read=extra=>page.evaluate(inspectEcountDocument,{...input,...extra});
    const reset=()=>page.goto(url);
    let before;
    try{
        await reset();
        await step('company reader requires a visible unique form and readonly eight-digit tax identity',async()=>{
            await page.setContent('<div id="EMG004M_TEST">公司基本資訊<div id="tabBasic"><input data-cid="COM_DES" value="Synthetic test company"><input data-cid="BUSINESS_NO" value="00000000" readonly></div></div>');
            assert.deepEqual(await page.evaluate(inspectEcountCompany),{ok:true,companyName:'Synthetic test company',taxId:'00000000'});
            await page.locator('[data-cid="BUSINESS_NO"]').evaluate(el=>el.readOnly=false);assert.equal((await page.evaluate(inspectEcountCompany)).errorCode,'COMPANY_ID_NOT_VERIFIED');await reset();
        });
        await step('sanitized actual semantic grid reads the locked TEST voucher and preserves its twenty-five units and zero amounts',async()=>{
            const result=await read();assert.equal(result.ok,true,JSON.stringify(result));before=result.snapshot;
            assert.equal(before.voucherNumber,'2026/10/16-2');assert.equal(before.rows.length,1);assert.equal(before.rows[0].itemCode,'TEST-WMS-20261016');assert.equal(before.rows[0].quantity,'25');assert.equal(before.rows[0].unitPrice,'0.00');
            assert.equal(result.capabilities.identityLocked,true);assert.equal(result.capabilities.acceptanceTestExclusiveDocument,true);assert.equal(result.capabilities.optimisticConcurrency,false);
        });
        await step('job expected identity is never used as evidence of the current company',async()=>{
            assert.equal((await read({companyEvidence:undefined})).errorCode,'COMPANY_ID_NOT_VERIFIED');
            assert.equal((await read({expected:{companyCode:'OTHER-COMPANY',voucherNumber:'2026/10/16-2'}})).errorCode,'WRONG_DOCUMENT');
        });
        await step('ordinary temporary-save toolbar is allowed but an unfinished-draft alert blocks all document reads',async()=>{
            assert.equal((await read()).ok,true);await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<div role="alert" id="draft-test">上次暫存資料，要繼續套用嗎？</div>'));
            assert.equal((await read()).errorCode,'TEMPORARY_DRAFT');await page.locator('#draft-test').evaluate(el=>el.remove());
        });
        await step('repeated same SKU cannot be inferred from grid position',async()=>{
            await page.locator('tr.grid-input-first-line').first().evaluate(el=>el.after(el.cloneNode(true)));assert.equal((await read()).errorCode,'AMBIGUOUS_SAME_ITEM_ROWS');await reset();
        });
        await step('unlocked voucher dates and missing business columns fail closed',async()=>{
            await page.locator('[data-item-key="day_salesXmaster"]').evaluate(el=>el.readOnly=false);assert.equal((await read()).errorCode,'VOUCHER_ID_NOT_LOCKED');await reset();
            await page.locator('[data-item-key="inv_m$supply_amt_salesXdetail_thead"]').evaluate(el=>el.remove());assert.equal((await read()).errorCode,'AMBIGUOUS_FORM_FIELD');await reset();
        });
        await step('unverified SN detail cannot be silently treated as a non-SN line',async()=>{
            await page.locator('[data-item-key="serial_array_salesXdetail"]').first().evaluate(el=>el.textContent='000Case/01');assert.equal((await read()).errorCode,'SERIAL_DETAIL_NOT_VERIFIED');await reset();
        });
        await step('changing only carton metadata changes observation token but preserves the complete sales business fingerprint',async()=>{
            await page.locator('[data-item-key="txt_001_salesXdetail"]').first().evaluate(el=>el.textContent='Original note\n[CORELY-WMS:999]N1 出 5 件；N2 出 10 件；N3 出 10 件[/CORELY-WMS:999]');
            const after=(await read()).snapshot;assert.notEqual(after.versionToken,before.versionToken);assert.equal(businessFingerprint(after),businessFingerprint(before));assert.equal(after.rows[0].quantity,'25');
        });
        await step('saving remains disabled even with a fully readable original voucher',async()=>{
            const original=await page.locator('body').innerHTML();assert.equal((await read({operation:'save',permit:{saveAllowed:true}})).errorCode,'SAVE_DISABLED_VENDOR_ACCEPTANCE_PENDING');assert.equal(await page.locator('body').innerHTML(),original);
        });
        report.allPassed=true;write();console.log(JSON.stringify({passed:report.checks.length,realEcountAcceptance:false}));
    }finally{await context.close();await browser.close();fs.writeFileSync(path.join(output,'dom-browser-cleanup.json'),JSON.stringify({owner:'/root/ecount_assistant_validation',browserClosed:true,interceptedAllNetwork:true,productionTouched:false},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
