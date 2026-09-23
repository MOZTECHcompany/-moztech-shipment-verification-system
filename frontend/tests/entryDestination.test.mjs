import test from 'node:test';
import assert from 'node:assert/strict';
import { safeEntryDestination, loginEntryUrl, taskEntryFilters } from '../src/utils/entryDestination.js';

test('every ERP entry survives the WMS login redirect and reload', () => {
    const paths = ['/tasks', '/tasks?group=pick', '/tasks?group=pack', '/tasks?view=completed', '/admin', '/admin/marketplace-converter', '/warehouse-intakes', '/admin/analytics', '/admin/operation-logs', '/admin/exceptions', '/admin/scan-errors', '/admin/defects', '/settings/logistics', '/team', '/admin/users', '/settings'];
    for (const path of paths) {
        assert.equal(safeEntryDestination(path), path);
        const loginUrl = new URL(loginEntryUrl(path), 'https://wms.invalid');
        assert.equal(loginUrl.pathname, '/login');
        assert.equal(safeEntryDestination(loginUrl.searchParams.get('next')), path);
    }
});
test('order, batch, team and intake detail links retain their identity', () => {
    for (const path of ['/order/123', '/batches/a-b', '/team/34', '/warehouse-intakes/abc_123', '/corely-intakes', '/corely-intakes/123']) assert.equal(safeEntryDestination(path), path);
    for (const path of ['/corely-intakes/0','/corely-intakes/1234567890','/corely-intakes/a']) assert.equal(safeEntryDestination(path), '/tasks');
});
test('external, protocol-relative, encoded, API and login destinations are rejected', () => {
    for (const path of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/%2f%2fevil.example', '/api/users', '/login?next=/admin', '/tasks\n', '/order/a/b', '/unknown']) assert.equal(safeEntryDestination(path), '/tasks');
    assert.equal(safeEntryDestination('/tasks?token=secret&next=https://evil.example'), '/tasks');
});
test('task entry selects existing filters without granting a role or executing work', () => {
    assert.deepEqual(taskEntryFilters('?group=pack'), { view: 'active', group: 'pack' });
    assert.deepEqual(taskEntryFilters('?view=completed'), { view: 'completed', group: 'all' });
    assert.deepEqual(taskEntryFilters('?view=admin&group=superadmin'), { view: 'active', group: 'all' });
});
