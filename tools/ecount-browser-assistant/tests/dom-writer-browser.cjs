// Explicit offline DOM fixture only. All browser network requests are intercepted, including ECOUNT.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
(async()=>{
  if(process.env.WMS_ASSISTANT_LOCAL_TEST!=='1')throw Error('Explicit offline test opt-in required');
  const output=process.env.WMS_ASSISTANT_TEST_OUTPUT,fixturePath=process.env.WMS_ASSISTANT_DOM_FIXTURE;
  if(!output||!path.isAbsolute(output)||!fixturePath||!path.isAbsolute(fixturePath))throw Error('External output and sanitized fixture paths required');
  const root=path.resolve(__dirname,'..'),fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
  const repository=path.resolve(root,'../..');
  if(output===repository||output.startsWith(repository+path.sep))throw Error('Evidence must remain outside the product checkout');
  fs.mkdirSync(output,{recursive:true});
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const attrs=pairs=>(pairs||[]).filter(([key])=>['class','data-item-key','data-sid','data-columnid'].includes(key)).map(([key,value])=>` ${key}="${escape(value)}"`).join('');
  const tableHTML=`<table class="table-grid-input">${fixture.tables[0].rows.map(row=>`<tr${attrs(row.attrs)}>${row.cells.map(cell=>`<td${attrs(cell.attrs)}>${cell.fields.length?cell.fields.map(field=>field.tag==='INPUT'?`<input data-item-key="${escape(field.key)}" value="${escape(field.value)}">`:`<${field.tag.toLowerCase()} data-item-key="${escape(field.key)}">${field.tag==='SPAN'?escape(cell.text):''}</${field.tag.toLowerCase()}>`).join(''):escape(cell.text)}</td>`).join('')}</tr>`).join('')}</table>`;
  const form=`<div id="IInventoryInputPage_TEST"><h1 data-item-key="menu_name_header_data_model">輸入銷貨單(修改)</h1><div data-item-key="data_dt_no_salesXmaster">2026 / 10 / <input data-item-key="day_salesXmaster" value="16" readonly> - 2</div><input data-item-key="cust_salesXmaster-input" value="TEST-WMS-20261016"><input data-item-key="wh_salesXmaster-input" value="003"><button data-item-key="confirm_header_data_model">取消批准</button><button data-item-key="foreign_currency_salesXmaster">新臺幣</button><button data-item-key="template_list_header_data_model">WMS箱號出貨對照</button><button>臨時保存</button>${tableHTML}<button data-item-key="save_footer_toolbar">儲存</button></div>`;
  const html=`<!doctype html><html><head><style>span{display:inline-block;min-width:1px;min-height:1px}td{min-width:24px;padding:3px}input{min-width:30px}textarea{width:190px;height:70px}</style></head><body>${form}</body></html>`;
  const {inspectEcountDocument}=await import(pathToFileURL(root+'/src/dom-adapter.mjs'));
  const {businessSnapshot,fingerprint}=await import(pathToFileURL(root+'/src/engine.mjs'));
  const {chromium}=require(process.env.WMS_PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch({headless:true,args:['--disable-background-networking']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const url='https://loginib.ecount.com/ec56/view/erp';
  await context.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html; charset=utf-8',body:html}):route.abort());
  const companyEvidence={basis:'visible-company-name-and-readonly-tax-id',companyCode:'SYNTHETIC-CO',companyName:'Synthetic company',taxId:'00000000',erpDocumentId:'synthetic-document-id'};
  const base={operation:'read',expected:{companyCode:'SYNTHETIC-CO',voucherNumber:'2026/10/16-2'},companyEvidence};
  const invoke=extra=>page.evaluate(inspectEcountDocument,{...base,...extra});
  const report={synthetic:true,realEcountAcceptance:false,networkRequestsSentToEcount:0,sourceSHA256:createHash('sha256').update(fs.readFileSync(root+'/src/dom-adapter.mjs')).digest('hex'),checks:[],allPassed:false};
  const record=()=>fs.writeFileSync(path.join(output,'dom-writer-acceptance.json'),JSON.stringify(report,null,2));
  const step=async(name,work)=>{try{await work();report.checks.push({name,passed:true});record();console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:String(error.message).slice(0,1600)});record();throw error;}};
  const reset=async(mode='save')=>{await page.goto(url);await page.evaluate(({mode,form})=>{
    const state={mode,metadata:'',saveClicks:0,confirmClicks:0,inventoryPostings:[],quantity:'25',unitPrice:'0.00',approval:'取消批准'};window.syntheticServer=state;
    function bind(){
      const row=[...document.querySelectorAll('tr')].find(row=>row.querySelector('[data-item-key="prod_salesXdetail"]')?.value==='TEST-WMS-20261016');
      const field=row.querySelector('[data-item-key="txt_001_salesXdetail"]');field.textContent=state.metadata;
      field.closest('td').addEventListener('click',()=>{if(row.querySelector('textarea'))return;const editor=document.createElement('textarea');editor.dataset.itemKey='txt_001_salesXdetail';editor.dataset.focusable='true';editor.value=field.textContent;field.replaceWith(editor);editor.addEventListener('blur',()=>{const span=document.createElement('span');span.dataset.itemKey='txt_001_salesXdetail';span.textContent=editor.value;editor.replaceWith(span);});});
      document.querySelector('[data-item-key="save_footer_toolbar"]').addEventListener('click',()=>{
        state.saveClicks++;
        if(state.mode==='warning'){const prompt=document.createElement('div');prompt.textContent='超過按品項安全庫存。要儲存憑證嗎?';prompt.setAttribute('role','dialog');prompt.style.cssText='position:fixed;inset:20%;z-index:999;background:white';const button=document.createElement('button');button.dataset.itemKey='btn_confirm_ok';button.textContent='確定';button.onclick=()=>state.confirmClicks++;prompt.append(button);document.body.append(prompt);return;}
        state.metadata=row.querySelector('[data-item-key="txt_001_salesXdetail"]').textContent;
        document.querySelector('[id^="IInventoryInputPage_"]').remove();
        const anchor=document.createElement('a');anchor.dataset.itemKey='data_dt_no_salesXlist';anchor.href='#';anchor.innerHTML='<span>2026/10/16 -2</span>';anchor.onclick=event=>{event.preventDefault();anchor.remove();document.body.insertAdjacentHTML('beforeend',form);bind();};document.body.append(anchor);
      });
    }bind();
  },{mode,form});};
  const request=async()=>{const before=await invoke();assert.equal(before.ok,true,JSON.stringify(before));return {...base,operation:'save',expectedVersionToken:before.snapshot.versionToken,expectedBusinessFingerprint:await fingerprint(businessSnapshot(before.snapshot)),permit:{saveAllowed:true,testSaveAllowed:true,mode:'test',testWriteEnabled:true,companyCode:base.expected.companyCode,voucherNumber:base.expected.voucherNumber,expiresAt:Date.now()+60000},rows:before.snapshot.rows.map(row=>({rowId:row.rowId,itemCode:row.itemCode,expectedQuantity:row.quantity,previousMetadata:row.metadata,metadata:'[CORELY-WMS:1]N1 出 5 件；N2 出 10 件；N3 出 10 件[/CORELY-WMS:1]'}))};};
  try{
    await reset();
    await step('exact dedicated TEST DOM writer changes only metadata, clicks save once and requires a freshly reopened original',async()=>{
      const before=(await invoke()).snapshot,payload=await request(),result=await page.evaluate(inspectEcountDocument,payload);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.originalFormClosed,true);const server=await page.evaluate(()=>window.syntheticServer);assert.equal(server.saveClicks,1);assert.equal(server.quantity,'25');assert.equal(server.unitPrice,'0.00');assert.equal(server.approval,'取消批准');assert.deepEqual(server.inventoryPostings,[]);assert.equal(server.metadata,payload.rows[0].metadata);assert.equal((await invoke({operation:'locate'})).opening,true);const after=await invoke();assert.equal(after.ok,true,JSON.stringify(after));assert.deepEqual(businessSnapshot(after.snapshot),businessSnapshot(before));assert.equal(after.snapshot.rows[0].metadata,payload.rows[0].metadata);
    });
    await reset('warning');
    await step('a provider safety-stock confirmation is never accepted automatically or reported as saved',async()=>{const payload=await request(),result=await page.evaluate(inspectEcountDocument,payload);assert.equal(result.ok,false);assert.equal(result.errorCode,'SAVE_UI_CONFIRMATION_PENDING');const server=await page.evaluate(()=>window.syntheticServer);assert.equal(server.saveClicks,1);assert.equal(server.confirmClicks,0);assert.equal(server.metadata,'');});
    await reset();
    await step('expired TEST permit does not enter metadata edit or click save',async()=>{const payload=await request();payload.permit.expiresAt=0;const result=await page.evaluate(inspectEcountDocument,payload);assert.equal(result.errorCode,'SAVE_DISABLED_VENDOR_ACCEPTANCE_PENDING');assert.equal(await page.locator('textarea').count(),0);assert.equal(await page.evaluate(()=>window.syntheticServer.saveClicks),0);});
    await reset();
    await step('a native stale-document warning observed in TEST never enables live or claims metadata-only CAS acceptance',async()=>{const payload=await request();await page.evaluate(()=>{const div=document.createElement('div');div.setAttribute('role','alert');div.textContent='已被其他使用者修改過的憑證';document.body.append(div);});const observed=await invoke();assert.equal(observed.ok,true);assert.equal(observed.capabilities.atomicMetadataOnlyUpdate,false);assert.equal(observed.capabilities.optimisticConcurrency,false);payload.permit.mode='live';assert.equal((await page.evaluate(inspectEcountDocument,payload)).errorCode,'SAVE_DISABLED_VENDOR_ACCEPTANCE_PENDING');assert.equal(await page.evaluate(()=>window.syntheticServer.saveClicks),0);});
    await reset();
    await step('changed quantity blocks before metadata editing',async()=>{const payload=await request();await page.locator('[data-item-key="qty_salesXdetail"]').first().evaluate(node=>node.textContent='26');const result=await page.evaluate(inspectEcountDocument,payload);assert.equal(result.ok,false);assert.equal(await page.evaluate(()=>window.syntheticServer.saveClicks),0);assert.equal(await page.locator('textarea').count(),0);});
    await reset();
    await step('format selection uses only the verified visible dropdown item and reads the rebuilt original',async()=>{const before=(await invoke()).snapshot;await page.evaluate(form=>{document.querySelector('[data-item-key="inv_m$txt_001_salesXdetail_thead"]').remove();const unrelated=document.createElement('a');unrelated.textContent='WMS箱號出貨對照';unrelated.onclick=()=>window.unexpectedFormatClick=true;document.body.append(unrelated);const button=document.querySelector('[data-item-key="template_list_header_data_model"]');button.textContent='預設';button.onclick=()=>{const list=document.createElement('ul');list.className='dropdown-menu-item show';list.innerHTML='<li data-item-key="layer_item"><a>WMS箱號出貨對照</a></li>';list.querySelector('a').onclick=()=>{document.querySelector('[id^="IInventoryInputPage_"]').remove();list.remove();document.body.insertAdjacentHTML('afterbegin',form.replace('IInventoryInputPage_TEST','IInventoryInputPage_TEST_REOPEN'));};document.body.prepend(list);};},form);assert.equal((await invoke()).errorCode,'AMBIGUOUS_FORM_FIELD');assert.equal((await invoke({operation:'ensure-format'})).formatSelected,true);const after=await invoke();assert.equal(after.ok,true,JSON.stringify(after));assert.deepEqual(businessSnapshot(after.snapshot),businessSnapshot(before));assert.equal(after.uiEvidence.formId,'IInventoryInputPage_TEST_REOPEN');assert.equal(await page.evaluate(()=>window.unexpectedFormatClick===true),false);});
    await reset();
    await step('plain DIV unfinished-draft warning blocks reads and writes without matching normal temporary-save toolbar',async()=>{assert.equal((await invoke()).ok,true);await page.evaluate(()=>{const div=document.createElement('div');div.textContent='輸入銷貨單(修改)中有臨時儲存的資料。';document.body.append(div);});assert.equal((await invoke()).errorCode,'TEMPORARY_DRAFT');assert.equal(await page.evaluate(()=>window.syntheticServer.saveClicks),0);});
    report.allPassed=true;record();console.log(JSON.stringify({passed:report.checks.length,synthetic:true,realEcountAcceptance:false}));
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
