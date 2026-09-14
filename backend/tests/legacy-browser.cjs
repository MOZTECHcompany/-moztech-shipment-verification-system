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
    async function pageFor(role, mobile = false) {
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 }, extraHTTPHeaders: iam ? { 'X-Serverless-Authorization': 'Bearer ' + iam } : {} });
        contexts.push(context);
        const user = (await pool.query('SELECT id,username,name,role FROM users WHERE id=$1', [users[role]])).rows[0];
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
        vite = await createServer({ root: root + '/frontend', configFile: root + '/frontend/vite.config.js', logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: base }, '/socket.io': { target: base, ws: true } } } });
        await vite.listen(); webBase = 'http://127.0.0.1:' + vite.httpServer.address().port;
    }
        report.webBase = webBase;
        const dispatcher = await pageFor('dispatcher');
        await step('browser: dispatcher imports a real XLSX through the original upload flow', async () => {
            await dispatcher.goto(webBase + '/admin');
            const book = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['憑證號碼', voucher], ['客戶名稱', 'UI synthetic customer'], ['品項編碼','品項名稱','數量','SN'], ['UI-BARCODE','UI 驗收產品',3,serials.join('/')]]), '出貨單');
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
            await dispatcher.getByRole('button', {name:'填處理',exact:true}).click();
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
    } finally {
        report.finishedAt = new Date().toISOString(); report.passed = report.checks.length === 12 && report.checks.every(c=>c.passed) && !report.pageErrors.length && !report.failedResponses.some(r => !r.expected);
        fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(output + '/browser-acceptance.json', JSON.stringify(report, null, 2));
        for (const context of contexts) await context.close();
        await browser.close(); if (vite) await vite.close(); process.chdir(originalCwd);
    }
    assert.ok(report.passed, JSON.stringify(report));
};
