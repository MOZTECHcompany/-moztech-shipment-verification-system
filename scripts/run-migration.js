#!/usr/bin/env node
/**
 * Trigger admin migration: /api/admin/migrate/add-priority
 * Usage:
 *   WMS_TOKEN=<JWT> node scripts/run-migration.js
 *   node scripts/run-migration.js --token <JWT>
 */
const https = require('https');

const BASE = process.env.API_BASE || 'https://moztech-wms-api.onrender.com';
const argTokenIndex = process.argv.indexOf('--token');
const TOKEN = process.env.WMS_TOKEN || (argTokenIndex > -1 ? process.argv[argTokenIndex + 1] : null);

if (!TOKEN) {
  console.error('Missing token. Provide via env WMS_TOKEN or --token <JWT>.');
  process.exitCode = 1;
}

function request(method, path, body) {
  const url = new URL(path, BASE);
  const payload = body ? JSON.stringify(body) : undefined;
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        let parsed = data;
        if (ct.includes('application/json')) {
          try { parsed = JSON.parse(data || '{}'); } catch (e) {}
        }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  try {
    console.log(`POST ${BASE}/api/admin/migrate/add-priority`);
    const res = await request('POST', '/api/admin/migrate/add-priority');
    console.log('Status:', res.status);
    console.log('Response:', typeof res.data === 'string' ? res.data.slice(0, 300) : res.data);
    if (res.status >= 400) process.exitCode = 1;
  } catch (e) {
    console.error('Migration request failed:', e.message);
    process.exitCode = 1;
  }
})();
