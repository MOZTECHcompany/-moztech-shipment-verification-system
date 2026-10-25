// Real compiled native SDK; synthetic loopback fixtures only. No DEV or business data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Server } = require('../../backend/node_modules/socket.io');
const { chromium } = require(process.argv[2] || 'playwright');
const dist = path.resolve(process.env.WMS_RESUME_DIST_ROOT || path.resolve(__dirname, '../dist'));
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'workspace-manifest.json'), 'utf8'));
const artifacts = process.env.WMS_RESUME_UI_ARTIFACTS;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => server.close(resolve));

(async () => {
    const { buildUnifiedConversion } = await import(pathToFileURL(path.resolve(__dirname, '../src/utils/unifiedMarketplace.mjs')));
    const { prepareEcountFinancials } = await import(pathToFileURL(path.resolve(__dirname, '../src/utils/marketplaceIntake.mjs')));
    const columns = ['Name','Lineitem quantity','Lineitem sku','Lineitem name','Lineitem price','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount'];
    const settings = { store:'Synthetic shop',customerCode:'00020',customerName:'Synthetic customer',warehouseCode:'003',date:'2026-10-26',batchSequence:'1',batchNumber:'TEST-RESUME-71',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,skuMappings:{'4710000000001':{erpSku:'4710000000001',erpName:'Synthetic shared product',barcode:'4710000000001',confirmed:true,barcodeConfirmed:true}} };
    const makeRows = numbers => [columns,...numbers.map(number=>[number,1,'4710000000001','Synthetic shared product',100,'paid','unfulfilled','TWD',100,0,0,100,0,0])];
    const originalNumbers = Array.from({length:27},(_,i)=>`#SYN-ORIGINAL-${i+1}`), newNumbers = Array.from({length:12},(_,i)=>`#SYN-NEW-${i+1}`);
    const original = buildUnifiedConversion(makeRows(originalNumbers),settings), onlyNew = buildUnifiedConversion(makeRows(newNumbers),{...settings,batchNumber:'TEST-NEW-78'});
    const rawMixed = buildUnifiedConversion(makeRows([originalNumbers[0],...newNumbers]),settings);
    const shipping = {recipient:'Synthetic recipient',phone:'0900000000',address:'Synthetic old address',method:'超商取貨',storeName:'Synthetic pickup',storeCode:'000123'};
    const reimport = {orderNumber:originalNumbers[0],intakeId:71,workOrderId:null,state:'pending',message:'可更新原訂單收件資料',canUpdateShipping:true};
    const preparedMixed = {...onlyNew,raw:rawMixed.raw,reimports:[reimport],profileId:5,verification:{mode:'api',platform:'Shopify',currentFingerprint:'synthetic-current-v2'},barcodeConflicts:[],catalog:{products:{'4710000000001':{status:'active'}}}};
    const preparedOnly = {...preparedMixed,parsed:{...onlyNew.parsed,orders:[],items:[],summary:{...onlyNew.parsed.summary,orderCount:0,totalQuantity:0,totalMinor:0}},output:{...onlyNew.output,rows:[],ok:false,issues:[]},reimports:[reimport]};
    const detail = {id:71,batchNumber:settings.batchNumber,platform:'Shopify',store:settings.store,createdAt:'2026-10-26T00:00:00.000Z',archivedAt:null,settings:original.effectiveSettings,orders:original.parsed.orders.map(order=>({...order,shipping})),items:original.parsed.items,headers:original.output.headers,rows:original.output.rows,summary:original.output.summary,prepick:original.prepick,financials:prepareEcountFinancials({headers:original.output.headers,rows:original.output.rows,settings:original.effectiveSettings,orders:original.parsed.orders,items:original.parsed.items,summary:original.output.summary}).financials,links:[]};
    const product = {key:'["4710000000001","4710000000001"]',productCode:'4710000000001',productName:'Synthetic shared product',barcode:'4710000000001',quantity:27,sourceLineId:'L1'};
    const fixture = {settings,preparedMixed,preparedOnly,detail,shipping,originalNumbers,newNumbers,product,sourceCsv:makeRows([originalNumbers[0],...newNumbers]).map(row=>row.join(',')).join('\n'),downloadSnapshot:{orderNumbers:newNumbers,rows:onlyNew.output.rows}};
    let origin;
    const server = http.createServer((req,res)=>{
        const pathname = new URL(req.url,'http://local.invalid').pathname;
        if (pathname.startsWith('/assets/')) {
            const file = path.resolve(dist,'.'+pathname);
            if (!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
            res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));return;
        }
        res.setHeader('Content-Type','text/html');
        res.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f5f7fa;color:#172033;font:16px sans-serif}header{padding:16px;border-bottom:1px solid #ddd}#workspace{padding:12px;max-width:1280px;margin:auto;box-sizing:border-box}</style></head><body><header>ERP synthetic host</header><div id="workspace"></div><script type="module">
            const manifest=${JSON.stringify(manifest)},fixture=${JSON.stringify(fixture)};
            const sdk=await import(manifest.entry);window.fixture=fixture;window.sdk=sdk;
            window.mount=async(initialPath='/admin/marketplace-converter',overrides={})=>{
                window.handle?.dispose();window.requests=[];window.downloadCalls=[];window.paths=[];window.auth=[];window.unexpected=[];window.confirmed=!!overrides.confirmed;window.onlyExisting=!!overrides.onlyExisting;window.currentDetail=structuredClone(fixture.detail);
                const user={id:7,role:'admin',management_scope:'all',erpSubject:'synthetic-user',entityId:'synthetic-company',erpOrigin:location.origin,name:'Synthetic warehouse manager',permissions:['wms_admin','wms_tasks:read']};
                const importResult={batchId:900,warehouseIntakeId:71,batchNumber:'SYNTHETIC-ERP-71',workOrderCount:27,itemCount:1,totalQuantity:27,serialCount:0,orders:fixture.originalNumbers.map((number,index)=>({orderId:1000+index,voucherNumber:number,workBarcode:'WT'+(index+1).toString(16).padStart(18,'0')}))};
                const warehouse=()=>({batch:{id:71,batch_number:fixture.detail.batchNumber,source_platform:'Shopify',source_store:fixture.settings.store},flow:{erp_confirmed_at:window.confirmed?'2026-10-26T01:00:00.000Z':null,erp_receipt:window.confirmed?{vouchers:['SYNTHETIC-ERP-71']}:null,prepick_counts:{}},orders:window.confirmed?fixture.originalNumbers.map((number,index)=>({id:1000+index,order_id:1000+index,source_order_number:number,work_barcode:'WT'+(index+1).toString(16).padStart(18,'0'),status:'pending',expected_items:[{...fixture.product,quantity:1}],shipping:fixture.shipping})):[],products:[fixture.product],events:[]});
                window.handle=await sdk.mountWorkspace(document.querySelector('#workspace'),{manifest,assetOrigin:location.origin,socketOrigin:location.origin,initialPath,session:{user,accessToken:'synthetic-test-only'},navigate:(...args)=>window.paths.push(args),onAuthRequired:reason=>window.auth.push(reason),download:async args=>{window.downloadCalls.push(args);return{data:new Blob([JSON.stringify(fixture.downloadSnapshot)],{type:'application/json'}),headers:{'content-disposition':'attachment; filename="synthetic-new-sales.json"'}};},transport:async config=>{
                    const method=(config.method||'get').toLowerCase(),url=new URL(config.url,'https://fixture.invalid');
                    const data=config.data instanceof FormData?Object.fromEntries([...config.data.entries()].map(([key,value])=>[key,value instanceof File?{fileName:value.name,size:value.size}:value])):typeof config.data==='string'?JSON.parse(config.data):config.data;
                    window.requests.push({url:config.url,method,data});
                    let response={};
                    if(url.pathname==='/api/auth/me')response={user};
                    else if(url.pathname==='/api/marketplace-intakes/store-profiles')response=method==='get'?{profiles:[{id:5,platform:'Shopify',store:fixture.settings.store,settings:fixture.settings}]}:{id:5,platform:'Shopify',store:fixture.settings.store,settings:fixture.settings};
                    else if(url.pathname==='/api/marketplace-intakes/preview'&&method==='post')response=window.onlyExisting?fixture.preparedOnly:fixture.preparedMixed;
                    else if(url.pathname==='/api/marketplace-intakes'&&method==='post')response={id:78,newOrderCount:12,salesDownloadAllowed:true};
                    else if(url.pathname==='/api/marketplace-intakes')response={intakes:[],facets:[],total:0,orders:0,pageSize:20};
                    else if(url.pathname==='/api/marketplace-intakes/71')response=structuredClone(window.currentDetail);
                    else if(url.pathname==='/api/warehouse-intakes/71')response=warehouse();
                    else if(url.pathname==='/api/warehouse-intakes/staff')response={staff:[{id:7,name:user.name,role:'admin'}]};
                    else if(url.pathname==='/api/marketplace-intakes/71/orders/shipping-preview')response={intakeId:71,orderNumber:data.orderNumber,previousShipping:window.currentDetail.orders[0].shipping,currentShipping:{...fixture.shipping,address:'Synthetic current address'},changed:true,previewFingerprint:'synthetic-contact-only'};
                    else if(url.pathname==='/api/marketplace-intakes/71/orders/shipping-update'){window.currentDetail.orders[0].shipping={...fixture.shipping,address:'Synthetic current address'};response={ok:true,intakeId:71,orderNumber:data.orderNumber,updated:true};}
                    else if(url.pathname==='/api/orders/import'&&method==='post'){window.confirmed=true;response=importResult;}
                    else if(url.pathname==='/api/warehouse-intakes/71/print'&&method==='post')response={ok:true,intakeId:71,action:'print'};
                    else if(['/api/order-reviews','/api/order-change-notices','/api/team/posts','/api/marketplace-batch-notices'].includes(url.pathname))response={items:[],notices:[],orders:[],total:0};
                    else if(url.pathname==='/api/comments/unread-summary')response={orders:[],total_unread:0,total_urgent:0};
                    else if(url.pathname==='/api/warehouse-intakes')response={batches:[]};
                    else {window.unexpected.push({method,path:url.pathname});return{status:404,data:{message:'Unexpected synthetic API request'},headers:{}};}
                    return{status:200,data:response,headers:{}};
                }});
            };
            await window.mount();window.ready=true;
        </script></body></html>`);
    });
    const io = new Server(server,{transports:['websocket']});origin=await listen(server);
    let browser,page;
    const errors=[],external=[],result={sourceCommit:manifest.sourceCommit,compiledEntry:manifest.entry,localFixturesOnly:true,realBusinessWrites:0,checks:[]};
    const sourceFiles=['MarketplaceConverter.jsx','MarketplaceBatchManager.jsx','AdminDashboard.jsx'];
    result.sourceFiles=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../src/components/admin',file))).digest('hex')]));
    try {
        const executablePath=fs.existsSync(chromium.executablePath())?chromium.executablePath():'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        browser=await chromium.launch({headless:true,executablePath});
        const context=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true});
        await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();external.push(url);return route.abort();});
        page=await context.newPage();await page.addInitScript(()=>{window.print=()=>{window.syntheticPrintCalls=(window.syntheticPrintCalls||0)+1;};});page.on('pageerror',error=>errors.push(error.message));
        await page.goto(origin+'/warehouse');await page.waitForFunction(()=>window.ready);
        const posts=()=>page.evaluate(()=>window.requests.filter(request=>request.method!=='get'));
        const navigate=async(route,options={})=>{await page.evaluate(async({route,options})=>{await window.mount(route,options);},{route,options});};
        const assertResume=async()=>{
            await page.getByRole('region',{name:'接續原銷貨單',exact:true}).waitFor();
            await page.getByRole('heading',{name:'匯入原 ECOUNT 理貨單',exact:true}).waitFor();
            assert.equal(await page.getByText('回匯核對範圍：原批次全部 27 筆訂單',{exact:true}).count(),1);
            assert.equal(await page.getByRole('button',{name:/下載.*銷貨|下載原保存/}).count(),0);
            assert.equal(await page.getByRole('link',{name:/下載.*銷貨|下載原保存/}).count(),0);
            assert.equal(await page.getByLabel('商城訂單檔案區').count(),0);
            assert.equal(await page.getByLabel('轉檔與下載').count(),0);
            assert.equal(await page.getByText('已保存・待 ECOUNT 匯入',{exact:true}).count(),0,'a new-sales status must not be shown in original-order continuation');
            assert.equal(await page.getByLabel('批次搜尋').count(),0);
            assert.equal(await page.locator('details[aria-label^="商城訂單 "]').count(),1);
            assert.equal(await page.getByLabel('商城訂單 #SYN-ORIGINAL-1',{exact:true}).count(),1);
            assert.equal(page.url(),origin+'/warehouse');
            assert.ok((await page.evaluate(()=>window.paths)).every(([route])=>/^\/(?:admin|warehouse-intakes|order|batches)(?:[/?#]|$)/.test(route)));
        };
        await page.getByLabel('商城原始訂單檔',{exact:true}).waitFor({state:'attached'});
        assert.equal((await posts()).length,0,'opening converter performs no business write');
        await page.getByLabel('商城原始訂單檔',{exact:true}).setInputFiles({name:'synthetic-mixed.csv',mimeType:'text/csv',buffer:Buffer.from(fixture.sourceCsv)});
        await page.getByRole('heading',{name:'已保存 1 筆 · 新增 12 筆',exact:true}).waitFor();
        const savedOrder=page.getByLabel('已保存訂單 #SYN-ORIGINAL-1',{exact:true});
        const resume=savedOrder.getByRole('link',{name:'接續原銷貨單',exact:true});
        assert.match(await resume.getAttribute('href'),/batch=71&order=%23SYN-ORIGINAL-1&view=resume#batch-detail$/);
        assert.equal((await posts()).filter(item=>item.url!=='/api/marketplace-intakes/preview').length,0);
        const downloadEvent=page.waitForEvent('download');
        await page.getByRole('button',{name:'下載新單銷貨檔',exact:true}).click();
        const download=await downloadEvent;const snapshot=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
        assert.equal(snapshot.orderNumbers.length,12);assert.deepEqual(snapshot.orderNumbers,newNumbers);assert.ok(!snapshot.orderNumbers.some(number=>originalNumbers.includes(number)));
        assert.deepEqual(await page.evaluate(()=>window.downloadCalls),[{id:78,kind:'ecount'}]);
        await page.getByRole('link',{name:'匯回 ECOUNT 理貨單',exact:true}).waitFor();
        await resume.click();await assertResume();
        assert.equal((await posts()).filter(item=>/shipping-|orders\/import|\/71\/print/.test(item.url)).length,0,'resume navigation does not modify the existing order or stock');
        result.checks.push('mixed upload retains only 12 new orders in the new-sales download and opens original batch 71 for the existing order');

        await page.getByRole('button',{name:'更新收件資料',exact:true}).click();
        await page.getByRole('button',{name:'保存收件資料',exact:true}).waitFor();
        assert.equal(await page.getByText('Synthetic current address',{exact:true}).count(),1);
        assert.equal((await posts()).filter(item=>item.url.endsWith('/shipping-update')).length,0,'contact preview never auto-applies');
        await page.getByRole('button',{name:'保存收件資料',exact:true}).click();
        await page.getByText('收件資料已更新',{exact:true}).waitFor();await assertResume();
        const updates=(await posts()).filter(item=>item.url.endsWith('/shipping-update'));
        assert.equal(updates.length,1);assert.equal(updates[0].data.orderNumber,originalNumbers[0]);assert.equal(updates[0].data.expectedActorId,7);assert.match(updates[0].data.commandId,/^[0-9a-f-]{36}$/);
        result.checks.push('contact preview and explicit save remain in the original-sales return workflow');
        if(artifacts)await page.screenshot({path:path.join(artifacts,'resume-desktop.png'),fullPage:true});

        const importBefore=(await posts()).filter(item=>item.url==='/api/orders/import').length;
        assert.equal(importBefore,0);
        await page.getByLabel('訂單檔案',{exact:true}).setInputFiles({name:'synthetic-original-return.csv',mimeType:'text/csv',buffer:Buffer.from('Synthetic original full batch ECOUNT return')});
        await page.getByText('原批次理貨已核對',{exact:true}).waitFor();
        const imports=(await posts()).filter(item=>item.url==='/api/orders/import');assert.equal(imports.length,1);assert.equal(imports[0].data.marketplaceIntakeId,'71');assert.equal(imports[0].data.orderFile.fileName,'synthetic-original-return.csv');
        assert.equal(await page.getByRole('button',{name:'下載銷貨檔',exact:true}).count(),0);
        await page.getByRole('link',{name:'列印與預揀',exact:true}).click();
        await page.getByRole('button',{name:'一鍵列印',exact:true}).waitFor();
        assert.equal(page.url(),origin+'/warehouse');assert.ok((await page.evaluate(()=>window.paths)).every(([route])=>/^\/(?:admin|warehouse-intakes|order|batches)(?:[/?#]|$)/.test(route)));
        result.checks.push('return uploader sends original batch ID 71 and successful 27-order reconciliation opens native print/prepick');
        await page.getByRole('button',{name:'一鍵列印',exact:true}).click();
        await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(frame=>frame.contentDocument?.body?.querySelector('svg')));
        await page.emulateMedia({media:'print'});
        const printed=await page.evaluate(()=>{const frame=[...document.querySelectorAll('iframe')].find(item=>item.contentDocument?.body?.querySelector('svg')),body=frame.contentDocument.body;return{orderPages:body.querySelectorAll('.work-sheet').length,barcodes:body.querySelectorAll('svg[role="img"]').length,hasSummary:body.textContent.includes('預揀總表'),hasFirst:body.textContent.includes('#SYN-ORIGINAL-1'),hasLast:body.textContent.includes('#SYN-ORIGINAL-27'),nativePaper:body.className,background:frame.contentWindow.getComputedStyle(body).backgroundColor,color:frame.contentWindow.getComputedStyle(body).color};});
        assert.equal(printed.orderPages,27);assert.ok(printed.barcodes>=55);assert.equal(printed.hasSummary,true);assert.equal(printed.hasFirst,true);assert.equal(printed.hasLast,true);assert.match(printed.nativePaper,/wms-native-portal/);assert.equal(printed.background,'rgb(255, 255, 255)');assert.equal(printed.color,'rgb(0, 0, 0)');
        await page.emulateMedia({media:'screen'});
        assert.equal((await posts()).filter(item=>item.url==='/api/warehouse-intakes/71/print').length,1);result.printed=printed;
        await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
        result.checks.push('native print iframe contains a prepick summary, all 27 order sheets and at least 55 rendered product/work barcodes');


        await navigate('/admin/marketplace-converter',{onlyExisting:true});
        await page.getByLabel('商城原始訂單檔',{exact:true}).setInputFiles({name:'synthetic-existing.csv',mimeType:'text/csv',buffer:Buffer.from(fixture.sourceCsv)});
        await page.getByRole('heading',{name:'已保存 1 筆 · 新增 0 筆',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:/下載.*銷貨/}).count(),0);
        await page.getByLabel('已保存訂單 #SYN-ORIGINAL-1',{exact:true}).getByRole('link',{name:'接續原銷貨單',exact:true}).click();await assertResume();
        assert.deepEqual(await page.evaluate(()=>window.downloadCalls),[]);
        result.checks.push('all-existing upload provides resume without a sales download');

        await navigate('/admin/marketplace-converter?batch=71&order=%23SYN-ORIGINAL-1&shipping=refresh#batch-detail');
        await page.getByRole('button',{name:'保存收件資料',exact:true}).waitFor();
        assert.equal((await posts()).filter(item=>item.url.endsWith('/shipping-preview')).length,1);assert.equal((await posts()).filter(item=>item.url.endsWith('/shipping-update')).length,0);
        await page.getByRole('button',{name:'接續原銷貨單',exact:true}).click();await assertResume();
        assert.equal(await page.getByRole('button',{name:'保存收件資料',exact:true}).count(),0,'changing workflow clears a prior contact preview');
        assert.equal((await posts()).filter(item=>item.url.endsWith('/shipping-update')).length,0);
        result.checks.push('legacy contact-only bookmark retains read-only preview and returns to original-sales continuation');

        await page.setViewportSize({width:390,height:844});
        await navigate('/admin/marketplace-converter?batch=71&order=%23SYN-ORIGINAL-1&view=resume#batch-detail');await assertResume();
        assert.equal((await posts()).length,0,'direct resume performs no POST');
        const widths=await page.evaluate(()=>{const host=document.querySelector('#workspace');return{document:document.documentElement.scrollWidth,viewport:innerWidth,host:host.scrollWidth,hostWidth:host.clientWidth};});
        assert.ok(widths.document<=widths.viewport+1,JSON.stringify(widths));assert.ok(widths.host<=widths.hostWidth+1,JSON.stringify(widths));
        const upload=page.getByRole('button',{name:'匯入原 ECOUNT 理貨單',exact:true});await upload.scrollIntoViewIfNeeded();assert.ok(await upload.isVisible());
        if(artifacts)await page.screenshot({path:path.join(artifacts,'resume-mobile.png'),fullPage:true});
        result.checks.push('390px resume keeps the primary return action visible without page overflow');

        await navigate('/admin/marketplace-converter?batch=71&order=%23SYN-ORIGINAL-1&view=resume#batch-detail',{confirmed:true});
        await page.getByText('原批次理貨已核對',{exact:true}).waitFor();
        assert.equal(await page.getByLabel('訂單檔案',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/下載.*銷貨/}).count(),0);assert.equal((await posts()).length,0);
        await page.getByRole('link',{name:'列印與預揀',exact:true}).click();await page.getByRole('button',{name:'一鍵列印',exact:true}).waitFor();
        assert.equal(page.url(),origin+'/warehouse');assert.ok((await page.evaluate(()=>window.paths)).every(([route])=>/^\/(?:admin|warehouse-intakes|order|batches)(?:[/?#]|$)/.test(route)));
        result.checks.push('ERP-confirmed original batch offers native print/prepick without return re-upload or a new sale');
        assert.deepEqual(await page.evaluate(()=>window.unexpected),[]);assert.deepEqual(await page.evaluate(()=>window.auth),[]);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
        result.passed=true;result.externalNetworkAttempts=0;result.pageErrors=0;result.limits=['Synthetic backend responses prove UI/native routing and request targeting, not real ERP return reconciliation or stock posting.','Native print iframe is verified with synthetic records; physical printing/scanning and normal staff acceptance are not established by this test.'];
        if(artifacts)fs.writeFileSync(path.join(artifacts,'browser-result.json'),JSON.stringify(result,null,2)+'\n');
        console.log(JSON.stringify(result));
    } catch(error) {
        if(page){console.error('Synthetic resume diagnostic:',await page.evaluate(()=>({text:document.querySelector('#workspace')?.shadowRoot?.textContent?.slice(-5000),requests:window.requests,unexpected:window.unexpected,paths:window.paths})));if(artifacts)await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true});}
        throw error;
    } finally { await browser?.close();await new Promise(resolve=>io.close(resolve));if(server.listening)await close(server); }
})().catch(error=>{console.error(error);process.exitCode=1;});
