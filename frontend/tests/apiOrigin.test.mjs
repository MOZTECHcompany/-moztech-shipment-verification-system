import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiOrigin } from '../config/apiOrigin.mjs';
test('default stays same-origin and local development permits loopback', () => {
  assert.equal(resolveApiOrigin('', true), '');
  assert.equal(resolveApiOrigin('http://127.0.0.1:3001/', true), 'http://127.0.0.1:3001');
});
test('development rejects production and malformed endpoints', () => {
  for (const origin of ['https://moztech-wms-api.onrender.com', 'https://candidate.example', 'http://localhost:3001/api', 'http://a:b@localhost:3001']) {
    assert.throws(() => resolveApiOrigin(origin, true));
  }
});
test('production supports a separate candidate origin', () => {
  assert.equal(resolveApiOrigin('https://candidate.example/', false), 'https://candidate.example');
});
