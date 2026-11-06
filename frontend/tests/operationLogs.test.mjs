import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordOnlyLogFilters, logFilterError, logFilterParams, logTime, operationLogsCSV, readLogFilters, smartLogSearchFilters, taipeiDay } from '../src/utils/operationLogs.js';

test('previous operation-log links keep order, date, and page size when a new search is submitted', () => {
    const filters = readLogFilters(new URLSearchParams('orderId=2026%2F10%2F19&startDate=2026-10-20&limit=100'));
    const query = logFilterParams({ ...filters, q: '  陳小姐 裝箱  ' });
    assert.equal(query.get('orderId'), '2026/10/19');
    assert.equal(query.get('startDate'), '2026-10-20');
    assert.equal(query.get('limit'), '100');
    assert.equal(query.get('q'), '陳小姐 裝箱');
    assert.equal(logFilterParams(readLogFilters(new URLSearchParams())).toString(), '');
});

test('an inverted date range or too many words is blocked before requesting the log API', () => {
    assert.match(logFilterError({ q: '', startDate: '2026-11-07', endDate: '2026-11-06' }), /開始日期/);
    assert.match(logFilterError({ q: '1 2 3 4 5 6 7 8 9' }), /最多 8/);
});

test('searching a new shipment replaces the stale order but preserves a deliberate operation date', () => {
    const old = readLogFilters(new URLSearchParams('orderId=2026%2F10%2F19&startDate=2026-10-20&limit=100'));
    const draft = { ...old, q: '20261022 出貨' };
    const request = logFilterParams(smartLogSearchFilters(draft));
    assert.equal(request.get('q'), '20261022 出貨');
    assert.equal(request.has('orderId'), false);
    assert.equal(request.get('startDate'), '2026-10-20');
    assert.equal(logFilterParams(draft).get('orderId'), '2026/10/19', 'advanced apply still supports an explicit order');
    const retry = logFilterParams(keywordOnlyLogFilters(draft));
    assert.equal(retry.get('q'), '20261022 出貨');
    assert.equal(retry.has('startDate'), false);
    assert.equal(retry.get('limit'), '100');
});

test('Taipei day and audit time follow the same midnight boundary across host timezones', () => {
    const midnight = new Date('2026-11-05T16:00:00.000Z');
    assert.equal(taipeiDay(0, midnight), '2026-11-06');
    assert.equal(taipeiDay(-1, midnight), '2026-11-05');
    assert.deepEqual(logTime('2026-11-05T15:59:59.999999Z'), { day: '2026/11/05', time: '23:59:59' });
    assert.deepEqual(logTime(midnight), { day: '2026/11/06', time: '00:00:00' });
});

test('export preserves history and literal text without evaluating spreadsheet formulas', () => {
    const result = operationLogsCSV([{
        created_at: '2026-11-05T16:00:00Z', voucher_number: '2026/11/06 -19', customer_name: ' =SUM(1,2)',
        user_name: '@current', actor_snapshot: { name: '原人員', role: 'admin', management_scope: 'warehouse' },
        action_type: 'scan_error', work_type: 'pack', details: '"one",two',
    }]);
    assert.ok(result.includes('"2026/11/06 00:00:00","2026/11/06 -19","\' =SUM(1,2)"'));
    assert.ok(result.includes('"原人員","倉儲管理員","裝箱","""one"",two"'));
    assert.ok(!result.includes('@current'));
});
