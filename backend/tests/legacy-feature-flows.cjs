const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Runs only inside the disposable database owned by warehouse-parity.pg.test.cjs.
module.exports = async function legacyFeatures({ t, api, ok, pool, users, importOrder, observedEvents, snOrder }) {
    const order = ok(await importOrder('PARITY-FEATURES', 3, ['FEATURESN001', 'FEATURESN002', 'FEATURESN003']), 201).orderId;
    await t.test('history, search, urgent, shared pins and work snapshot retain order identity', async () => {
        const snapshot = ok(await api('dispatcher', 'GET', `/api/orders/${order}/work-snapshot`));
        assert.equal(snapshot.order.imported_by_user_id, users.dispatcher);
        assert.equal(snapshot.order.voucher_number, 'PARITY-FEATURES');
        ok(await api('dispatcher', 'PATCH', `/api/orders/${order}/urgent`, { isUrgent: true }));
        assert.equal((await pool.query('SELECT is_urgent FROM orders WHERE id=$1', [order])).rows[0].is_urgent, true);
        ok(await api('dispatcher', 'PUT', `/api/tasks/pins/${order}`, { pinned: true }));
        assert.ok(ok(await api('picker', 'GET', '/api/tasks/pins')).pinned.includes(order));
        ok(await api('dispatcher', 'PUT', `/api/tasks/pins/${order}`, { pinned: false }));
        assert.ok(!ok(await api('picker', 'GET', '/api/tasks/pins')).pinned.includes(order));
        const list = ok(await api('picker', 'GET', '/api/tasks?pagination=cursor&q=PARITY-FEATURES'));
        assert.ok(JSON.stringify(list).includes('PARITY-FEATURES'));
        assert.ok(JSON.stringify(ok(await api('admin', 'GET', '/api/tasks/completed?limit=200'))).includes('PARITY-SN'));
        const basic = ok(await api('picker', 'GET', '/api/users/basic'));
        assert.ok(JSON.stringify(basic).includes('Fixture packer'));
        assert.ok(!JSON.stringify(basic).includes('password'));
    });
    await t.test('defect exchange is discoverable data, preserves progress, restricts all five roles and exporter identity', async () => {
        const before = ok(await api('admin', 'GET', `/api/orders/${snOrder}/work-snapshot`));
        const oldSn = before.instances[0].serial_number;
        for (const role of ['picker', 'packer']) assert.equal((await api(role, 'POST', `/api/orders/${snOrder}/defect`, { oldSn, newSn: 'FEATUREFORBIDDEN', reason: 'denied' })).status, 403);
        // Same dispatcher role, different importer must not manage this order.
        await pool.query("INSERT INTO operation_logs(user_id,order_id,action_type,details) VALUES($1,$2,'import','{}')", [users.admin, order]);
        assert.equal((await api('dispatcher', 'POST', `/api/orders/${order}/defect`, { oldSn: 'FEATURESN001', newSn: 'FEATUREFORBIDDEN', reason: 'not importer' })).status, 403);
        ok(await api('superadmin', 'POST', `/api/orders/${snOrder}/defect`, { oldSn, newSn: 'SN: feature-final', reason: '瑕疵 "測試",\n更換' }));
        const after = ok(await api('admin', 'GET', `/api/orders/${snOrder}/work-snapshot`));
        assert.equal(after.order.status, before.order.status);
        assert.deepEqual(after.items, before.items);
        assert.equal(after.instances.find(i => i.id === before.instances[0].id).status, before.instances[0].status);
        assert.ok(after.instances.some(i => i.serial_number === 'FEATURE-FINAL'));
        const stats = ok(await api('superadmin', 'GET', '/api/admin/defects/stats'));
        const detail = stats.flatMap(s => s.details).find(d => d.new_sn === 'FEATURE-FINAL');
        assert.equal(detail.voucher_number, 'PARITY-SN'); assert.equal(detail.order_id, snOrder);
        assert.equal(detail.reporter, 'Fixture superadmin'); assert.ok(detail.id);
        for (const role of ['picker', 'packer', 'dispatcher']) assert.equal((await api(role, 'GET', '/api/admin/defects/stats')).status, 403);
    });
    await t.test('thread replies, mentions, read receipts, personal pins, retract and delete all retain ownership', async () => {
        const comment = ok(await api('picker', 'POST', `/api/tasks/${order}/comments`, { content: '@fixture_packer check this parcel', priority: 'urgent' }), 201);
        const reply = ok(await api('packer', 'POST', `/api/tasks/${order}/comments`, { content: 'Reply with confirmation', parent_id: comment.id }), 201);
        const list = ok(await api('packer', 'GET', `/api/tasks/${order}/comments?latest=1&limit=50`));
        assert.equal(list.items.find(c => c.id === reply.id).parent_id, comment.id);
        assert.ok(list.items.find(c => c.id === comment.id).mentioned_me);
        assert.ok(JSON.stringify(ok(await api('packer', 'GET', '/api/comments/unread-summary'))).includes('PARITY-FEATURES'));
        assert.ok(JSON.stringify(ok(await api('packer', 'GET', `/api/tasks/${order}/mentions`))).includes(String(comment.id)));
        ok(await api('packer', 'PATCH', `/api/tasks/${order}/mentions/${comment.id}/read`, {}));
        ok(await api('packer', 'POST', `/api/tasks/${order}/comments/${comment.id}/read`, {}));
        ok(await api('admin', 'POST', `/api/tasks/${order}/comments/mark-all-read`, {}));
        assert.equal((await pool.query('SELECT is_read FROM task_mentions WHERE comment_id=$1 AND mentioned_user_id=$2', [comment.id, users.packer])).rows[0].is_read, true);
        ok(await api('packer', 'PUT', `/api/tasks/${order}/pins/${comment.id}`, { pinned: true }));
        assert.ok(ok(await api('packer', 'GET', `/api/tasks/${order}/pins`)).pinned.some(c => c.id === comment.id));
        assert.equal(ok(await api('picker', 'GET', `/api/tasks/${order}/pins`)).pinned.length, 0);
        ok(await api('packer', 'PUT', `/api/tasks/${order}/pins/${comment.id}`, { pinned: false }));
        assert.equal((await api('dispatcher', 'PATCH', `/api/tasks/${order}/comments/${comment.id}/retract`, {})).status, 403);
        ok(await api('superadmin', 'PATCH', `/api/tasks/${order}/comments/${comment.id}/retract`, {}));
        const retracted = (await pool.query('SELECT content FROM task_comments WHERE id=$1', [comment.id])).rows[0];
        assert.ok(!retracted.content.includes('check this parcel'));
        assert.equal((await api('dispatcher', 'DELETE', `/api/tasks/${order}/comments/${reply.id}`)).status, 403);
        ok(await api('superadmin', 'DELETE', `/api/tasks/${order}/comments/${reply.id}`));
        assert.equal((await pool.query('SELECT id FROM task_comments WHERE id=$1', [reply.id])).rowCount, 0);
        ok(await api('picker', 'POST', `/api/tasks/${order}/session`, { session_type: 'viewing' }));
        assert.ok(ok(await api('admin', 'GET', `/api/tasks/${order}/sessions`)).some(s => s.user_id === users.picker));
        for (const name of ['new_mention', 'comment_retracted', 'comment_deleted', 'active_sessions_update', 'task_pin_changed']) assert.ok(observedEvents.some(e => e.event === name), name);
    });
    await t.test('frontline reports all exception categories; dispatcher proposal and supervisor approval/closure persist', async () => {
        for (const type of ['stockout', 'damage', 'over_scan', 'under_scan', 'sn_replace', 'other']) {
            const exception = ok(await api('picker', 'POST', `/api/orders/${order}/exceptions`, { type, reasonText: `Feature ${type}` }), 201);
            ok(await api('admin', 'PATCH', `/api/orders/${order}/exceptions/${exception.id}/propose`, { resolutionAction: 'other', note: 'Supervisor proposed handling' }));
            ok(await api('admin', 'PATCH', `/api/orders/${order}/exceptions/${exception.id}/ack`, { note: 'Checked' }));
            ok(await api('superadmin', 'PATCH', `/api/orders/${order}/exceptions/${exception.id}/resolve`, { resolutionAction: 'other', note: 'Closed after check' }));
            const row = (await pool.query('SELECT status,resolved_by FROM order_exceptions WHERE id=$1', [exception.id])).rows[0];
            assert.equal(row.status, 'resolved'); assert.equal(row.resolved_by, users.superadmin);
        }
        const own = ok(await importOrder('PARITY-PROPOSAL', 1), 201).orderId;
        const exception = ok(await api('packer', 'POST', `/api/orders/${own}/exceptions`, { type: 'damage', reasonText: 'Damaged packaging' }), 201);
        ok(await api('dispatcher', 'PATCH', `/api/orders/${own}/exceptions/${exception.id}/propose`, { resolutionAction: 'restock', note: 'Replace packaging' }));
        assert.equal((await api('picker', 'PATCH', `/api/orders/${own}/exceptions/${exception.id}/propose`, { resolutionAction: 'other', note: 'Forbidden' })).status, 403);
        assert.ok(JSON.stringify(ok(await api('admin', 'GET', '/api/admin/exceptions?status=&q=PARITY-PROPOSAL'))).includes('PARITY-PROPOSAL'));
        assert.ok(JSON.stringify(ok(await api('packer', 'GET', `/api/orders/${own}/exceptions`))).includes('Damaged packaging'));
        ok(await api('admin', 'PATCH', `/api/orders/${own}/exceptions/${exception.id}/reject`, { note: 'Not accepted' }));
    });
    await t.test('team channels, announcement/task assignment, due date, comments and complete status transitions', async () => {
        const channels = ok(await api('picker', 'GET', '/api/team/channels'));
        assert.ok(channels.items.length);
        assert.equal((await api('picker', 'POST', '/api/team/posts', { postType: 'task', title: 'Forbidden', content: 'No' })).status, 403);
        const post = ok(await api('dispatcher', 'POST', '/api/team/posts', { postType: 'task', title: 'Feature warehouse task', content: 'Check delivery packaging', priority: 'urgent', assigneeUserIds: [users.picker], dueAt: '2030-01-01T00:00:00Z' }), 201);
        assert.ok(JSON.stringify(ok(await api('packer', 'GET', '/api/team/posts?q=Feature&type=task'))).includes('Feature warehouse task'));
        assert.ok(JSON.stringify(ok(await api('picker', 'GET', `/api/team/posts/${post.id}`))).includes('Fixture picker'));
        ok(await api('picker', 'POST', `/api/team/posts/${post.id}/comments`, { content: 'Checked and ready' }), 201);
        assert.equal((await api('packer', 'PATCH', `/api/team/posts/${post.id}/status`, { status: 'done' })).status, 403);
        for (const status of ['in_progress', 'done', 'closed', 'open']) {
            ok(await api('picker', 'PATCH', `/api/team/posts/${post.id}/status`, { status }));
            assert.equal((await pool.query('SELECT status FROM team_posts WHERE id=$1', [post.id])).rows[0].status, status);
        }
        assert.ok(observedEvents.some(e => e.event === 'team_post_changed'));
    });
    await t.test('exception and team attachments round-trip with private authenticated downloads', async () => {
        const exception = ok(await api('picker', 'POST', `/api/orders/${order}/exceptions`, { type: 'other', reasonText: 'Evidence attached' }), 201);
        const post = ok(await api('admin', 'POST', '/api/team/posts', { postType: 'announcement', title: 'Feature attachments', content: 'Evidence attached' }), 201);
        const content = '%PDF-1.4\nSynthetic feature evidence\n%%EOF';
        const roots = [`/api/orders/${order}/exceptions/${exception.id}/attachments`, `/api/team/posts/${post.id}/attachments`];
        const files = [];
        t.after(() => { for (const key of files) fs.rmSync(path.resolve(__dirname, '..', key), { force: true }); });
        for (const root of roots) {
            const form = new FormData(); form.set('files', new Blob([content], { type: 'application/pdf' }), 'feature-evidence.pdf');
            const uploaded = ok(await api('picker', 'POST', root, form), 201);
            assert.equal(uploaded.items.length, 1);
            const id = uploaded.items[0].id;
            const table = root.includes('/team/') ? 'team_post_attachments' : 'order_exception_attachments';
            files.push((await pool.query(`SELECT storage_key FROM ${table} WHERE id=$1`, [id])).rows[0].storage_key);
            assert.ok(JSON.stringify(ok(await api('packer', 'GET', root))).includes('feature-evidence.pdf'));
            assert.equal(ok(await api('packer', 'GET', `${root}/${id}/download`)), content);
            assert.equal((await api(null, 'GET', `${root}/${id}/download`)).status, 401);
            assert.equal((await api('packer', 'GET', `${root}/99999999/download`)).status, 404);
        }
    });
    await t.test('member details, legacy create alias, reporting, analytics and batch deletion retain real records', async () => {
        const member = ok(await api('superadmin', 'POST', '/api/admin/create-user', { username: 'feature_alias', password: 'fixture-password-2', name: 'Alias user', role: 'picker' }), 201).user;
        const details = ok(await api('admin', 'GET', `/api/admin/users/${member.id}`));
        assert.ok(JSON.stringify(details).includes('Alias user')); assert.ok(!JSON.stringify(details).includes('password'));
        ok(await api('superadmin', 'DELETE', `/api/admin/users/${member.id}`));
        for (const endpoint of ['/api/operation-logs', '/api/operation-logs/stats', '/api/analytics?range=7days', '/api/scan-errors']) {
            const data = ok(await api('admin', 'GET', endpoint)); assert.ok(data && typeof data === 'object');
            assert.equal((await api('picker', 'GET', endpoint)).status, 403);
        }
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const start = new Date(Date.now() - 7 * 86400000).toISOString(), end = new Date().toISOString();
        const scanErrors = ok(await api('admin', 'GET', `/api/scan-errors?startDate=${start}&endDate=${end}&limit=1000`));
        assert.ok(scanErrors.errors.length > 0, 'The unchanged legacy analysis screen must receive actual scan errors');
        const csv = ok(await api('superadmin', 'GET', `/api/reports/export?startDate=${date}&endDate=${date}`));
        assert.ok(csv.includes('PARITY-SN')); assert.ok(csv.includes('PARITY-BULK'));
        const ids = [];
        for (const voucher of ['PARITY-DELETE-A', 'PARITY-DELETE-B']) ids.push(ok(await importOrder(voucher, 1), 201).orderId);
        assert.equal((await api('dispatcher', 'POST', '/api/orders/batch/delete', { orderIds: ids })).status, 403);
        ok(await api('admin', 'POST', '/api/orders/batch/delete', { orderIds: ids }));
        assert.equal((await pool.query('SELECT id FROM orders WHERE id=ANY($1::int[])', [ids])).rowCount, 0);
    });
};
