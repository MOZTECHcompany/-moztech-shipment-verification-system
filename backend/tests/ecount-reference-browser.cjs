// Actual Chrome + actual WMS API. All records and accounts belong to a disposable loopback fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const xlsx = require('xlsx');

(async () => {
    if (process.env.WMS_ECOUNT_REFERENCE_LOCAL_DEV !== '1') throw Error('Synthetic local opt-in required');
    const output = process.env.WMS_ECOUNT_REFERENCE_OUTPUT;
    if (!output) throw Error('Local evidence directory required');
    const fixtures = JSON.parse(fs.readFileSync(path.join(output, 'browser-fixtures.json'), 'utf8'));
    const { apiBase, webBase } = fixtures;
    if (![apiBase,webBase].every(url => /^http:\/\/127\.0\.0\.1:55\d{3}$/.test(url))) throw Error('Dedicated loopback targets required');
    const root = path.resolve(__dirname, '../..'), originalCwd = process.cwd();
    process.chdir(root + '/frontend');
    const { createServer } = await import(path.join(path.dirname(require.resolve('vite', { paths:[root + '/frontend/node_modules'] })), 'dist/node/index.js'));
    const vite = await createServer({root:root+'/frontend',configFile:root+'/frontend/vite.config.js',logLevel:'error',optimizeDeps:{include:['react-chartjs-2','chart.js']},server:{host:'127.0.0.1',port:Number(new URL(webBase).port),strictPort:true,proxy:{'/api':{target:apiBase},'/socket.io':{target:apiBase,ws:true}}}});
    await vite.listen();
    const { chromium } = require(process.env.WMS_PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({headless:true,executablePath:process.env.WMS_CHROME_EXECUTABLE || undefined});
    const report = {scope:'synthetic loopback UI/API; manual metadata only; no real ECOUNT connection, notifications or production data',checks:[],pageErrors:[],externalRequests:[],externalStaticResources:[],requests:[]};
    const contexts=[],pages=[];
    const write = () => fs.writeFileSync(path.join(output,'browser-acceptance.json'),JSON.stringify(report,null,2));
    const card = page => page.getByRole('region',{name:'ECOUNT銷貨對照',exact:true});
    const dialog = page => page.getByRole('dialog',{name:'ECOUNT銷貨對照',exact:true});
    async function login(username,viewport={width:1440,height:1050}) {
        const context=await browser.newContext({viewport,timezoneId:'Asia/Taipei',acceptDownloads:true});contexts.push(context);
        const page=await context.newPage();pages.push(page);page.setDefaultTimeout(15000);
        page.on('pageerror',error=>report.pageErrors.push(error.message));
        page.on('request',req=>{const url=new URL(req.url());if(/^https?:$/.test(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)){const record={method:req.method(),host:url.hostname,path:url.pathname};if(req.method()==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))report.externalStaticResources.push(record);else report.externalRequests.push(record);}if(req.method()==='POST'&&url.pathname.endsWith('/ecount-reference'))report.requests.push({path:url.pathname,body:req.postDataJSON()});});
        await page.goto(webBase+'/login');await page.locator('#corely-username').fill(username);await page.locator('#corely-password').fill('ecount-reference-fixture-only');
        await page.getByRole('button',{name:'登入系統',exact:true}).click();await page.waitForURL('**/tasks');return page;
    }
    async function api(page,method,url,data,status=200) {
        const token=await page.evaluate(()=>JSON.parse(localStorage.getItem('wms_token')));
        const res=await page.request.fetch(apiBase+url,{method,headers:{Authorization:`Bearer ${token}`},...(data===undefined?{}:{data})});
        assert.equal(res.status(),status,`${method} ${url}: ${await res.text()}`);return res.json();
    }
    async function openOrder(page,id){await page.goto(`${webBase}/order/${id}?stage=pack`);await card(page).getByRole('button',{name:'複製箱號摘要',exact:true}).waitFor();await page.waitForFunction(()=>{const e=document.querySelector('section[aria-label="ECOUNT銷貨對照"]');return e&&!e.innerText.includes('載入中')&&!e.innerText.includes('尚未載入');});}
    async function openDialog(page){await card(page).getByRole('button',{name:'銷貨單核對',exact:true}).click();await dialog(page).waitFor();return dialog(page);}
    const post = (page,id,action,status=200) => Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/api/orders/${id}/ecount-reference`&&r.request().method()==='POST'),action()]).then(async([r])=>{assert.equal(r.status(),status,await r.text());return r.json();});
    async function expandManual(d){const summary=d.getByText('人工核對原單',{exact:true});if(!await summary.evaluate(e=>e.parentElement.open))await summary.click();}
    async function manual(d,text){await expandManual(d);await d.getByLabel('ECOUNT原單明細',{exact:true}).fill(text);await d.getByLabel('已存在原ECOUNT銷貨單',{exact:true}).check();await d.getByLabel('已補箱號且不重複扣庫',{exact:true}).check();}
    async function step(name,run){try{await run();report.checks.push({name,passed:true});write();console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,message:String(error?.message||error).slice(0,1200)});for(const[i,p]of pages.entries()){await p.screenshot({path:path.join(output,`failure-${report.checks.length}-${i}.png`),fullPage:true}).catch(()=>{});report.failurePage={url:p.url(),body:(await p.locator('body').innerText()).slice(-5000)};}write();throw error;}}
    async function download(page,label,file){const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const result=await pending;const target=path.join(output,file);await result.saveAs(target);const book=xlsx.readFile(target);assert.ok(book.SheetNames.includes('說明'));const notes=xlsx.utils.sheet_to_json(book.Sheets['說明'],{header:1});assert.ok(JSON.stringify(notes).includes('不重複扣庫存'));return book;}
    try {
        const dispatcher=await login('fixture-dispatcher');
        await step('dispatcher sees only packed N1 tail5 plus N2/N3 ten each; original reference dialog does not prefill external evidence',async()=>{
            await openOrder(dispatcher,fixtures.target25);const c=card(dispatcher);await c.getByText('未綁定',{exact:true}).waitFor();assert.ok((await c.innerText()).includes('25 件'));assert.equal(await c.getByRole('cell',{name:'N-RELEASED',exact:true}).count(),0);
            const d=await openDialog(dispatcher);assert.equal(await d.getByLabel('ECOUNT公司代碼',{exact:true}).inputValue(),'');assert.equal(await d.getByLabel('原ECOUNT銷貨單號',{exact:true}).inputValue(),'');await expandManual(d);assert.equal(await d.getByLabel('ECOUNT原單明細',{exact:true}).inputValue(),'');await d.getByRole('button',{name:'關閉',exact:true}).last().click();
            await dispatcher.screenshot({path:path.join(output,'packed25-reference-desktop.png'),fullPage:true});
        });
        await step('saving the existing sales number remains pending manual check; incorrect external quantity is rejected before exact manual confirmation',async()=>{
            const d=await openDialog(dispatcher);await d.getByLabel('ECOUNT公司代碼',{exact:true}).fill('SYNTHETIC-EC');await d.getByLabel('原ECOUNT銷貨單號',{exact:true}).fill('2026/10/15 -00025');
            const saved=await post(dispatcher,fixtures.target25,()=>d.getByRole('button',{name:'儲存單號',exact:true}).click());assert.equal(saved.status,'reference_only');assert.equal(saved.reference.voucherNumber,'2026/10/15-25');await card(dispatcher).getByText('待人工核對',{exact:true}).waitFor();
            await openDialog(dispatcher);await expandManual(d);assert.equal(await d.getByLabel('ECOUNT原單明細',{exact:true}).inputValue(),'');await manual(d,'品項\t數量\t序號/批號\nSKU-25\t26.00\t');await post(dispatcher,fixtures.target25,()=>d.getByRole('button',{name:'儲存人工核對',exact:true}).click(),409);await d.getByRole('alert').filter({hasText:'不一致'}).waitFor();
            await manual(d,'品項\t數量\t序號/批號\nSKU-25\t25.00\t');const checked=await post(dispatcher,fixtures.target25,()=>d.getByRole('button',{name:'儲存人工核對',exact:true}).click());assert.equal(checked.status,'manual_checked');assert.equal(checked.reference.confirmedBy.id,4);await card(dispatcher).getByText('已人工核對',{exact:true}).waitFor();
            const snapshot=await api(dispatcher,'GET',`/api/orders/${fixtures.target25}/work-snapshot`);assert.equal(snapshot.order.status,'completed');assert.equal(snapshot.items[0].packed_quantity,25);assert.equal(snapshot.order.picker_id,2);assert.equal(snapshot.order.packer_id,2);
        });
        await step('packed shipment export totals25 and excludes released boxes while the full-history export retains released5 separately with explanation sheet',async()=>{
            const packed=await download(dispatcher,'已裝箱對照','packed25.xlsx');const rows=xlsx.utils.sheet_to_json(packed.Sheets['已裝箱對照']);assert.equal(rows.reduce((sum,row)=>sum+row['本次數量'],0),25);assert.deepEqual(rows.map(row=>row['箱號']).sort(),['N1','N2','N3']);assert.ok(rows.every(row=>row['核對狀態']==='已人工核對'));
            const history=await download(dispatcher,'完整作業紀錄','history25.xlsx');const historyRows=xlsx.utils.sheet_to_json(history.Sheets['箱出貨對照']);assert.equal(historyRows.filter(row=>row['作業狀態']==='已解除').length,1);assert.equal(historyRows.filter(row=>row['作業狀態']==='已裝箱').reduce((n,row)=>n+row['數量'],0),25);
        });
        await step('boxed and loose SN export retains exact case and zeros in individual quantity-one rows, all six units and proper per-SKU summary',async()=>{
            await openOrder(dispatcher,fixtures.mixed);const c=card(dispatcher);await c.getByRole('cell',{name:'未使用箱號',exact:true}).first().waitFor();const d=await openDialog(dispatcher);await d.getByLabel('ECOUNT公司代碼',{exact:true}).fill('SYNTHETIC-EC');await d.getByLabel('原ECOUNT銷貨單號',{exact:true}).fill('2026/10/15-26');
            await manual(d,'品項\t數量\t序號/批號\nSN-EXACT\t1\t000Case/01\nSN-EXACT\t1\t000case+02\nLOOSE-UNITS\t3.00\t\nLOOSE-SERIAL\t1\t000Loose/01');const checked=await post(dispatcher,fixtures.mixed,()=>d.getByRole('button',{name:'儲存人工核對',exact:true}).click());assert.equal(checked.status,'manual_checked');
            const book=await download(dispatcher,'已裝箱對照','mixed-six-units.xlsx'),rows=xlsx.utils.sheet_to_json(book.Sheets['已裝箱對照']);assert.equal(rows.length,4);assert.equal(rows.reduce((n,row)=>n+row['本次數量'],0),6);const snRows=rows.filter(row=>row['實際SN']);assert.equal(snRows.length,3);assert.deepEqual(snRows.map(row=>row['實際SN']).sort(),fixtures.mixedSNs.sort());assert.ok(snRows.every(row=>row['本次數量']===1));
            await c.getByRole('button',{name:'複製箱號摘要',exact:true}).click();const summary=await c.getByLabel('箱號摘要',{exact:true}).inputValue();assert.ok(summary.includes('LOOSE-UNITS：散件 × 3；此品項合計 3 件'));assert.ok(summary.includes('LOOSE-SERIAL：散件 × 1；此品項合計 1 件'));assert.ok(summary.includes('SN-EXACT：REFERENCE-UI-EXACT-SNS × 2；此品項合計 2 件'));
            await dispatcher.screenshot({path:path.join(output,'mixed-sns-and-loose-summary.png'),fullPage:true});
        });
        await step('unknown save result survives page reload and recovers the same command without duplicate metadata or order creation',async()=>{
            await openOrder(dispatcher,fixtures.uncertain);const d=await openDialog(dispatcher);await d.getByLabel('ECOUNT公司代碼',{exact:true}).fill('SYNTHETIC-EC');await d.getByLabel('原ECOUNT銷貨單號',{exact:true}).fill('2026/10/15-27');
            let first=true;await dispatcher.route(`**/api/orders/${fixtures.uncertain}/ecount-reference`,async route=>{if(route.request().method()!=='POST'||!first)return route.continue();first=false;const res=await route.fetch();assert.equal(res.status(),200);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'ECOUNT_REFERENCE_RESULT_UNKNOWN',message:'Synthetic lost response after commit; confirm original operation'})});});
            await post(dispatcher,fixtures.uncertain,()=>d.getByRole('button',{name:'儲存單號',exact:true}).click(),503);await d.getByRole('button',{name:'重新確認原操作',exact:true}).waitFor();const original=report.requests.at(-1).body;
            await dispatcher.reload();await card(dispatcher).getByText('上次操作待確認',{exact:true}).waitFor();await openDialog(dispatcher);const replay=await post(dispatcher,fixtures.uncertain,()=>dialog(dispatcher).getByRole('button',{name:'重新確認原操作',exact:true}).click());assert.equal(replay.replayed,true);assert.deepEqual(report.requests.at(-1).body,original);assert.equal(replay.reference.revision,1);assert.equal(replay.history.length,1);await dispatcher.unroute(`**/api/orders/${fixtures.uncertain}/ecount-reference`);
        });
        await step('picker sees exact read-only reconciliation and cannot access save actions; incomplete order cannot confirm shipment',async()=>{
            const picker=await login('fixture-picker');await openOrder(picker,fixtures.mixed);assert.equal(await card(picker).getByRole('button',{name:'銷貨單核對',exact:true}).count(),0);await card(picker).getByText('已人工核對',{exact:true}).waitFor();
            await openOrder(dispatcher,fixtures.pending);const d=await openDialog(dispatcher);await expandManual(d);assert.equal(await d.getByRole('button',{name:'儲存人工核對',exact:true}).isDisabled(),true);await d.getByRole('button',{name:'關閉',exact:true}).last().click();
        });
        await step('mobile390 reference modal fits and every field, manual acknowledgment and footer remains reachable without submitting',async()=>{
            await dispatcher.setViewportSize({width:390,height:844});await openOrder(dispatcher,fixtures.target25);const d=await openDialog(dispatcher);await expandManual(d);await d.getByLabel('ECOUNT原單明細',{exact:true}).fill('SKU-25\t25\t');await d.getByLabel('已存在原ECOUNT銷貨單',{exact:true}).check();await d.getByLabel('已補箱號且不重複扣庫',{exact:true}).check();await dispatcher.screenshot({path:path.join(output,'mobile-reference-form-390.png'),fullPage:true});
            const bounds=await d.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}});assert.ok(bounds.left>=0&&bounds.right<=bounds.width);await d.getByRole('button',{name:'儲存單號',exact:true}).scrollIntoViewIfNeeded();assert.equal(await d.getByRole('button',{name:'儲存單號',exact:true}).isVisible(),true);await dispatcher.screenshot({path:path.join(output,'mobile-reference-footer-390.png'),fullPage:true});await d.getByRole('button',{name:'關閉',exact:true}).last().click();
        });
        assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.externalRequests,[]);report.finishedAt=new Date().toISOString();write();console.log(JSON.stringify({passed:report.checks.length,pageErrors:report.pageErrors.length,externalRequests:report.externalRequests.length}));
    } finally {for(const context of contexts)await context.close();await browser.close();await vite.close();process.chdir(originalCwd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
