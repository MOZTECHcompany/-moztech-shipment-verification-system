import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedCommentsKey, normalizePinnedComments } from '../src/api/pinnedComments.js';
test('personal pins never share cache across accounts, roles or orders', () => {
  const key = pinnedCommentsKey(10, { id: 1, role: 'picker' });
  for (const other of [pinnedCommentsKey(10, { id: 2, role: 'picker' }), pinnedCommentsKey(10, { id: 1, role: 'admin' }), pinnedCommentsKey(11, { id: 1, role: 'picker' })]) assert.notDeepEqual(key, other);
});
test('pin snapshots remove duplicate and retracted comments', () => {
  assert.deepEqual(normalizePinnedComments([null, { id: 1, content: 'old' }, { id: '1', content: 'current' }, { id: 2, content: 'removed', is_retracted: true }]), [{ id: '1', content: 'current' }]);
});
