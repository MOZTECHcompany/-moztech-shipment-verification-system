// Actual built SDK, loopback fixtures only. No DEV, credentials or warehouse writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Server } = require('../../backend/node_modules/socket.io');
const { chromium } = require(process.argv[2] || 'playwright');
const dist = path.resolve(__dirname, '../dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'workspace-manifest.json'), 'utf8'));
const forbidden = ['/api/order-reviews', '/api/order-change-notices', '/api/comments/unread-summary', '/api/warehouse-intakes?ready=1'];
const sockets = new Set();
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => server.close(resolve));
const artifacts = process.env.WMS_ROLE_UI_ARTIFACTS;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });

(async () => {
    let origin;
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://local.invalid').pathname;
        if (pathname.startsWith('/assets/')) {
            const file = path.resolve(dist, '.' + pathname);
            if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
            res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/css');
            res.end(fs.readFileSync(file)); return;
        }
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{background:rgb(19,29,39);color:rgb(250,240,230);margin:17px}#erp-button{color:rgb(1,2,3);border:7px solid rgb(4,5,6)}</style></head><body><button id="erp-button">ERP host</button><div id="workspace"></div><script type="module">
            const manifest=${JSON.stringify(manifest)},forbidden=${JSON.stringify(forbidden)};
            const sdk=await import(manifest.entry);
            window.requests=[];window.auth=[];window.polls=new Map();window.aborted=[];
            const set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);
            window.setInterval=(callback,delay,...args)=>{const id=set(callback,delay,...args);if([15000,30000].includes(delay))window.polls.set(id,{callback,delay,args});return id;};
            window.clearInterval=id=>{window.polls.delete(id);return clear(id);};
            window.firePolls=()=>{for(const {callback,args} of [...window.polls.values()])callback(...args);};
            window.mount=async(role)=>{
                const user={id:7,role,management_scope:'all',erpSubject:'synthetic-user',entityId:'synthetic-company',erpOrigin:location.origin,name:'Synthetic '+role,permissions:role==='viewer'?['wms_tasks:read']:['wms_tasks:read','wms_admin']};
                window.role=role;
                window.handle=await sdk.mountWorkspace(document.querySelector('#workspace'),{manifest,assetOrigin:location.origin,socketOrigin:location.origin,initialPath:'/tasks',session:{user,accessToken:'synthetic-'+role},navigate:()=>{},onAuthRequired:reason=>window.auth.push(reason),transport:async config=>{
                    const url=new URL(config.url,'https://wms.invalid');
                    window.requests.push({url:config.url,method:config.method,role});
                    if(window.holdOperational&&forbidden.includes(config.url))return new Promise(resolve=>config.signal.addEventListener('abort',()=>{window.aborted.push(config.url);resolve({status:200,data:{items:[],batches:[],total_unread:0,orders:[]}});},{once:true}));
                    if(role==='viewer'&&forbidden.includes(config.url))return{status:403,data:{code:'FORBIDDEN',message:'沒有此儲運操作權限'},headers:{'x-request-id':'synthetic-forbidden-id'}};
                    if(window.failTasks&&url.pathname==='/api/tasks'){window.failTasks=false;return{status:403,data:{code:'FORBIDDEN',message:'Synthetic operation denied'},headers:{'x-request-id':'synthetic-request-id'}};}
                    let data={};
                    if(url.pathname==='/api/auth/me')data={user};
                    else if(['/api/tasks','/api/tasks/completed'].includes(url.pathname))data={items:[],hasMore:false,countScope:'filtered',summary:{total:0,pick:0,pack:0,inProgress:0,mine:0,picked:0,done:0}};
                    else if(url.pathname==='/api/tasks/pins')data={pinned:[]};
                    else if(url.pathname==='/api/order-reviews')data={items:[],total:0,canReview:role==='admin'};
                    else if(url.pathname==='/api/order-change-notices')data={items:[],total:0};
                    else if(url.pathname==='/api/comments/unread-summary')data={total_unread:0,total_urgent:0,orders:[]};
                    else if(url.pathname==='/api/warehouse-intakes')data={batches:[]};
                    else if(url.pathname==='/api/team/posts')data={items:[]};
                    else if(url.pathname==='/api/marketplace-batch-notices')data={notices:[]};
                    return{status:200,data,headers:{}};
                }});
            };
            await window.mount('viewer');window.ready=true;
        </script></body></html>`);
    });
    const io = new Server(server, { transports: ['websocket'] });
    io.on('connection', socket => { sockets.add(socket); socket.on('disconnect', () => sockets.delete(socket)); });
    origin = await listen(server);
    let browser, page;
    const failures = [], external = [], result = { sourceCommit: manifest.sourceCommit, manifest, forbiddenPaths: forbidden, localFixturesOnly: true };
    const sendWidgetEvents = async () => {
        for (const socket of sockets) for (const event of ['new_comment','new_mention','order_exception_changed','warehouse_tasks_changed']) socket.emit(event, {});
        for (const socket of sockets) socket.emit('order_change_notice', { recipientUserIds: [7] });
        await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); window.firePolls(); });
        await page.waitForTimeout(80);
    };
    const forbiddenCalls = () => page.evaluate(paths => window.requests.filter(request => paths.includes(request.url)), forbidden);
    try {
        const executablePath = fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        browser = await chromium.launch({ headless: true, executablePath });
        page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
        page.on('pageerror', error => failures.push(error.message));
        page.on('request', request => { if (!request.url().startsWith(origin)) external.push(request.url()); });
        await page.goto(origin + '/warehouse');
        await page.waitForFunction(() => window.ready);
        await page.getByRole('button', { name: '已完成', exact: true }).waitFor();
        await page.getByRole('button', { name: '已完成', exact: true }).click();
        await page.getByRole('button', { name: '進行中', exact: true }).click();
        await sendWidgetEvents();
        assert.deepEqual(await forbiddenCalls(), []);
        assert.equal(await page.locator('[aria-label="整批預揀任務"]').count(), 0);
        assert.equal(await page.locator('.notification-trigger').count(), 0);
        assert.equal(await page.locator('[aria-label="訂單異動提醒"]').count(), 0);
        assert.ok(await page.evaluate(() => window.requests.some(request => request.url.startsWith('/api/tasks?'))));
        assert.ok(await page.evaluate(() => window.requests.some(request => request.url.startsWith('/api/tasks/completed?'))));
        assert.ok(await page.evaluate(() => window.requests.some(request => request.url.startsWith('/api/team/posts?'))));
        assert.equal(await page.evaluate(() => window.polls.size), 0);
        result.viewer = { forbiddenCalls: 0, taskAndCompletedAndAnnouncementsReadable: true, noOperationalTimers: true };

        result.operationalRoles = {};
        for (const role of ['picker','packer','dispatcher','admin']) {
            await page.evaluate(async role => { window.handle.dispose();window.requests=[];await window.mount(role); }, role);
            await page.waitForFunction(paths => paths.every(path => window.requests.some(request => request.url === path)), forbidden);
            assert.equal(await page.locator('.notification-trigger').count(), 1);
            assert.equal(await page.locator('[aria-label="整批預揀任務"]').count(), 1);
            const before = (await forbiddenCalls()).length;
            await sendWidgetEvents();
            assert.ok((await forbiddenCalls()).length > before, role + ' retains events and polling');
            const totals = await page.evaluate(paths => Object.fromEntries(paths.map(path => [path,window.requests.filter(request => request.url === path).length])), forbidden);
            result.operationalRoles[role] = totals;
            await page.evaluate(() => window.handle.dispose());
            assert.equal(await page.evaluate(() => window.polls.size), 0);
            const disposedCount = await page.evaluate(() => window.requests.length);
            await sendWidgetEvents();
            assert.equal(await page.evaluate(() => window.requests.length), disposedCount);
        }
        await page.evaluate(async () => { window.requests=[];await window.mount('viewer'); });
        await page.getByRole('button', { name: '已完成', exact: true }).waitFor();
        await sendWidgetEvents();
        assert.deepEqual(await forbiddenCalls(), []);
        result.roleChange = { adminToViewer: true, noStaleTimerOrEventRequests: true };

        const appearance = {};
        for (const colorScheme of ['light','dark']) {
            await page.emulateMedia({ colorScheme });
            await page.evaluate(() => { window.failTasks=true; });
            await page.getByRole('button', { name: '重新整理', exact: true }).click();
            await page.locator('[data-sonner-toast]').last().waitFor({state:'visible'});
            const measured = await page.evaluate(() => {
                const root=document.querySelector('#workspace').shadowRoot,toaster=root.querySelector('[data-sonner-toaster]'),toast=root.querySelector('[data-sonner-toast]:last-child'),title=root.querySelector('[aria-label="團隊公告"] h2'),card=title.closest('section');
                const get=element=>getComputedStyle(element),t=get(toast),c=get(card),heading=get(title),host=get(document.body),button=get(document.querySelector('#erp-button'));
                const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
                const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
                return{toasterPosition:get(toaster).position,toasterWidth:toaster.getBoundingClientRect().width,toastPosition:t.position,toastColor:t.color,toastBackground:t.backgroundColor,toastContrast:contrast(t.color,t.backgroundColor),toastText:toast.textContent,headingColor:heading.color,cardBackground:c.backgroundColor,cardContrast:contrast(heading.color,c.backgroundColor),hostBackground:host.backgroundColor,hostColor:host.color,buttonColor:button.color,buttonBorder:button.borderTopWidth,scheme:get(root.host).colorScheme};
            });
            assert.equal(measured.toasterPosition,'fixed');assert.equal(measured.toastPosition,'absolute');assert.equal(measured.toasterWidth,356);
            assert.ok(measured.toastContrast >= 4.5, JSON.stringify(measured));assert.ok(measured.cardContrast >= 4.5, JSON.stringify(measured));
            assert.match(measured.toastText,/Synthetic operation denied/);assert.doesNotMatch(measured.toastText,/Request ID|synthetic-request-id/);
            assert.equal(measured.hostBackground,'rgb(19, 29, 39)');assert.equal(measured.hostColor,'rgb(250, 240, 230)');assert.equal(measured.buttonColor,'rgb(1, 2, 3)');assert.equal(measured.buttonBorder,'7px');assert.equal(measured.scheme,'light');
            appearance[colorScheme]=measured;
            if(artifacts)await page.screenshot({path:path.join(artifacts,`${colorScheme}-role-ui.png`)});
        }
        result.appearance=appearance;

        await page.evaluate(async () => {window.handle.dispose();window.requests=[];window.holdOperational=true;await window.mount('admin');});
        await page.waitForFunction(paths=>paths.every(path=>window.requests.some(request=>request.url===path)),forbidden);
        await page.evaluate(() => window.handle.dispose());
        await page.waitForFunction(paths=>paths.every(path=>window.aborted.includes(path)),forbidden);
        assert.equal(await page.evaluate(() => window.polls.size),0);
        assert.equal(await page.evaluate(() => document.querySelector('#workspace').shadowRoot.childNodes.length),0);
        const disposedCount=await page.evaluate(()=>window.requests.length);await sendWidgetEvents();assert.equal(await page.evaluate(()=>window.requests.length),disposedCount);
        result.cleanup={allFourInFlightReadsAborted:true,noTimers:true,noPostDisposeRequests:true,emptyShadowRoot:true};
        assert.deepEqual(await page.evaluate(()=>window.requests.filter(request=>request.method!=='get')),[]);
        assert.deepEqual(await page.evaluate(()=>window.auth),[]);assert.deepEqual(failures,[]);assert.deepEqual(external,[]);
        result.passed=true;result.syntheticMutationCount=0;result.externalRequestCount=0;
        if(artifacts)fs.writeFileSync(path.join(artifacts,'actual-sdk-role-ui-receipt.json'),JSON.stringify(result,null,2)+'\n');
        console.log(JSON.stringify(result));
    } catch(error) {
        if(page)console.error('Local SDK diagnostic:',await page.evaluate(()=>({role:window.role,requests:window.requests,auth:window.auth,polls:window.polls?.size,text:document.querySelector('#workspace')?.shadowRoot?.textContent?.slice(-2000)})));
        throw error;
    } finally {await browser?.close();await new Promise(resolve=>io.close(resolve));if(server.listening)await close(server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
