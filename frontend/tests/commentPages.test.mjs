import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCommentPage, commentQueryKey, flattenCommentPages, buildCommentThreads } from '../src/api/commentPages.js';

const makeClient = responses => ({ calls: [], async get(url, options) { this.calls.push({ url, options }); return responses.shift(); } });
const fixture = { items: [{ id: 51, content: 'latest' }], previousCursor: 'v1:older', total: 51 };
const options = { orderId: 7, pageSize: 50, pageParam: null };

test('fresh query fetches the newest page without a body-less persisted validator', async () => {
    const client = makeClient([{ status: 200, data: fixture, headers: { etag: 'tag' } }]);
    const result = await fetchCommentPage({ ...options, client });
    assert.match(client.calls[0].url, /latest=1/);
    assert.deepEqual(client.calls[0].options.headers, {});
    assert.equal(result.items[0].id, 51);
    assert.equal(result.__etag, 'tag');
});

test('304 reuses the exact cached response body and retains the history cursor', async () => {
    const cached = { ...fixture, __etag: 'tag', __requestKey: 'limit=50&latest=1' };
    const client = makeClient([{ status: 304 }]);
    const result = await fetchCommentPage({ ...options, client, cached });
    assert.equal(client.calls[0].options.headers['If-None-Match'], 'tag');
    assert.equal(result, cached);
    assert.equal(result.previousCursor, 'v1:older');
});

test('unexpected 304 after cache loss fetches a body instead of fabricating empty comments', async () => {
    const client = makeClient([{ status: 304 }, { status: 200, data: fixture, headers: {} }]);
    const result = await fetchCommentPage({ ...options, client });
    assert.equal(client.calls.length, 2);
    assert.deepEqual(client.calls[0].options.headers, {});
    assert.equal(result.items[0].id, 51);
});

test('a second body-less 304 is an actionable query error', async () => {
    const client = makeClient([{ status: 304 }, { status: 304 }]);
    await assert.rejects(fetchCommentPage({ ...options, client }), /重新載入/);
});

test('history uses before and cannot send a validator from a different page or page size', async () => {
    const cached = { ...fixture, __etag: 'head-only', __requestKey: 'limit=50&latest=1' };
    const client = makeClient([{ status: 200, data: fixture, headers: {} }]);
    await fetchCommentPage({ ...options, pageParam: 'v1:older', client, cached });
    assert.match(client.calls[0].url, /before=v1%3Aolder/);
    assert.deepEqual(client.calls[0].options.headers, {});
    assert.notDeepEqual(commentQueryKey(7, 20, { id: 1 }), commentQueryKey(7, 50, { id: 1 }));
    assert.notDeepEqual(commentQueryKey(7, 50, { id: 1 }), commentQueryKey(7, 50, { id: 2 }));
    assert.deepEqual(commentQueryKey(7, 50, { id: 1 }), commentQueryKey('7', 50, { id: 1 }));
});

test('newest plus older pages remain chronological, retain microseconds and deduplicate refreshed overlap', () => {
    const row = (id, text, exact = '2026-09-09 12:00:00.123456') => ({ id, content: text, created_at: '2026-09-09T12:00:00.123Z', cursor_created_at: exact });
    const items = flattenCommentPages({ pages: [
        { items: [row(3, 'fresh'), row(2, 'microsecond later', '2026-09-09 12:00:00.123457')] },
        { items: [row(1, 'oldest'), row(3, 'stale')] }
    ] });
    assert.deepEqual(items.map(c => c.id), [1,3,2]);
    assert.equal(items[1].content, 'fresh');
});

test('replies remain reachable when their parent is outside the loaded page or the current filter', () => {
    const rows = [{ id: 4, parent_id: 1 }, { id: 5, parent_id: 4 }];
    assert.deepEqual(buildCommentThreads(rows), [{ id: 4, parent_id: 1, replies: [{ id: 5, parent_id: 4 }] }]);
    const loadedParent = buildCommentThreads([{ id: 1, parent_id: null }, ...rows]);
    assert.deepEqual(loadedParent[0].replies.map(c => c.id), [4,5]);
});
