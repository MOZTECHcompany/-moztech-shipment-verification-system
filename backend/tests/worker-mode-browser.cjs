const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async ({ step, pageFor, response, api, ok, pool, users, webBase, prefix, output, cleanupOrders }) => {
    let sequence = 0;
    async function fixture(quantity = 2, status = 'pending', owner) {
        const voucher = prefix + '-DUAL-' + ++sequence;
        const order = (await pool.query('INSERT INTO orders(voucher_number,customer_name,status,picker_id) VALUES($1,$2,$3,$4) RETURNING id', [voucher, '同帳號工序驗收', status, owner || null])).rows[0].id;
        await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,'UI-DUAL-CODE','UI-DUAL-CODE','雙工序測試商品',$2)", [order, quantity]);
        cleanupOrders.push(order); return { order, voucher };
    }
    const work = async order => (await pool.query('SELECT status,picker_id,packer_id,pick_paused_at,pack_paused_at FROM orders WHERE id=$1', [order])).rows[0];
    const count = async order => (await pool.query('SELECT picked_quantity,packed_quantity FROM order_items WHERE order_id=$1', [order])).rows[0];
    const selectStage = async (page, stage, initial = false) => {
        const panel = page.getByRole('region', { name: '目前作業', exact: true });
        const label = stage === 'pick' ? '揀貨' : '裝箱';
        const button = panel.getByRole('button', { name: initial ? new RegExp('^開始' + label) : label, exact: !initial });
        await response(page, '/api/warehouse/work-mode', 'PUT', () => button.click());
        await panel.getByText('目前作業：' + label, { exact: true }).waitFor();
    };
    const scan = async page => {
        const input = page.locator('#order-scan-input');
        await page.waitForFunction(() => !document.querySelector('button[aria-label="送出掃描"]')?.disabled);
        await input.fill('UI-DUAL-CODE');
        return response(page, '/api/orders/update_item', 'POST', () => input.press('Enter'));
    };

    await step('browser: the same picking account selects either daily stage and corrects a wrong choice before starting without changing its credentials', async () => {
        const item = await fixture();
        const before = (await pool.query('SELECT username,password,role FROM users WHERE id=$1', [users.dualWorker])).rows[0];
        const page = await pageFor('dualWorker');
        await page.goto(webBase + '/tasks');
        await page.getByText('今天做什麼？', { exact: true }).waitFor();
        await selectStage(page, 'pack', true);
        assert.equal(await page.getByRole('button', { name: '批次揀貨', exact: true }).count(), 0);
        await selectStage(page, 'pick');
        await page.getByRole('button', { name: '批次揀貨', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '批次裝箱', exact: true }).count(), 0);
        assert.equal((await work(item.order)).status, 'pending'); assert.deepEqual(await count(item.order), { picked_quantity: 0, packed_quantity: 0 });
        assert.deepEqual((await pool.query('SELECT username,password,role FROM users WHERE id=$1', [users.dualWorker])).rows[0], before);
        await page.screenshot({ path: output + '/dual-work-stage-choice.png', fullPage: true });
        await page.close();
    });
    await step('browser: independent tabs retain phase; pause and resume keep progress, and packing starts only after an explicit claim from the work board', async () => {
        const item = await fixture();
        const page = await pageFor('dualWorker'); await page.goto(webBase + '/tasks');
        await selectStage(page, 'pick', true);
        await Promise.all([page.waitForResponse(r => new URL(r.url()).searchParams.get('q') === item.voucher), page.getByLabel('查找任務', { exact: true }).fill(item.voucher)]);
        const claim = await response(page, `/api/orders/${item.order}/claim`, 'POST', () => page.getByRole('button', { name: '開始揀貨', exact: true }).click());
        assert.equal(claim.request().postDataJSON().stage, 'pick');
        await page.waitForURL('**/order/' + item.order + '?stage=pick');
        await scan(page); assert.deepEqual(await count(item.order), { picked_quantity: 1, packed_quantity: 0 });
        const second = await pageFor('dualWorker', false, 'Asia/Taipei', true, page.context()); await second.goto(webBase + '/tasks');
        await selectStage(second, 'pack', true);
        assert.equal(new URL(page.url()).searchParams.get('stage'), 'pick');
        await page.getByRole('region', { name: '作業快捷列', exact: true }).getByText(/揀貨作業/).waitFor();
        await page.getByRole('button', { name: '切換作業', exact: true }).click();
        await page.getByRole('button', { name: '暫停並切換', exact: true }).click();
        await page.waitForURL('**/tasks');
        const paused = await work(item.order); assert.equal(paused.status, 'picking'); assert.ok(paused.pick_paused_at); assert.equal(paused.picker_id, users.dualWorker);
        assert.deepEqual(await count(item.order), { picked_quantity: 1, packed_quantity: 0 });
        await second.goto(webBase + '/order/' + item.order + '?stage=pick');
        await second.getByText('揀貨已暫停，核對進度保留。', { exact: true }).waitFor();
        assert.equal(await second.getByRole('button', { name: '送出掃描', exact: true }).isDisabled(), true);
        await response(second, `/api/orders/${item.order}/work-resume`, 'POST', () => second.getByRole('button', { name: '繼續作業', exact: true }).click());
        await scan(second);
        await second.screenshot({ path: output + '/dual-work-after-final-pick.png', fullPage: true });
        assert.equal((await work(item.order)).status, 'picked');
        await second.waitForURL('**/tasks');
        assert.deepEqual(await count(item.order), { picked_quantity: 2, packed_quantity: 0 });
        const premature = await api('dualWorker', 'POST', '/api/orders/update_item', { orderId: item.order, scanValue: 'UI-DUAL-CODE', type: 'pack' });
        assert.equal(premature.status, 409); assert.equal((await count(item.order)).packed_quantity, 0);
        await second.getByRole('button', { name: '進行中', exact: true }).click();
        const mode = second.getByRole('region', { name: '目前作業', exact: true });
        await mode.waitFor();
        const packing = mode.getByRole('button', { name: '裝箱', exact: true });
        if (await packing.getAttribute('aria-pressed') !== 'true') await selectStage(second, 'pack');
        await Promise.all([second.waitForResponse(r => new URL(r.url()).searchParams.get('q') === item.voucher), second.getByLabel('查找任務', { exact: true }).fill(item.voucher)]);
        await response(second, `/api/orders/${item.order}/claim`, 'POST', () => second.getByRole('button', { name: '開始裝箱', exact: true }).click());
        await second.waitForURL('**/order/' + item.order + '?stage=pack');
        for (let i = 0; i < 2; i++) await scan(second);
        const complete = await work(item.order); assert.equal(complete.status, 'completed'); assert.equal(complete.picker_id, users.dualWorker); assert.equal(complete.packer_id, users.dualWorker);
        const logs = (await pool.query("SELECT user_id,work_type,actor_snapshot FROM operation_logs WHERE order_id=$1 AND action_type IN ('pick','pack') ORDER BY id", [item.order])).rows;
        assert.deepEqual(logs.map(row => [row.user_id, row.work_type]), [[users.dualWorker, 'pick'], [users.dualWorker, 'pick'], [users.dualWorker, 'pack'], [users.dualWorker, 'pack']]);
        await second.screenshot({ path: output + '/dual-work-completed.png', fullPage: true });
        await page.close(); await second.close();
    });
    await step('browser: one unchanged picker account batch-picks, switches to packing, batch-claims two orders and completes packing in the same session', async () => {
        const rows = [await fixture(1),await fixture(1)];
        const identityBefore = (await pool.query('SELECT username,password,role,management_scope FROM users WHERE id=$1',[users.dualWorker])).rows[0];
        assert.equal(identityBefore.role,'picker');
        const page = await pageFor('dualWorker');
        let tokenBefore;
        const evidence = { kind:'synthetic_loopback_real_Chrome_same_session',actorId:users.dualWorker,role:'picker',orders:rows,stages:[] };
        for (const stage of ['pick','pack']) {
            const label = stage === 'pick' ? '揀貨' : '裝箱';
            await page.goto(webBase+'/tasks');
            if (tokenBefore === undefined) tokenBefore = await page.evaluate(() => localStorage.getItem('wms_token'));
            await page.getByRole('button',{name:'進行中',exact:true}).click();
            const mode = page.getByRole('region',{name:'目前作業',exact:true});await mode.waitFor();
            await selectStage(page,stage,stage === 'pick');
            await Promise.all([page.waitForResponse(r => new URL(r.url()).searchParams.get('q') === prefix+'-DUAL'),page.getByLabel('查找任務',{exact:true}).fill(prefix+'-DUAL')]);
            await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/tasks' && new URL(r.url()).searchParams.get('group') === stage),page.getByRole('button',{name:'批次'+label,exact:true}).click()]);
            for (const row of rows) await page.getByRole('checkbox',{name:'選取'+label+'任務 '+row.voucher,exact:true}).check();
            await page.screenshot({path:output+'/same-picker-batch-'+stage+'-selected.png',fullPage:true});
            const route = stage === 'pick' ? '/api/orders/batch-claim' : '/api/orders/batch/claim';
            const claimed = await response(page,route,'POST',() => page.getByRole('button',{name:'認領 2 個'+label+'任務',exact:true}).click());
            const submitted = claimed.request().postDataJSON();assert.equal(submitted.stage,stage);assert.deepEqual(submitted.orderIds.map(Number).sort((a,b)=>a-b),rows.map(row=>row.order).sort((a,b)=>a-b));
            const result = await claimed.json();assert.equal((result.failed || result.results?.failed || []).length,0);
            assert.deepEqual((result.orders || []).map(row=>row.id).concat(result.results?.success || []).sort((a,b)=>a-b),rows.map(row=>row.order).sort((a,b)=>a-b));
            await page.getByRole('button',{name:'批次'+label,exact:true}).waitFor();
            for (const row of rows) {
                assert.equal((await work(row.order))[stage === 'pick' ? 'picker_id' : 'packer_id'],users.dualWorker);
                await page.goto(webBase+'/order/'+row.order+'?stage='+stage);
                const accepted = await scan(page);assert.equal(accepted.request().postDataJSON().type,stage);
                await page.waitForURL('**/tasks');
                assert.equal((await work(row.order)).status,stage === 'pick' ? 'picked' : 'completed');
                assert.deepEqual(await count(row.order),{picked_quantity:1,packed_quantity:stage === 'pack' ? 1 : 0});
            }
            evidence.stages.push({stage,route,claimedOrderIds:submitted.orderIds.map(Number),completedOrderIds:rows.map(row=>row.order)});
        }
        assert.equal((await page.evaluate(() => localStorage.getItem('wms_token'))) === tokenBefore,true,'No logout, second password or role change is used');
        assert.deepEqual((await pool.query('SELECT username,password,role,management_scope FROM users WHERE id=$1',[users.dualWorker])).rows[0],identityBefore);
        const logs = (await pool.query("SELECT order_id,user_id,work_type,actor_snapshot FROM operation_logs WHERE order_id=ANY($1::int[]) AND action_type IN ('pick','pack') ORDER BY order_id,id",[rows.map(row=>row.order)])).rows;
        assert.equal(logs.length,4);for(const row of rows)assert.deepEqual(logs.filter(log=>log.order_id===row.order).map(log=>[log.user_id,log.work_type]),[[users.dualWorker,'pick'],[users.dualWorker,'pack']]);
        for(const log of logs){assert.equal(log.actor_snapshot.id,users.dualWorker);assert.equal(log.actor_snapshot.role,'picker');}
        evidence.identityUnchanged=true;evidence.sameSession=true;evidence.operations=logs;evidence.passed=true;
        fs.writeFileSync(output+'/same-picker-batch-evidence.json',JSON.stringify(evidence,null,2));
        await page.screenshot({path:output+'/same-picker-batch-completed.png',fullPage:true});await page.close();
    });
    await step('browser: warehouse supervisor explicitly hands over work to a packing account with picking capability and sees preserved progress and truthful names', async () => {
        const item = await fixture(3, 'picking', users.dualWorker);
        await pool.query('UPDATE order_items SET picked_quantity=1 WHERE order_id=$1', [item.order]);
        const supervisor = await pageFor('warehouseManager'); await supervisor.goto(webBase + '/order/' + item.order + '?stage=pick');
        await supervisor.getByRole('button', { name: '交接任務', exact: true }).click();
        const dialog = supervisor.getByRole('dialog', { name: '交接任務', exact: true });
        await dialog.getByLabel('接手人員', { exact: true }).selectOption(String(users.dualPacker));
        await dialog.getByLabel('交接備註', { exact: true }).fill('班別交接，已揀一件');
        await response(supervisor, `/api/tasks/${item.order}/transfer`, 'POST', () => dialog.getByRole('button', { name: '確認交接', exact: true }).click());
        await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await count(item.order), { picked_quantity: 1, packed_quantity: 0 }); assert.equal((await work(item.order)).picker_id, users.dualPacker);
        await supervisor.getByText('交接紀錄（1）', { exact: true }).click();
        await supervisor.getByText('揀貨：Fixture dualWorker → Fixture dualPacker', { exact: true }).waitFor();
        await supervisor.getByText(/操作：warehouseManager/).waitFor();
        const record = ok(await api('warehouseManager', 'GET', `/api/orders/${item.order}/handoffs`)).items[0];
        assert.equal(record.from_user_id, users.dualWorker); assert.equal(record.to_user_id, users.dualPacker); assert.equal(record.performed_by, users.warehouseManager); assert.equal(record.progress_snapshot.picked_quantity, 1);
        await supervisor.screenshot({ path: output + '/dual-work-handoff.png', fullPage: true });
        await supervisor.setViewportSize({ width: 390, height: 844 });
        assert.ok(await supervisor.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await supervisor.screenshot({ path: output + '/dual-work-handoff-mobile.png', fullPage: true });
        await supervisor.close();
    });
    await step('browser: warehouse manager assigns the daily stage without editing any existing username, password or role', async () => {
        const before = (await pool.query('SELECT username,password,role FROM users WHERE id=$1', [users.dualWorker])).rows[0];
        const manager = await pageFor('warehouseManager'); await manager.goto(webBase + '/admin/users');
        const select = manager.getByLabel('Fixture dualWorker的今日預設', { exact: true });
        await response(manager, `/api/warehouse/operators/${users.dualWorker}/today`, 'PUT', () => select.selectOption('pick'));
        assert.deepEqual((await pool.query('SELECT username,password,role FROM users WHERE id=$1', [users.dualWorker])).rows[0], before);
        assert.equal(ok(await api('dualWorker', 'GET', '/api/warehouse/work-mode')).today_assignment.stage, 'pick');
        await manager.screenshot({ path: output + '/dual-work-daily-assignment.png', fullPage: true });
        await manager.close();
    });
};
