const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const xlsx = require('xlsx');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(process.env.WMS_PLAYWRIGHT_MODULE || 'playwright');

module.exports = async function browserFeatures({ t, api, ok, pool, users, tokens, base, output, iam, cleanupOrders = [] }) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) && !/^https:\/\/corely-wms-migration-validation-[a-z0-9.-]+\.run\.app$/.test(base)) throw Error('Disposable local or private validation target required');
    const prefix = 'UI' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const voucher = prefix + '-PARITY', serials = [1,2,3].map(n => prefix + String(n).padStart(2,'0'));
    const report = { prefix, target: base, startedAt: new Date().toISOString(), checks: [], pageErrors: [], failedResponses: [], failedRequests: [] };
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.WMS_CHROME_EXECUTABLE || undefined });
    let vite, webBase = base, orderId;
    const contexts = [];
    const expectedScanFailures = new Map();
    const originalCwd = process.cwd();
    async function pageFor(role, mobile = false, timezoneId = 'Asia/Taipei', collapseAlerts = true) {
        const context = await browser.newContext({ timezoneId, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 }, extraHTTPHeaders: iam ? { 'X-Serverless-Authorization': 'Bearer ' + iam } : {} });
        contexts.push(context);
        const user = (await pool.query('SELECT id,username,name,role,management_scope FROM users WHERE id=$1', [users[role]])).rows[0];
        await context.addInitScript(({user,token}) => { localStorage.setItem('wms_user', JSON.stringify(user)); localStorage.setItem('wms_token', JSON.stringify(token)); }, { user, token: tokens[role] });
        const page = await context.newPage(); page.setDefaultTimeout(15000);
        await page.addInitScript(() => {
            window.__wmsTones = [];
            const prototype = (window.AudioContext || window.webkitAudioContext)?.prototype;
            if (!prototype) return;
            const create = prototype.createOscillator;
            prototype.createOscillator = function(...args) {
                const oscillator = create.apply(this, args), start = oscillator.start;
                oscillator.start = function(at) { window.__wmsTones.push({ frequency: this.frequency.value, type: this.type, at }); return start.call(this, at); };
                return oscillator;
            };
        });
        await page.addInitScript(() => { window.__wmsPrints = []; setInterval(() => { const frame = document.getElementById('printWindow'); if (frame?.contentWindow) frame.contentWindow.print = () => window.__wmsPrints.push({ text: frame.contentDocument.body.innerText, barcode: !!frame.contentDocument.querySelector('svg') }); }, 20); });
        page.on('requestfailed', r => report.failedRequests.push({ url: r.url().split('?')[0], error: r.failure()?.errorText }));
        page.on('pageerror', e => report.pageErrors.push(e.message));
        page.on('response', r => {
            if (!r.url().includes('/api/') || r.status() < 400) return;
            const route = new URL(r.url()).pathname;
            const expected = route === '/api/orders/update_item' && r.status() === expectedScanFailures.get(r.request().postDataJSON()?.scanValue);
            report.failedResponses.push({ path: route, status: r.status(), expected });
        });
        // Existing workflows acknowledge the prominent overlay by collapsing it;
        // the dedicated alert scenario below verifies explicit receipts and sound.
        if(collapseAlerts)await page.addLocatorHandler(page.getByRole('button',{name:'收合異動警示',exact:true}),async()=>{await page.getByRole('button',{name:'收合異動警示',exact:true}).click();});
        return page;
    }
    async function step(name, run) {
        await t.test(name, async () => {
            try { await run(); report.checks.push({ name, passed: true }); }
            catch (error) { for (const [index,context] of contexts.entries()) for (const page of context.pages()) { await page.screenshot({path: output + '/failure-' + report.checks.length + '-' + index + '.png', fullPage:true}).catch(()=>{}); report.failurePage = { url: page.url(), body: (await page.locator('body').innerText()).slice(-1600) }; } report.checks.push({ name, passed: false, message: error.message.slice(0, 600) }); throw error; }
        });
    }
    const response = (page, route, method, action) => Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === method), action()]).then(([r]) => { assert.ok(r.status() >= 200 && r.status() < 300, route + ': ' + r.status()); return r; });
    try {
    if (base.startsWith('http:')) {
        process.chdir(root + '/frontend');
        const { createServer } = await import(path.join(path.dirname(require.resolve('vite', { paths: [root + '/frontend/node_modules'] })), 'dist/node/index.js'));
        vite = await createServer({ root: root + '/frontend', configFile: root + '/frontend/vite.config.js', logLevel: 'error', optimizeDeps: {include:['react-chartjs-2','chart.js']}, server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: base }, '/socket.io': { target: base, ws: true } } } });
        await vite.listen(); webBase = 'http://127.0.0.1:' + vite.httpServer.address().port;
    }
        report.webBase = webBase;
        const dispatcher = await pageFor('dispatcher');
        await step('browser: dispatcher imports a real XLSX with a print timestamp footer through the original upload flow', async () => {
            await dispatcher.goto(webBase + '/admin');
            const book = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['憑證號碼', voucher], ['客戶名稱', 'UI synthetic customer'], ['品項編碼','品項名稱','數量','SN'], ['UI-BARCODE','UI 驗收產品',3,serials.join('/')],['總計','',3],['2026/09/17 (四) 17:45:26']]), '出貨單');
            const uploaded = await response(dispatcher, '/api/orders/import', 'POST', () => dispatcher.locator('[data-testid="import-file"]').setInputFiles({ name: 'ui-fixture.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx.write(book,{type:'buffer',bookType:'xlsx'}) }));
            orderId = (await uploaded.json()).orderId; cleanupOrders.push(orderId);
            await dispatcher.getByText(`訂單 ${voucher} 已成功匯入`, { exact: true }).waitFor();
        });
        if (!orderId) throw Error('Browser import must succeed before workflow checks');
        await step('browser: dispatcher pins/unpins and marks own order urgent from task board', async () => {
            await dispatcher.goto(webBase + '/tasks');
            await Promise.all([dispatcher.waitForResponse(r => new URL(r.url()).searchParams.get('q') === voucher), dispatcher.getByLabel('查找任務', {exact:true}).fill(voucher)]);
            const pin = dispatcher.getByRole('button', { name: '置頂任務', exact: true });
            await response(dispatcher, `/api/tasks/pins/${orderId}`, 'PUT', () => pin.click());
            await dispatcher.reload(); await Promise.all([dispatcher.waitForResponse(r => new URL(r.url()).searchParams.get('q') === voucher), dispatcher.getByLabel('查找任務', {exact:true}).fill(voucher)]);
            await response(dispatcher, `/api/tasks/pins/${orderId}`, 'PUT', () => dispatcher.getByRole('button', { name: '取消置頂', exact: true }).click());
            await response(dispatcher, `/api/orders/${orderId}/urgent`, 'PATCH', () => dispatcher.getByRole('button', { name: '標記緊急', exact: true }).click());
            assert.equal((await pool.query('SELECT is_urgent FROM orders WHERE id=$1', [orderId])).rows[0].is_urgent, true);
        });
        await step('browser: order notes are visible, sent, pinned and restored after reload', async () => {
            await dispatcher.goto(webBase + '/order/' + orderId);
            const discussion = dispatcher.getByRole('region', { name: '訂單備註與討論' });
            await discussion.waitFor({ state: 'visible' });
            const input = discussion.getByPlaceholder('輸入訊息...', { exact: true });
            await input.fill(prefix + ' 備註：請確認包裝');
            const sent = await response(dispatcher, `/api/tasks/${orderId}/comments`, 'POST', () => input.press('Enter'));
            const comment = (await sent.json()).id;
            const bubble = dispatcher.locator(`#comment-${comment}`); await bubble.hover();
            await bubble.getByRole('button', { name: '留言操作', exact: true }).click();
            await response(dispatcher, `/api/tasks/${orderId}/pins/${comment}`, 'PUT', () => bubble.getByRole('button', { name: '置頂', exact: true }).click());
            await dispatcher.reload();
            await discussion.getByText('我的釘選', { exact: true }).waitFor();
            const bar = dispatcher.getByRole('region', { name: '作業快捷列' });
            await bar.getByText('我的釘選 1', { exact: true }).waitFor();
            assert.ok((await bar.innerText()).includes('備註：請確認包裝'));
            assert.ok((await dispatcher.getByRole('region', { name: '訂單備註與討論' }).innerText()).includes('備註：請確認包裝'));
            const fits = await discussion.evaluate(el => {
                const input = el.querySelector('textarea').getBoundingClientRect(), bounds = el.getBoundingClientRect();
                return input.bottom <= bounds.bottom && input.right <= bounds.right;
            });
            assert.ok(fits, 'Pinned notes must not push the message composer outside its panel');
            await dispatcher.screenshot({ path: output + '/order-notes.png', fullPage: true });
        });
        await step('browser: defect form changes only SN and records the original order', async () => {
            await dispatcher.getByRole('button', { name: '新品不良異動', exact: true }).click();
            const dialog = dispatcher.getByRole('dialog', { name: '新品不良異動' });
            await dialog.getByLabel('原 SN', { exact: true }).selectOption(serials[0]);
            const replacement = prefix + '04';
            await dialog.getByLabel('新 SN', { exact: true }).fill(replacement);
            await dialog.getByLabel('不良原因', { exact: true }).fill('UI 瑕疵 "測試",\n更換');
            await response(dispatcher, `/api/orders/${orderId}/defect`, 'POST', () => dialog.getByRole('button', { name: '確認更換', exact: true }).click());
            await dialog.waitFor({ state: 'hidden' }); serials[0] = replacement;
            assert.equal((await pool.query('SELECT count(*)::int n FROM product_defects WHERE order_id=$1', [orderId])).rows[0].n, 1);
        });
        await step('browser: picker and packer keyboard scans retain separate stages and end-to-end quantities', async () => {
            for (const role of ['picker', 'packer']) {
                ok(await api(role, 'POST', `/api/orders/${orderId}/claim`));
                const page = await pageFor(role); await page.goto(webBase + '/order/' + orderId);
                assert.equal(await page.getByRole('button', { name: '新品不良異動', exact: true }).count(), 0);
                const input = page.locator('#order-scan-input'); await input.waitFor({state:'visible'});
                await page.getByRole('button', { name: '回到掃碼輸入', exact: true }).click();
                assert.equal(await input.evaluate(el => document.activeElement === el), true);
                assert.equal(await page.getByRole('region', { name: '作業快捷列' }).getByText('我的釘選 1', { exact: true }).count(), 0);
                for (const suffix of ['BAD-A', 'BAD-B']) {
                    const wrong = prefix + '-' + suffix;
                    expectedScanFailures.set(wrong, 400);
                    await page.keyboard.type(wrong);
                    const [rejected] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/orders/update_item' && r.request().postDataJSON()?.scanValue === wrong), page.keyboard.press('Enter')]);
                    assert.equal(rejected.status(), 400);
                    await page.getByRole('alert').filter({hasText: '未完成條碼：' + wrong}).waitFor();
                    assert.equal(await input.inputValue(), '');
                    assert.equal(await input.evaluate(el => document.activeElement === el && !el.readOnly), true);
                }
                for (const [index, sn] of serials.entries()) {
                    await page.waitForFunction(() => !document.querySelector('button[aria-label="送出掃描"]')?.disabled);
                    await page.keyboard.type(sn);
                    const accepted = await response(page, '/api/orders/update_item', 'POST', () => page.keyboard.press('Enter'));
                    assert.equal(accepted.request().postDataJSON().scanValue, sn);
                    if (index === 0) {
                        expectedScanFailures.set(sn, 409);
                        await page.waitForFunction(() => !document.querySelector('button[aria-label="送出掃描"]')?.disabled);
                        await page.keyboard.type(sn);
                        const [duplicate] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/orders/update_item' && r.request().postDataJSON()?.scanValue === sn), page.keyboard.press('Enter')]);
                        assert.equal(duplicate.status(), 409);
                        await page.getByRole('alert').filter({hasText: '未完成條碼：' + sn}).waitFor();
                        assert.equal(await input.inputValue(), '');
                    }
                }
                const row = (await pool.query('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0];
                assert.equal(row.status, role === 'picker' ? 'picked' : 'completed');
                await page.close();
            }
        });
        await step('browser: picker and packer batch-claim two orders in their own phase then scan normally', async () => {
            const orders = [];
            for (const suffix of ['A','B']) {
                const voucher = prefix + '-BATCH-' + suffix;
                const book = xlsx.utils.book_new();
                xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['憑證號碼',voucher],['客戶名稱','Batch UI fixture'],['品項編碼','品項名稱','數量','SN'],['UI-BATCH-BARCODE','Batch UI item',1,'']]),'出貨單');
                const form = new FormData();
                form.set('orderFile',new Blob([xlsx.write(book,{type:'buffer',bookType:'xlsx'})]),'batch-ui.xlsx');
                const id = ok(await api('dispatcher','POST','/api/orders/import',form),201).orderId;
                orders.push({id,voucher}); cleanupOrders.push(id);
            }
            for (const [role,label,stage] of [['picker','揀貨','pick'],['packer','裝箱','pack']]) {
                const page = await pageFor(role);
                await page.goto(webBase + '/tasks');
                assert.equal(await page.getByRole('button',{name:'批次' + (role === 'picker' ? '裝箱' : '揀貨'),exact:true}).count(),0);
                await Promise.all([page.waitForResponse(r => new URL(r.url()).searchParams.get('q') === prefix + '-BATCH'),page.getByLabel('查找任務',{exact:true}).fill(prefix + '-BATCH')]);
                await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/tasks' && new URL(r.url()).searchParams.get('group') === stage),page.getByRole('button',{name:'批次'+label,exact:true}).click()]);
                for (const order of orders) await page.getByRole('checkbox',{name:'選取'+label+'任務 '+order.voucher,exact:true}).check();
                await page.screenshot({path:output+'/batch-'+role+'.png',fullPage:true});
                const route = stage === 'pick' ? '/api/orders/batch-claim' : '/api/orders/batch/claim';
                const claimed = await response(page,route,'POST',() => page.getByRole('button',{name:'認領 2 個'+label+'任務',exact:true}).click());
                assert.equal(claimed.status(),200);
                assert.equal(claimed.request().postDataJSON().stage,stage);
                const result = await claimed.json();
                assert.equal((result.failed || result.results.failed).length,0);
                await page.getByRole('button',{name:'批次'+label,exact:true}).waitFor();
                for (const order of orders) {
                    assert.deepEqual((await pool.query('SELECT status,picker_id,packer_id FROM orders WHERE id=$1',[order.id])).rows[0],{
                        status:stage === 'pick' ? 'picking' : 'packing',picker_id:users.picker,packer_id:stage === 'pack' ? users.packer : null
                    });
                    await page.goto(webBase + '/order/' + order.id);
                    const input = page.locator('#order-scan-input'); await input.waitFor();
                    await input.fill('UI-BATCH-BARCODE');
                    assert.equal((await response(page,'/api/orders/update_item','POST',() => input.press('Enter'))).status(),200);
                    assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0].status,stage === 'pick' ? 'picked' : 'completed');
                }
                await page.close();
            }
        });
        const admin = await pageFor('superadmin');
        await step('browser: personal sound selection, mute, role previews and reload persistence', async () => {
            for (const [role, profile, frequency] of [['picker','wood',780], ['packer','digital',1020]]) {
                const page = await pageFor(role);
                await page.goto(webBase + '/settings');
                const panel = page.getByRole('region', {name:'個人掃碼音效'});
                await panel.getByLabel('我的音色', {exact:true}).selectOption(profile);
                await page.reload();
                assert.equal(await panel.getByLabel('我的音色', {exact:true}).inputValue(), profile);
                for (const [label,count] of [['揀貨',1],['裝箱',2],['錯誤',3]]) {
                    await page.evaluate(() => { window.__wmsTones = []; });
                    await panel.getByRole('button', {name:'試聽'+label,exact:true}).click();
                    await page.waitForFunction(count => window.__wmsTones.length === count, count);
                    if (label === '揀貨') assert.equal(await page.evaluate(() => window.__wmsTones[0].frequency), frequency);
                }
                await panel.getByRole('switch', {name:'掃碼音效',exact:true}).click();
                await page.reload();
                assert.equal(await panel.getByRole('switch', {name:'掃碼音效',exact:true}).getAttribute('aria-checked'), 'false');
                await page.setViewportSize({width:390,height:844});
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                await page.screenshot({path:output+'/personal-sound-'+role+'.png',fullPage:true});
                await page.close();
            }
        });
        let exceptionOrder;
        const modal = (page, title) => page.getByRole('heading', { name: title, exact: true }).locator('..').locator('..');
        await step('browser: warehouse reports exception, importer proposes handling and supervisor approves and closes', async () => {
            const book = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['憑證號碼', prefix + '-CHANGE'], ['客戶名稱', 'Synthetic exception customer'], ['品項編碼','品項名稱','數量','SN'], ['UI-NON-SN','UI 一般品項',3,'']]), '出貨單');
            const form = new FormData(); form.set('orderFile', new Blob([xlsx.write(book,{type:'buffer',bookType:'xlsx'})]), 'ui-change.xlsx');
            exceptionOrder = ok(await api('dispatcher', 'POST', '/api/orders/import', form), 201).orderId; cleanupOrders.push(exceptionOrder);
            const picker = await pageFor('picker'); await picker.goto(webBase + '/order/' + exceptionOrder);
            await picker.getByRole('button', {name:'新增',exact:true}).click();
            const create = modal(picker, '回報例外'); await create.locator('select').selectOption('other');
            await create.getByPlaceholder('請描述原因與現場狀況（必填）').fill(prefix + ' 現場包材待確認');
            const created = await response(picker, `/api/orders/${exceptionOrder}/exceptions`, 'POST', () => create.getByRole('button', {name:'建立',exact:true}).click());
            const id = (await created.json()).id;
            await dispatcher.goto(webBase + '/order/' + exceptionOrder);
            await dispatcher.getByRole('button', {name:'填寫處理方式',exact:true}).click();
            const proposal = modal(dispatcher, '例外處理：填寫處理內容（待審核）');
            await proposal.locator('select').selectOption('other');
            await proposal.getByPlaceholder('請描述處理方式與原因，管理員會依此審核').fill('已更換包材，請主管核對');
            await response(dispatcher, `/api/orders/${exceptionOrder}/exceptions/${id}/propose`, 'PATCH', () => proposal.getByRole('button', {name:'送出審核',exact:true}).click());
            await admin.goto(webBase + '/order/' + exceptionOrder);
            await admin.getByRole('button', {name:'核可',exact:true}).click();
            await response(admin, `/api/orders/${exceptionOrder}/exceptions/${id}/ack`, 'PATCH', () => admin.locator('.swal2-confirm').click());
            await admin.getByRole('button', {name:'結案',exact:true}).click();
            await admin.locator('#resolution-action').selectOption('other');
            await admin.locator('#resolution-note').fill('完成現場核對');
            await response(admin, `/api/orders/${exceptionOrder}/exceptions/${id}/resolve`, 'PATCH', () => admin.locator('.swal2-confirm').click());
            const row = (await pool.query('SELECT status,resolved_by FROM order_exceptions WHERE id=$1', [id])).rows[0];
            assert.equal(row.status, 'resolved'); assert.equal(row.resolved_by, users.superadmin);
            await picker.close();
        });
        await step('browser: importer edits quantity, previews change and supervisor applies it only after approval', async () => {
            assert.ok(exceptionOrder);
            let releaseSnapshot;
            const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
            const snapshotRoute = `**/api/orders/${exceptionOrder}/work-snapshot`;
            await dispatcher.route(snapshotRoute, async route => { await snapshotGate; await route.continue(); });
            await dispatcher.goto(webBase + '/order/' + exceptionOrder);
            const changeButton = dispatcher.getByRole('button', {name:'申請異動',exact:true});
            await changeButton.waitFor({ state: 'visible' });
            assert.equal(await changeButton.isDisabled(), true, 'Order changes must wait for the complete order snapshot');
            releaseSnapshot();
            await changeButton.click();
            await dispatcher.unroute(snapshotRoute);
            const change = modal(dispatcher, '申請訂單異動（待主管核可）');
            await change.getByPlaceholder('請描述異動原因（必填）').fill('顧客增加一件');
            await change.getByRole('button', {name:'編輯',exact:true}).click();
            await change.locator('input[type="number"]').fill('4');
            await change.getByRole('button', {name:'下一步核對',exact:true}).click();
            const created = await response(dispatcher, `/api/orders/${exceptionOrder}/exceptions`, 'POST', () => change.getByRole('button', {name:'確認送出',exact:true}).click());
            const id = (await created.json()).id;
            const quantity = async () => Number((await pool.query('SELECT quantity FROM order_items WHERE order_id=$1', [exceptionOrder])).rows[0].quantity);
            assert.equal(await quantity(), 3);
            await admin.goto(webBase + '/order/' + exceptionOrder);
            await admin.getByRole('button', {name:'核可',exact:true}).click();
            await response(admin, `/api/orders/${exceptionOrder}/exceptions/${id}/ack`, 'PATCH', () => admin.locator('.swal2-confirm').click());
            assert.equal(await quantity(), 4);
            await admin.reload(); assert.equal(await quantity(), 4);
        });
        await step('browser: latest-message card, floating chat and order discussion agree in Taiwan and US timezones', async () => {
            const timeVoucher = prefix + '-TIME';
            const timeOrder = (await pool.query("INSERT INTO orders(voucher_number,customer_name,status) VALUES($1,'Timezone UI fixture','pending') RETURNING id",[timeVoucher])).rows[0].id;
            cleanupOrders.push(timeOrder);
            await pool.query("INSERT INTO task_comments(order_id,user_id,content,priority,created_at) VALUES($1,$2,'Taiwan timezone fixture','urgent',timestamp '2026-09-29 05:53:59.263438')",[timeOrder,users.dispatcher]);
            for (const timezone of ['Asia/Taipei','America/Los_Angeles']) {
                const page = await pageFor('superadmin',false,timezone);
                await page.goto(webBase + '/tasks');
                await Promise.all([page.waitForResponse(r=>new URL(r.url()).searchParams.get('q')===timeVoucher),page.getByLabel('查找任務',{exact:true}).fill(timeVoucher)]);
                await page.getByText('2026/09/29 13:53',{exact:true}).waitFor();
                await page.getByRole('button',{name:'查看訂單 '+timeVoucher+' 的留言',exact:true}).click();
                await page.getByText('2026/09/29 13:53',{exact:true}).nth(1).waitFor();
                const times = await page.locator('time').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,instant:n.dateTime})));
                assert.equal(times.length,2);
                for(const time of times){assert.equal(time.text,'2026/09/29 13:53');assert.equal(time.instant,'2026-09-29T05:53:59.263Z');}
                await page.screenshot({path:output+'/taipei-time-'+timezone.replace('/','-')+'.png',fullPage:true});
                await page.goto(webBase + '/order/' + timeOrder);
                const discussion = page.getByRole('region',{name:'訂單備註與討論'});
                await discussion.getByText('2026/09/29 13:53',{exact:true}).waitFor();
                await page.close();
            }
        });
        await step('browser: order manager submits deletion; warehouse supervisor and assigned picker receive persistent review alerts',async()=>{
            const requestVoucher=prefix+'-DELETE';
            const id=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id) VALUES($1,'Review fixture','picking',$2) RETURNING id",[requestVoucher,users.picker])).rows[0].id;
            cleanupOrders.push(id);
            await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,'REVIEW','REVIEW','Review item',1)",[id]);
            await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,details) VALUES($1,$2,'import','{}')",[id,users.orderManager]);
            const manager=await pageFor('orderManager'),supervisor=await pageFor('warehouseManager'),worker=await pageFor('picker');
            await worker.goto(webBase+'/order/'+id);
            await worker.getByPlaceholder('掃描或輸入條碼',{exact:true}).waitFor();
            await supervisor.goto(webBase+'/tasks');
            await manager.goto(webBase+'/tasks');
            await manager.getByText('訂單管理員',{exact:true}).waitFor();
            await Promise.all([manager.waitForResponse(r=>new URL(r.url()).searchParams.get('q')===requestVoucher),manager.getByLabel('查找任務',{exact:true}).fill(requestVoucher)]);
            assert.equal(await manager.getByRole('button',{name:'批次揀貨',exact:true}).count(),0);
            await manager.getByRole('button',{name:'申請刪除訂單 '+requestVoucher,exact:true}).click();
            await manager.getByRole('textbox',{name:'刪除原因',exact:true}).fill('UI review reason');
            await response(manager,`/api/orders/${id}/deletion-requests`,'POST',()=>manager.getByRole('button',{name:'送交主管審核',exact:true}).click());
            await worker.getByRole('region',{name:'訂單異動提醒'}).getByRole('status').waitFor();
            await worker.waitForFunction(()=>document.querySelector('input[placeholder*="審核中"]')?.disabled===true);
            await supervisor.getByRole('region',{name:'訂單異動提醒'}).getByRole('link',{name:'前往審核'}).click();
            const row=supervisor.getByRole('row').filter({hasText:requestVoucher});
            await row.getByRole('button',{name:'查看並審核',exact:true}).click();
            await supervisor.getByRole('alert').filter({hasText:'核准後訂單將作廢'}).waitFor();
            await supervisor.screenshot({path:output+'/warehouse-delete-review.png',fullPage:true});
            const exception=(await pool.query("SELECT id FROM order_exceptions WHERE order_id=$1 AND status='open'",[id])).rows[0].id;
            await response(supervisor,`/api/orders/${id}/exceptions/${exception}/ack`,'PATCH',()=>supervisor.getByRole('button',{name:'核准刪除並作廢',exact:true}).click());
            assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status,'voided');
            assert.equal((await pool.query('SELECT id FROM order_items WHERE order_id=$1',[id])).rowCount,1);
            await manager.goto(webBase+'/settings');
            assert.equal(await manager.getByRole('link',{name:'成員與角色',exact:true}).count(),0);
            await manager.screenshot({path:output+'/order-manager-settings.png',fullPage:true});
            await manager.close();await supervisor.close();await worker.close();
        });
        await step('browser: both manager duties retain editing controls, show exact peer changes and load the correct member form',async()=>{
            const voucher=prefix+'-MANAGERS';
            const id=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status) VALUES($1,'雙向通知驗收','pending') RETURNING id",[voucher])).rows[0].id;
            cleanupOrders.push(id);
            await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,'MANAGER','MANAGER','測試商品',2)",[id]);
            await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,details) VALUES($1,$2,'import','{}')",[id,users.dispatcher]);
            const requested=ok(await api('warehouseManager','POST',`/api/orders/${id}/exceptions`,{type:'order_change',reasonText:'倉儲確認數量',snapshot:{proposal:{note:'倉儲確認數量',items:[{barcode:'MANAGER',productName:'測試商品',quantityChange:1,noSn:true}]}}}),201);
            const manager=await pageFor('orderManager',false,'Asia/Taipei',false);
            await manager.goto(webBase+'/tasks');
            const alert=manager.getByRole('complementary',{name:'重要訂單異動'});
            await alert.getByText(voucher,{exact:true}).waitFor();
            await alert.getByText('操作人：warehouseManager（倉儲管理員）',{exact:true}).waitFor();
            await alert.getByRole('region',{name:'異動明細'}).getByText('測試商品 · MANAGER · 2 → 3 件',{exact:true}).waitFor();
            await manager.screenshot({path:output+'/manager-change-details.png',fullPage:true});
            await manager.setViewportSize({width:390,height:844});
            assert.ok(await manager.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await manager.screenshot({path:output+'/manager-change-details-mobile.png',fullPage:true});
            await manager.close();
            ok(await api('warehouseManager','PATCH',`/api/orders/${id}/exceptions/${requested.id}/reject`,{note:'保留原数量'}));
            const exception=ok(await api('picker','POST',`/api/orders/${id}/exceptions`,{type:'other',reasonText:'包材確認'}),201).id;
            for(const role of ['orderManager','warehouseManager']) {
                const page=await pageFor(role);
                await page.goto(webBase+'/order/'+id);
                await page.getByRole('button',{name:'申請異動',exact:true}).waitFor();
                await page.getByRole('button',{name:'填寫處理方式',exact:true}).click();
                const form=modal(page,'例外處理：填寫處理內容（待審核）');
                await form.locator('select').selectOption('other');
                await form.getByPlaceholder('請描述處理方式與原因，管理員會依此審核').fill(role+' 已確認包材');
                await response(page,`/api/orders/${id}/exceptions/${exception}/propose`,'PATCH',()=>form.getByRole('button',{name:'送出審核',exact:true}).click());
                await page.getByText('備註：'+role+' 已確認包材',{exact:true}).waitFor();
                assert.equal(await page.getByRole('button',{name:'核可',exact:true}).count(),role==='warehouseManager'?1:0);
                await page.close();
            }
            await admin.goto(webBase+'/admin/users');
            for(const [role,scope] of [['orderManager','orders'],['warehouseManager','warehouse']]) {
                await admin.getByRole('row').filter({hasText:role}).getByRole('button',{name:'編輯',exact:true}).click();
                const form=modal(admin,'編輯使用者');
                assert.equal(await form.locator('input[name="username"]').inputValue(),role);
                assert.equal(await form.getByLabel('角色',{exact:true}).inputValue(),'admin');
                assert.equal(await form.getByLabel('管理員分工',{exact:true}).inputValue(),scope);
                await form.getByText('兩邊管理員都會收到異動明細與警示；通知不會自動核准異動。',{exact:true}).waitFor();
                await admin.screenshot({path:output+'/member-scope-'+scope+'.png',fullPage:true});
                await form.getByRole('button',{name:'取消',exact:true}).click();
            }
            await admin.getByRole('button',{name:'新增使用者',exact:true}).click();
            const form=modal(admin,'新增使用者');
            assert.equal(await form.locator('input[name="username"]').inputValue(),'');
            await form.getByLabel('角色',{exact:true}).selectOption('admin');
            assert.equal(await form.getByLabel('管理員分工',{exact:true}).inputValue(),'orders');
            await form.getByRole('button',{name:'取消',exact:true}).click();
        });
        await step('browser: exception query is Chinese, explicit, read-only, paginated and usable on mobile', async () => {
            const queryVoucher=prefix+'-QUERY';
            const id=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status) VALUES($1,'查詢測試客戶','picked') RETURNING id",[queryVoucher])).rows[0].id;
            cleanupOrders.push(id);
            await pool.query("INSERT INTO order_exceptions(order_id,type,status,reason_text,created_by) SELECT $1,'stockout','open','查詢驗收：缺貨待確認',$2 FROM generate_series(1,101)",[id,users.picker]);
            const page=await pageFor('warehouseManager');
            let queries=0, writes=0;
            page.on('request', request=>{
                if(new URL(request.url()).pathname==='/api/admin/exceptions') queries++;
                if(request.url().includes('/api/') && ['POST','PATCH','PUT','DELETE'].includes(request.method())) writes++;
            });
            await response(page,'/api/admin/exceptions','GET',()=>page.goto(webBase+'/admin/exceptions'));
            assert.deepEqual(await page.getByLabel('訂單作業進度',{exact:true}).locator('option').allTextContents(),['全部','待揀貨','揀貨中','待裝箱','裝箱中','已完成','已作廢']);
            assert.equal(await page.getByLabel('申請人',{exact:true}).count(),0);
            const before=queries;
            await page.getByLabel('訂單號碼或 ID',{exact:true}).fill(queryVoucher);
            await page.getByLabel('訂單作業進度',{exact:true}).selectOption('picked');
            await page.getByLabel('申請類型',{exact:true}).selectOption('stockout');
            await page.getByText('條件已變更，請按查詢',{exact:true}).waitFor();
            assert.equal(queries,before,'Draft filters must not issue queries until submitted');
            const result=await response(page,'/api/admin/exceptions','GET',()=>page.getByRole('button',{name:'查詢',exact:true}).click());
            const query=new URL(result.url()).searchParams;
            assert.equal(query.get('q'),queryVoucher);assert.equal(query.get('orderStatus'),'picked');assert.equal(query.get('type'),'stockout');
            await page.getByText('第 1 頁 · 本頁 100 筆',{exact:true}).waitFor();
            await response(page,'/api/admin/exceptions','GET',()=>page.getByRole('button',{name:'下一頁',exact:true}).click());
            await page.getByText('第 2 頁 · 本頁 1 筆',{exact:true}).waitFor();
            await page.getByRole('button',{name:'人員篩選',exact:true}).click();
            await page.getByLabel('申請人',{exact:true}).selectOption(String(users.picker));
            await response(page,'/api/admin/exceptions','GET',()=>page.getByLabel('訂單號碼或 ID',{exact:true}).press('Enter'));
            await page.getByText('第 1 頁 · 本頁 100 筆',{exact:true}).waitFor();
            await response(page,'/api/admin/exceptions','GET',()=>page.getByRole('button',{name:'下一頁',exact:true}).click());
            await page.getByText('第 2 頁 · 本頁 1 筆',{exact:true}).waitFor();
            await page.getByRole('button',{name:'人員篩選（1）',exact:true}).click();
            await page.evaluate(()=>window.scrollTo(0,0));
            await page.screenshot({path:output+'/exceptions-desktop.png',fullPage:true});
            await page.setViewportSize({width:390,height:844});
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page must not overflow');
            await page.getByRole('button',{name:'查看並審核',exact:true}).filter({visible:true}).waitFor();
            await page.screenshot({path:output+'/exceptions-mobile.png',fullPage:true});
            await page.getByLabel('訂單號碼或 ID',{exact:true}).fill(prefix+'-NO-MATCH');
            await response(page,'/api/admin/exceptions','GET',()=>page.getByRole('button',{name:'查詢',exact:true}).click());
            await page.getByText('沒有符合條件的案件',{exact:true}).waitFor();
            const clear=await response(page,'/api/admin/exceptions','GET',()=>page.getByRole('button',{name:'清除條件，查看全部',exact:true}).click());
            for(const key of ['q','type','orderStatus','createdBy'])assert.equal(new URL(clear.url()).searchParams.has(key),false);
            assert.equal(await page.getByLabel('訂單號碼或 ID',{exact:true}).inputValue(),'');
            await page.route('**/api/admin/exceptions?**',route=>route.abort());
            await page.getByRole('button',{name:'重新整理',exact:true}).click();
            await page.getByRole('alert').filter({hasText:'無法載入案件'}).waitFor();
            assert.equal(await page.getByText('沒有符合條件的案件',{exact:true}).count(),0);
            await page.unroute('**/api/admin/exceptions?**');
            await response(page,'/api/admin/exceptions','GET',()=>page.getByRole('button',{name:'重試',exact:true}).click());
            await page.getByText('第 1 頁 · 本頁 100 筆',{exact:true}).waitFor();
            assert.equal(writes,0,'Filtering must never change order data');
            assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status,'picked');
            await page.close();
        });
        await step('browser: order alarms are large, audible, recover after reload and receipt does not approve',async()=>{
            const alarmVoucher=prefix+'-ALARM';
            const id=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id,packer_id) VALUES($1,'Alarm fixture','picking',$2,$3) RETURNING id",[alarmVoucher,users.picker,users.packer])).rows[0].id;
            cleanupOrders.push(id);
            await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,'ALARM','ALARM','Alarm item',1)",[id]);
            await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,details) VALUES($1,$2,'import','{}')",[id,users.orderManager]);
            const worker=await pageFor('picker',false,'Asia/Taipei',false);
            await worker.goto(webBase+'/settings');
            // Leave other fixture alarms pending; a fresh one must become prominent.
            if(await worker.getByRole('button',{name:'收合異動警示',exact:true}).count())await worker.getByRole('button',{name:'收合異動警示',exact:true}).click();
            await worker.getByRole('heading',{name:'個人掃碼音效',exact:true}).click();
            const before=await worker.evaluate(()=>window.__wmsTones.length);
            const request=ok(await api('orderManager','POST',`/api/orders/${id}/deletion-requests`,{reason:'UI 大型警示驗收'}),202);
            const alarm=worker.getByRole('complementary',{name:'重要訂單異動',exact:true});
            await alarm.getByText(alarmVoucher,{exact:true}).waitFor();
            await alarm.getByText('刪除訂單待審核',{exact:true}).waitFor();
            await worker.waitForFunction(count=>window.__wmsTones.length>=count+6,before);
            await worker.screenshot({path:output+'/order-alert-desktop.png',fullPage:false});
            await worker.reload();
            await alarm.getByText(alarmVoucher,{exact:true}).waitFor();
            await worker.setViewportSize({width:390,height:844});
            assert.ok(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await worker.screenshot({path:output+'/order-alert-mobile.png',fullPage:false});
            const notice=ok(await api('picker','GET','/api/order-change-notices')).items.find(row=>row.order_id===id);
            await response(worker,`/api/order-change-notices/${notice.id}/acknowledge`,'POST',()=>alarm.getByRole('button',{name:'我已知悉',exact:true}).click());
            assert.equal((await pool.query('SELECT status FROM order_exceptions WHERE id=$1',[request.id])).rows[0].status,'open');
            assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status,'picking');
            // Rejection is a second durable notification even though pending review clears.
            ok(await api('warehouseManager','PATCH',`/api/orders/${id}/exceptions/${request.id}/reject`,{note:'UI 駁回驗收'}));
            await alarm.getByText('刪除訂單已駁回',{exact:true}).waitFor();
            await worker.close();
        });
        await step('browser: every legacy admin screen, reports, history, team and settings loads real API data', async () => {
            const pages = [['/admin','出貨管理'], ['/admin/users','成員與角色'], ['/admin/operation-logs','操作日誌查詢'], ['/admin/analytics','數據分析儀表板'], ['/admin/scan-errors','刷錯條碼分析'], ['/admin/defects','新品不良異動'], ['/admin/exceptions','例外總覽'], ['/team','公告板'], ['/settings','設定']];
            for (const [route,title] of pages) {
                await admin.goto(webBase + route); await admin.getByRole('heading', { name: title, exact: true }).waitFor();
            }
        });
        await step('browser: defect record links to source order and downloads a valid CSV', async () => {
            await admin.goto(webBase + '/admin/defects'); await admin.getByRole('link', { name: voucher, exact: true }).waitFor();
            const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: '匯出報告', exact: true }).click()]);
            const file = await download.path(), csv = fs.readFileSync(file, 'utf8');
            assert.ok(csv.includes(voucher)); assert.ok(csv.includes('UI 瑕疵 ""測試"",\n更換'));
            await admin.getByRole('link', { name: voucher, exact: true }).click();
            await admin.getByRole('heading', { name: voucher, exact: true }).waitFor();
        });
        await step('browser: shipping label and picking list contain a scannable barcode and complete item data', async () => {
            for (const [index,name] of ['列印出貨標籤','列印揀貨單'].entries()) {
                await admin.getByRole('button', { name, exact: true }).click();
                await admin.waitForFunction(count => window.__wmsPrints?.length === count, index + 1);
                const printed = await admin.evaluate(index => window.__wmsPrints[index], index);
                assert.ok(printed.text.includes(voucher)); assert.ok(printed.text.includes('UI 驗收產品'));
                if (index === 0) assert.ok(printed.barcode);
            }
            await admin.getByRole('button', { name: '匯出出貨明細', exact: true }).waitFor();
        });
        await step('browser: phone viewport exposes notes and keeps defect dialog usable without page overflow', async () => {
            const mobile = await pageFor('superadmin', true); await mobile.goto(webBase + '/order/' + orderId);
            await mobile.getByRole('button', { name: '新品不良異動', exact: true }).click();
            await mobile.getByRole('dialog', { name: '新品不良異動' }).getByLabel('原 SN', { exact: true }).waitFor();
            assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await mobile.getByRole('dialog', { name: '新品不良異動' }).evaluate(el => Promise.all(el.parentElement.getAnimations({subtree:true}).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(()=>{}))));
            await mobile.screenshot({ path: output + '/mobile-defect.png', fullPage: false });
            await mobile.getByRole('button', { name: '關閉新品不良異動', exact: true }).click();
        });
        await step('browser: mixed ERP signed import, task badges, prints and Excel retain -1/+1 while both stages verify two units', async () => {
            const signedVoucher = prefix + '-SIGNED';
            const book = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([
                ['憑證號碼', signedVoucher], ['客戶名稱', 'ERP signed UI fixture'],
                ['品項編碼', '品項名稱', '數量', 'SN'],
                ['4711299274640', 'UI 沖正商品', -1, ''], ['4711299274633', 'UI 新增商品', 1, ''],
            ]), '理貨單');
            await dispatcher.goto(webBase + '/admin');
            const receipt = await response(dispatcher, '/api/orders/import', 'POST', () => dispatcher.locator('[data-testid="import-file"]').setInputFiles({ name: 'signed-ui.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }) }));
            const result = await receipt.json(); cleanupOrders.push(result.orderId);
            assert.equal(result.operation, 'adjustment'); assert.equal(result.signedTotalQuantity, 0); assert.equal(result.totalQuantity, 2);
            await dispatcher.getByText(`異動理貨單 ${signedVoucher} 已成功匯入`, { exact: true }).waitFor();
            assert.match(await dispatcher.locator('[data-testid="import-result"]').innerText(), /新增 1 件／沖正 1 件，共需核對 2 件/);
            await dispatcher.goto(webBase + '/tasks');
            await Promise.all([dispatcher.waitForResponse(r => new URL(r.url()).searchParams.get('q') === signedVoucher), dispatcher.getByLabel('查找任務', { exact: true }).fill(signedVoucher)]);
            await dispatcher.getByText('異動理貨單', { exact: true }).waitFor();
            await admin.goto(webBase + '/order/' + result.orderId);
            await admin.getByRole('status', { name: '理貨單異動數量' }).waitFor();
            await admin.getByText('-1 件 · 沖正', { exact: true }).waitFor();
            await admin.getByText('+1 件 · 新增', { exact: true }).waitFor();
            assert.equal(await admin.getByRole('button', { name: '申請異動', exact: true }).count(), 0);
            await admin.evaluate(() => window.scrollTo(0, 0));
            await admin.screenshot({ path: output + '/signed-order-desktop.png', fullPage: false });
            await admin.setViewportSize({ width: 390, height: 844 });
            assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            await admin.screenshot({ path: output + '/signed-order-mobile.png', fullPage: false });
            await admin.setViewportSize({ width: 1440, height: 1100 });
            const printsBefore = await admin.evaluate(() => window.__wmsPrints.length);
            for (const [index, name] of ['列印出貨標籤', '列印揀貨單'].entries()) {
                await admin.getByRole('button', { name, exact: true }).click();
                await admin.waitForFunction(count => window.__wmsPrints.length === count, printsBefore + index + 1);
                const printed = await admin.evaluate(index => window.__wmsPrints[index], printsBefore + index);
                assert.ok(printed.text.includes('-1')); assert.ok(printed.text.includes('+1'));
                assert.ok(printed.text.includes('新增 1 件／沖正 1 件')); assert.ok(printed.text.includes('核對件數'));
            }
            const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: '匯出出貨明細', exact: true }).click()]);
            const exported = xlsx.read(fs.readFileSync(await download.path()), { type: 'buffer' });
            const rows = xlsx.utils.sheet_to_json(exported.Sheets[exported.SheetNames[0]]);
            assert.deepEqual(rows.map(row => row['應出數量']), [-1, 1]);
            assert.deepEqual(rows.map(row => row['核對件數']), [1, 1]);
            for (const role of ['picker', 'packer']) {
                ok(await api(role, 'POST', `/api/orders/${result.orderId}/claim`));
                const worker = await pageFor(role); await worker.goto(webBase + '/order/' + result.orderId);
                const input = worker.locator('#order-scan-input'); await input.waitFor();
                for (const [index, barcode] of ['4711299274640', '4711299274633'].entries()) {
                    await worker.waitForFunction(() => !document.querySelector('button[aria-label="送出掃描"]')?.disabled);
                    await input.fill(barcode);
                    await response(worker, '/api/orders/update_item', 'POST', () => input.press('Enter'));
                    const status = (await pool.query('SELECT status FROM orders WHERE id=$1', [result.orderId])).rows[0].status;
                    assert.equal(status, index === 0 ? (role === 'picker' ? 'picking' : 'packing') : (role === 'picker' ? 'picked' : 'completed'));
                }
                await worker.close();
            }
        });
        await step('browser: scanning the same barcode with opposite signed rows requires direction once and never scans the wrong row', async () => {
            const voucher = prefix + '-SAME-SIGN', barcode = prefix + '-SAME-BAR';
            const id = (await pool.query("INSERT INTO orders(voucher_number,customer_name,status,document_type) VALUES($1,'Signed direction fixture','pending','adjustment') RETURNING id", [voucher])).rows[0].id;
            cleanupOrders.push(id);
            const inserted = await pool.query("INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity,quantity_sign) VALUES($1,'DIR','UI 同條碼沖正',$2,1,-1),($1,'DIR','UI 同條碼新增',$2,1,1) RETURNING id,quantity_sign", [id, barcode]);
            const negativeId = inserted.rows.find(row => row.quantity_sign === -1).id, positiveId = inserted.rows.find(row => row.quantity_sign === 1).id;
            for (const role of ['picker', 'packer']) {
                ok(await api(role, 'POST', `/api/orders/${id}/claim`));
                const worker = await pageFor(role); await worker.goto(webBase + '/order/' + id);
                const input = worker.locator('#order-scan-input'); await input.waitFor();
                await input.fill(barcode); await input.press('Enter');
                const choice = worker.getByRole('dialog', { name: '請選擇本次核對的品項', exact: true });
                await choice.waitFor();
                const first = await response(worker, '/api/orders/update_item', 'POST', () => choice.getByRole('button').filter({ hasText: 'UI 同條碼沖正' }).click());
                assert.equal(first.request().postDataJSON().orderItemId, negativeId);
                await choice.waitFor({ state: 'hidden' });
                await worker.waitForFunction(() => !document.querySelector('button[aria-label="送出掃描"]')?.disabled);
                await input.fill(barcode);
                const second = await response(worker, '/api/orders/update_item', 'POST', () => input.press('Enter'));
                assert.equal(second.request().postDataJSON().orderItemId, positiveId);
                assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [id])).rows[0].status, role === 'picker' ? 'picked' : 'completed');
                await worker.close();
            }
        });
    } finally {
        report.finishedAt = new Date().toISOString(); report.passed = report.checks.length === 20 && report.checks.every(c=>c.passed) && !report.pageErrors.length && !report.failedResponses.some(r => !r.expected);
        fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(output + '/browser-acceptance.json', JSON.stringify(report, null, 2));
        for (const context of contexts) await context.close();
        await browser.close(); if (vite) await vite.close(); process.chdir(originalCwd);
    }
    assert.ok(report.passed, JSON.stringify(report));
};
