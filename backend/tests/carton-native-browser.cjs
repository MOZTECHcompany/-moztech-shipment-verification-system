// Full legacy WMS UI, synthetic loopback data only. No ERP portal or manifest.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const xlsx = require('xlsx');
const zxing = require('../../frontend/node_modules/@zxing/library');

(async () => {
    if (process.env.WMS_CARTON_LOCAL_DEV !== '1') throw Error('Synthetic local opt-in required');
    const output = process.env.WMS_CARTON_BROWSER_OUTPUT;
    if (!output) throw Error('Evidence output required');
    fs.mkdirSync(output, { recursive: true });
    const { chromium } = require(process.env.WMS_PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.WMS_CHROME_EXECUTABLE || undefined });
    const errors = [], records = [], contexts = [];
    async function login(username) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto('http://127.0.0.1:55771/login');
        await page.locator('#corely-username').fill(username);
        await page.locator('#corely-password').fill('carton-dev-fixture-only');
        await page.getByRole('button', { name: '登入系統' }).click(); await page.waitForURL('**/tasks');
        return page;
    }
    async function api(page, method, url, data) {
        const token = await page.evaluate(() => JSON.parse(localStorage.getItem('wms_token')));
        const result = await page.request.fetch('http://127.0.0.1:55452' + url, { method, headers: { Authorization: `Bearer ${token}` }, ...(data ? { data } : {}) });
        assert.ok(result.ok(), await result.text()); return result.json();
    }
    async function decode(page) {
        const rgba = await page.locator('[data-carton-label] svg').evaluate(async svg => {
            const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)); await img.decode();
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 400;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 400); ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 20, 20, 360, 360); return Array.from(ctx.getImageData(0, 0, 400, 400).data);
        });
        const pixels = new Int32Array(400 * 400); for (let i = 0; i < pixels.length; i++) pixels[i] = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
        return new zxing.QRCodeReader().decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(pixels, 400, 400)))).getText();
    }
    async function create(page, box) {
        await page.goto('http://127.0.0.1:55771/cartons');
        await page.getByRole('button', { name: '新增箱號', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.getByLabel('箱號', { exact: true }).fill(box.id);
        await dialog.getByLabel('搜尋已匯入品項', { exact: true }).fill(box.item);
        await dialog.getByRole('button', { name: new RegExp('^' + box.item + ' ·') }).click();
        assert.equal(await dialog.getByLabel('WMS 品號／型號', { exact: true }).inputValue(), box.item);
        assert.equal(await dialog.getByLabel('國際條碼', { exact: true }).inputValue(), '');
        if (box.ean) await dialog.getByRole('button', { name: '確認為國際條碼', exact: true }).click();
        else await dialog.getByRole('button', { name: '只使用品號', exact: true }).click();
        await dialog.getByLabel('數量', { exact: true }).fill('10');
        await dialog.getByLabel('箱內 SN', { exact: true }).fill(box.sns.join('\n'));
        const saved = page.waitForResponse(r => r.url().endsWith('/api/cartons') && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: '儲存', exact: true }).click(); assert.equal((await saved).status(), 201);
        await page.getByRole('dialog').getByRole('button', { name: '確認箱內內容', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '列印貼紙', exact: true }).click();
        const decoded = await decode(page); assert.equal(decoded, `CARTON:${box.id}`);
        await page.screenshot({ path: path.join(output, box.id + '-label.png'), fullPage: true });
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        const stored = await api(page, 'GET', '/api/cartons/' + box.id); const carton = stored.carton || stored;
        assert.equal(carton.status, 'sealed'); assert.equal(carton.lines[0].itemCode, box.item);
        assert.equal(carton.lines[0].ean, box.ean || null); assert.deepEqual(carton.lines[0].actualSN, box.sns);
        records.push({ case: 'native-manual-create-seal-qr', cartonId: box.id, decoded, quantity: 10, snCount: box.sns.length, ean: carton.lines[0].ean });
    }
    async function importEcount(page, box) {
        const workbook = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
            ['理貨單'], ['憑證號碼：DEV-ECOUNT-' + box.id], ['客戶名稱：Synthetic dealer'],
            ['品項編碼', '品項名稱(規格)', '數量', '品項型號', '實際SN'],
            [box.sourceBarcode, 'Synthetic carton product', 10, box.item, '']
        ]), '理貨單');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        const token = await page.evaluate(() => JSON.parse(localStorage.getItem('wms_token')));
        const result = await page.request.post('http://127.0.0.1:55452/api/orders/import', { headers: { Authorization: `Bearer ${token}` }, multipart: { orderFile: { name: 'synthetic-ecount.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } } });
        assert.equal(result.status(), 201, await result.text()); const data = await result.json();
        records.push({ case: 'ecount-format-file-import', orderId: data.orderId, voucher: 'DEV-ECOUNT-' + box.id }); return data.orderId;
    }
    async function scan(page, id, box, stage) {
        await api(page, 'POST', `/api/orders/${id}/claim`, { stage });
        await page.goto(`http://127.0.0.1:55771/order/${id}?stage=${stage}`);
        await page.waitForFunction(() => !document.querySelector('#order-scan-input')?.disabled && !!document.querySelector('#order-scan-input'));
        const response = page.waitForResponse(r => r.url().endsWith(`/api/orders/${id}/carton-scan`) && r.request().method() === 'POST');
        await page.locator('#order-scan-input').fill(`CARTON:${box.id}`); await page.locator('#order-scan-input').press('Enter');
        const result = await response; assert.equal(result.status(), 200, await result.text()); const data = await result.json();
        assert.equal(data.allocation.status, stage === 'pick' ? 'picked' : 'packed');
        assert.equal(data.allocation.lines.reduce((sum, line) => sum + line.quantity, 0), 10);
        await page.waitForURL('**/tasks'); records.push({ case: 'native-main-input-' + stage, orderId: id, cartonId: box.id, amount: 10 });
    }
    try {
        const admin = await login('fixture-admin');
        const boxes = [
            { id: 'CTN-NATIVE-SN10', item: 'SN-ITEM', ean: '4710000000010', sourceBarcode: '4710000000010', sns: Array.from({ length: 10 }, (_, i) => `Vendor-Sn${String(i + 1).padStart(4, '0')}`) },
            { id: 'CTN-NATIVE-NOEAN10', item: 'LOCAL-ITEM', ean: null, sourceBarcode: 'ITM-LOCAL-ITEM', sns: [] }
        ];
        for (const box of boxes) await create(admin, box);
        const worker = await login('fixture-picker');
        for (const box of boxes) {
            const id = await importEcount(admin, box); await scan(worker, id, box, 'pick');
            const result = await api(admin, 'GET', '/api/cartons/' + box.id); assert.equal((result.carton || result).lines[0].remainingQuantity, 0);
            // One legacy account executes both stages only after an explicit claim.
            await scan(worker, id, box, 'pack');
            const snapshot = await api(admin, 'GET', `/api/orders/${id}/work-snapshot`);
            assert.equal(snapshot.order.status, 'completed'); assert.equal(snapshot.order.picker_id, snapshot.order.packer_id);
            assert.deepEqual(snapshot.instances.map(row => row.serial_number).sort(), [...box.sns].sort());
            const after = await api(admin, 'GET', '/api/cartons/' + box.id); assert.equal((after.carton || after).lines[0].remainingQuantity, 0);
            const trace = await api(admin, 'GET', `/api/orders/${id}/carton-shipments`);
            assert.equal(trace.allocations[0].status, 'packed');
            records.push({ case: 'same-account-pick-pack-exact-contents-one-allocation', cartonId: box.id, snCount: snapshot.instances.length, formalInventoryPosting: false });
        }
        assert.deepEqual(errors, []); fs.writeFileSync(path.join(output, 'native-acceptance.json'), JSON.stringify({ scope: 'synthetic local PostgreSQL and actual standalone WMS; native UI create before ECOUNT-format import; no new ERP or production business calls', records, pageErrors: errors }, null, 2));
        console.log(JSON.stringify({ passed: records.length, pageErrors: errors.length }));
    } finally { for (const context of contexts) await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
