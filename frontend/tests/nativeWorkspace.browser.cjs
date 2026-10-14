// Synthetic local browser check. No real backend, orders or warehouse writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Server } = require('../../backend/node_modules/socket.io');
const { chromium } = require(process.argv[2] || 'playwright');
const dist = path.resolve(__dirname, '../dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'workspace-manifest.json'), 'utf8'));
const sockets = new Set(), handshakes = [];
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => server.close(resolve));

(async () => {
    const staticServer = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://local.invalid').pathname;
        const file = path.resolve(dist, '.' + pathname);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.end(fs.readFileSync(file));
    });
    const io = new Server(staticServer, { cors: { origin: true }, transports: ['websocket'] });
    io.use((socket, next) => socket.handshake.auth.token === 'synthetic-token' ? next() : next(new Error('Synthetic session required')));
    io.on('connection', socket => { sockets.add(socket); handshakes.push(socket.handshake.auth); socket.on('disconnect', () => sockets.delete(socket)); });
    const assetOrigin = await listen(staticServer);
    const hostServer = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{background:rgb(19,29,39);color:rgb(250,240,230);margin:17px}#erp-button{color:rgb(1,2,3);border:7px solid rgb(4,5,6)}</style></head><body><button id="erp-button">ERP host</button><div id="workspace"></div><script type="module">
            const manifest=${JSON.stringify(manifest)},assetOrigin=${JSON.stringify(assetOrigin)};
            const sdk=await import(assetOrigin+manifest.entry);
            window.sdk=sdk;
            window.requests=[];window.paths=[];window.auth=[];
            const user={id:7,role:'admin',management_scope:'all',erpSubject:'synthetic-user',entityId:'synthetic-company',erpOrigin:location.origin,name:'Synthetic operator',permissions:['wms_admin']};
            const task={id:31,voucher_number:'SYNTHETIC-31',customer_name:'Synthetic customer',status:'pending',task_type:'pick',total_quantity:2,item_count:1,picked_quantity:0,packed_quantity:0,warehouse_hold:false,created_at:new Date().toISOString()};
            const product={key:'["P1","4710000000001"]',productCode:'P1',productName:'Synthetic product',barcode:'4710000000001',quantity:2,sourceLineId:'L1'};
            const warehouse={batch:{id:42,batch_number:'SYNTHETIC-BATCH-42',source_platform:'Shopify',source_store:'Synthetic shop'},flow:{erp_confirmed_at:new Date().toISOString(),erp_receipt:{vouchers:['SYNTHETIC-ERP-42']},prepick_owner_id:7,prepick_counts:{}},orders:[{id:1,order_id:31,source_order_number:'SYNTHETIC-31',work_barcode:'WMS-SYNTHETIC-31',status:'pending',expected_items:[product],shipping:{recipient:'Synthetic recipient',address:'Synthetic address'}}],products:[product],events:[]};
            const options={manifest,assetOrigin,socketOrigin:assetOrigin,session:{user,accessToken:'synthetic-token'},initialPath:'/tasks',navigate:(...args)=>window.paths.push(args),onAuthRequired:reason=>window.auth.push(reason),transport:async config=>{
                window.requests.push({url:config.url,method:config.method,data:config.data});
                const url=new URL(config.url,'https://wms.invalid');let data={};
                if(url.pathname==='/api/auth/me')data={user};
                else if(url.pathname==='/api/tasks')data={items:[task],hasMore:false,countScope:'filtered',summary:{total:1,pick:1,pack:0,inProgress:0,mine:0,picked:0,done:0}};
                else if(url.pathname==='/api/tasks/pins')data={pinnedTaskIds:[]};
                else if(url.pathname==='/api/order-reviews')data={items:[]};
                else if(url.pathname==='/api/order-change-notices')data={items:[]};
                else if(url.pathname==='/api/marketplace-intakes')data={intakes:[],facets:[],total:0,orders:0,pageSize:20};
                else if(url.pathname==='/api/marketplace-intakes/store-profiles')data={profiles:[]};
                else if(url.pathname==='/api/cartons')data={cartons:[]};
                else if(url.pathname==='/api/orders/31/deletion-requests')data={message:'Synthetic request accepted'};
                else if(url.pathname==='/api/warehouse-intakes/42')data=warehouse;
                else if(url.pathname==='/api/warehouse-intakes/staff')data={staff:[{id:7,name:'Synthetic operator',role:'admin'}]};
                else if(url.pathname==='/api/warehouse-intakes/42/print'){warehouse.flow.printed_at=new Date().toISOString();warehouse.flow.print_owner_name='Synthetic operator';data={ok:true,intakeId:42,action:'print'};}
                return{status:200,data,headers:{}};
            }};
            window.handle=await sdk.mountWorkspace(document.querySelector('#workspace'),options);window.remount=overrides=>sdk.mountWorkspace(document.querySelector('#workspace'),{...options,...overrides});window.ready=true;
        </script></body></html>`);
    });
    const hostOrigin = await listen(hostServer);
    let browser, page;
    const failures = [];
    try {
        const installedBrowser = fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        browser = await chromium.launch({ headless: true, executablePath: installedBrowser });
        page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.addInitScript(() => { window.print = () => { window.__syntheticPrintCalls = (window.__syntheticPrintCalls || 0) + 1; }; });
        page.on('pageerror', error => { failures.push(error.message); console.error('Browser page error:', error.stack); });
        await page.goto(hostOrigin + '/warehouse');
        await page.waitForFunction(() => window.ready);
        assert.equal(await page.evaluate(() => window.sdk.sourceCommit), manifest.sourceCommit);
        await page.getByRole('button', { name: '申請刪除訂單 SYNTHETIC-31' }).waitFor();
        assert.equal(page.url(), hostOrigin + '/warehouse');
        assert.equal(await page.locator('.corely-sidebar').count(), 0);
        assert.deepEqual(await page.locator('#erp-button').evaluate(button => [getComputedStyle(button).color, getComputedStyle(button).borderTopWidth]), ['rgb(1, 2, 3)', '7px']);
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(19, 29, 39)');
        await page.getByRole('button', { name: '申請刪除訂單 SYNTHETIC-31' }).click();
        const popup = page.locator('.wms-native-portal .swal2-popup');
        await popup.waitFor({ state: 'visible' });
        assert.equal(await page.locator('.wms-native-portal .swal2-textarea').isVisible(), true);
        assert.equal(await popup.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
        await page.getByRole('button', { name: '送交主管審核' }).click();
        await page.getByText('請填寫刪除原因', { exact: true }).waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => window.requests.filter(request => request.method !== 'get').length), 0);
        await page.locator('.wms-native-portal .swal2-textarea').fill('Synthetic reason');
        await page.getByRole('button', { name: '送交主管審核' }).click();
        await popup.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.requests.filter(request => request.url === '/api/orders/31/deletion-requests').length), 1);
        await page.evaluate(() => window.handle.navigate('/admin/marketplace-converter', { replace: true }));
        await page.getByRole('heading', { name: '商城訂單轉檔' }).waitFor();
        assert.equal(await page.evaluate(() => window.paths.length), 0);
        await page.evaluate(() => window.handle.navigate('/warehouse-intakes/42', { replace: true }));
        await page.getByRole('button', { name: '一鍵列印', exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(frame => frame.contentDocument?.body?.querySelector('svg')));
        await page.emulateMedia({ media: 'print' });
        const printed = await page.evaluate(() => {
            const frame = [...document.querySelectorAll('iframe')].find(item => item.contentDocument?.body?.querySelector('svg'));
            const body = frame.contentDocument.body;
            const paperStyle = frame.contentWindow.getComputedStyle(body);
            return { bodyClass: body.className, barcodeCount: body.querySelectorAll('svg[role="img"]').length, text: body.textContent, sidebarCount: body.querySelectorAll('.corely-sidebar').length, borderBox: frame.contentWindow.getComputedStyle(body.querySelector('table')).boxSizing, paperBackground: paperStyle.backgroundColor, paperColor: paperStyle.color };
        });
        await page.emulateMedia({ media: 'screen' });
        assert.match(printed.bodyClass, /wms-native-portal/); assert.ok(printed.barcodeCount >= 3); assert.match(printed.text, /SYNTHETIC-ERP-42/); assert.match(printed.text, /Synthetic recipient/);
        assert.equal(printed.sidebarCount, 0); assert.equal(printed.borderBox, 'border-box');
        assert.equal(printed.paperBackground, 'rgb(255, 255, 255)'); assert.equal(printed.paperColor, 'rgb(0, 0, 0)');
        await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
        await page.evaluate(() => window.handle.navigate('/tasks', { replace: true }));
        await page.getByRole('button', { name: '申請刪除訂單 SYNTHETIC-31' }).click();
        await popup.waitFor({ state: 'visible' });
        await page.evaluate(() => window.handle.dispose());
        await page.waitForFunction(() => document.querySelectorAll('.wms-native-portal').length === 0);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('wms_token')), null);
        assert.equal(await page.evaluate(() => document.querySelector('#workspace').shadowRoot.childNodes.length), 0);
        assert.equal(await page.evaluate(() => [...document.head.querySelectorAll('link')].filter(link => link.href.includes('workspace-portal')).length), 0);
        let releaseCss;
        const pendingCss = new Promise(resolve => { releaseCss = resolve; });
        await page.route(assetOrigin + manifest.styles[0], async route => { releaseCss(); await new Promise(resolve => setTimeout(resolve, 250)); await route.continue().catch(() => {}); });
        await page.evaluate(() => {
            window.bootstrapController = new AbortController();
            window.pendingBootstrap = window.remount({ signal: window.bootstrapController.signal }).catch(error => { window.bootstrapError = error.name; });
        });
        await pendingCss;
        await page.evaluate(() => window.bootstrapController.abort());
        assert.equal(await page.evaluate(() => document.querySelector('#workspace').shadowRoot.childNodes.length), 0);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('wms_token')), null);
        await page.waitForFunction(() => window.bootstrapError === 'AbortError');
        await page.unroute(assetOrigin + manifest.styles[0]);
        await page.evaluate(async () => {
            window.mismatchRejected = false;
            try { await window.remount({ manifest: { ...window.sdkManifest, version: 1, entry: '/assets/workspace-hash.js', styles: ['/assets/shadow.css'], portalStyles: ['/assets/portal.css'], sourceCommit: 'a'.repeat(40) } }); }
            catch (error) { window.mismatchRejected = /manifest/.test(error.message); }
        });
        assert.equal(await page.evaluate(() => window.mismatchRejected), true);
        await page.evaluate(async () => { window.handle = await window.remount(); });
        await page.getByRole('button', { name: '申請刪除訂單 SYNTHETIC-31' }).waitFor();
        await page.waitForFunction(() => sessionStorage.getItem('wms_token') !== null);
        for (const socket of sockets) { socket.emit('session_expired', { code: 'SOCKET_AUTH_REQUIRED' }); socket.disconnect(true); }
        await page.waitForFunction(() => window.auth.length === 1);
        assert.ok(await page.evaluate(() => [null, 'null'].includes(sessionStorage.getItem('wms_token'))));
        assert.equal(page.url(), hostOrigin + '/warehouse');
        await page.evaluate(() => window.handle.dispose());
        assert.equal(await page.evaluate(() => sessionStorage.getItem('wms_token')), null);
        assert.ok(handshakes.length >= 1); assert.ok(handshakes.every(auth => Object.keys(auth).join(',') === 'token'));
        assert.deepEqual(failures, []);
        console.log(JSON.stringify({ passed: true, manifestSourceCommit: manifest.sourceCommit, nativeRoutes: ['tasks', 'marketplace-converter', 'warehouse-intakes'], dialogValidation: true, syntheticMutationCount: 2, nativePrintStyled: true, nativePaperWhite: true, bootstrapAbort: true, manifestMismatchRejected: true, portalCleaned: true, authExpiredInPlace: true }));
    } catch (error) {
        if (page) console.error('Synthetic browser diagnostic:', await page.evaluate(() => ({ workspaceText: document.querySelector('#workspace')?.shadowRoot?.textContent?.slice(-2000), requests: window.requests, paths: window.paths, auth: window.auth })));
        throw error;
    } finally {
        await browser?.close(); await new Promise(resolve => io.close(resolve)); await close(hostServer); if (staticServer.listening) await close(staticServer);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
