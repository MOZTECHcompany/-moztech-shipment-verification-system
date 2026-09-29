const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { authorizeRoles } = require('../middleware/auth');
const fail = message => Object.assign(new Error(message), { status: 400 });

// Read-only ECOUNT reference file. No WMS product records are created or updated.
function createReferenceReader({ env = process.env, storage } = {}) {
 let cached, expires = 0;
 return async () => {
  if (!env.ECOUNT_REFERENCE_OBJECT) return null;
  if (cached && Date.now() < expires) return cached;
  const client = storage || new Storage();
  const [bytes] = await client.bucket(env.GCS_BUCKET).file(env.ECOUNT_REFERENCE_OBJECT).download();
  const value = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(value.products) || !value.products.length || !value.capturedAt || !value.source) throw Error('ECOUNT reference file invalid');
  const seen = new Set();
  for (const p of value.products) {
   if (typeof p.erp_sku !== 'string' || !p.erp_sku || seen.has(p.erp_sku) || typeof p.barcode !== 'string' || typeof p.product_name !== 'string' || typeof p.active !== 'boolean') throw Error('ECOUNT reference product invalid');
   seen.add(p.erp_sku);
  }
  cached = value; expires = Date.now() + 60000; return cached;
 };
}
const readReference = createReferenceReader();
function resolveProducts(skus, products) {
 return Object.fromEntries(skus.map(sku => {
  const matches = products.filter(p => p.erp_sku === sku || (p.barcode && p.barcode === sku));
  return [sku, { status: matches.length === 0 ? 'missing' : matches.length > 1 ? 'ambiguous' : matches[0].active ? 'matched' : 'inactive', matches }];
 }));
}
async function lookupProducts(skus, reader = readReference) {
 const reference = await reader();
 return { sync: reference ? { product_count: reference.products.length, created_at: reference.capturedAt, source_note: reference.source } : null, products: resolveProducts(skus, reference?.products || []) };
}
function createProductRouter({ reader = readReference } = {}) {
 const router = express.Router(); router.use(authorizeRoles('admin', 'dispatcher'));
 router.post('/resolve', async (req, res, next) => {
  try {
   const skus = req.body?.skus;
   if (!Array.isArray(skus) || skus.length > 1000 || skus.some(s => typeof s !== 'string' || !s || s.length > 100 || s !== s.trim())) throw fail('請提供最多 1,000 個完整商品編碼');
   res.set('Cache-Control', 'private, no-store').json(await lookupProducts([...new Set(skus)], reader));
  } catch (e) { if (e.status) return res.status(e.status).json({ message: e.message }); next(e); }
 });
 return router;
}
async function verifyCatalogMappings(_pool, settings, skus = Object.keys(settings.skuMappings), reader = readReference) {
 const {productIdentifierIssue}=await import('./marketplaceIntake.mjs');
 for(const sku of skus){const m=settings.skuMappings?.[sku];for(const value of [sku,m?.erpSku,m?.barcode]){const problem=productIdentifierIssue(value);if(problem)throw fail(problem);}}
 const reference = await reader();
 if (!reference) return;
 const resolved = resolveProducts(skus, reference.products);
 const byCode = new Map(reference.products.map(p => [p.erp_sku, p]));
 for (const [sku, r] of Object.entries(resolved)) {
  const m = settings.skuMappings?.[sku];
  if (r.status === 'inactive') throw fail(`商品 ${sku} 在 ECOUNT 主檔已中止使用，請先確認正確出貨品項`);
  if (r.status === 'ambiguous') throw fail(`商品 ${sku} 的品項編碼與條碼對應多個商品，請先釐清 ECOUNT 主檔`);
  if (r.status === 'matched' && m?.erpSku !== r.matches[0].erp_sku) throw fail(`商品 ${sku} 應對應 ECOUNT ${r.matches[0].erp_sku}，不能改成其他相似編碼`);
  // A manual mapping must still resolve to an active ERP item. A barcode is
  // valid for source lookup, but the exported item-code column needs ERP SKU.
  const target = byCode.get(m?.erpSku);
  if (!target) throw fail(`商品 ${sku} 對應的 ECOUNT 品項編碼 ${m?.erpSku || '（未填）'} 不在目前主檔，請核對品號或更新主檔對照資料`);
  if (!target.active) throw fail(`商品 ${sku} 對應的 ECOUNT 品項 ${target.erp_sku} 已中止使用，請先確認正確出貨品項`);
 }
}
module.exports = { createReferenceReader, resolveProducts, lookupProducts, createProductRouter, verifyCatalogMappings };
