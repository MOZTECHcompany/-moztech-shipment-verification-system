const { Storage } = require('@google-cloud/storage');

const fault = (status, code, message) => Object.assign(new Error(message), { status, code });
const unavailable = () => fault(503, 'CATALOG_UNAVAILABLE', '暫時無法讀取商品主檔，請重新核對');

function registrationEnabled(env = process.env) {
 const path = env.ECOUNT_REFERENCE_SUPPLEMENT_OBJECT;
 return env.K_SERVICE === 'corely-wms-dev' && env.GCS_BUCKET === 'moztech-main-db-corely-wms-dev' &&
  Boolean(env.ECOUNT_REFERENCE_OBJECT) && typeof path === 'string' &&
  /^reference\/supplements\/[\w.-]+\.json$/.test(path) && path !== env.ECOUNT_REFERENCE_OBJECT;
}

function validGtin(code) {
 if (typeof code !== 'string' || !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code) || /^0+$/.test(code)) return false;
 let sum = 0;
 for (let index = code.length - 1; index >= 0; index--) {
  sum += Number(code[index]) * ((code.length - 1 - index) % 2 === 0 ? 1 : 3);
 }
 return sum % 10 === 0;
}

const validText = (value, max) => typeof value === 'string' && value.length > 0 &&
 value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const validSku = value => validText(value, 100) && !Object.hasOwn(Object.prototype, value) &&
 !/^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(value);

function validateBase(value) {
 if (!Array.isArray(value?.products) || !value.products.length || !value.capturedAt || !value.source) throw Error('ECOUNT reference file invalid');
 const seen = new Set();
 for (const p of value.products) {
  if (!p || typeof p.erp_sku !== 'string' || !p.erp_sku || seen.has(p.erp_sku) ||
   typeof p.barcode !== 'string' || typeof p.product_name !== 'string' || typeof p.active !== 'boolean') throw Error('ECOUNT reference product invalid');
  seen.add(p.erp_sku);
 }
 return value;
}

function validateSupplement(value) {
 if (value?.schemaVersion !== 1 || !Array.isArray(value.products) || value.products.some(p =>
  !p || !validSku(p.erp_sku) || !validGtin(p.barcode) || !validText(p.product_name, 255) ||
  p.spec !== '' || p.active !== true || !validText(p.registeredBy, 200) ||
  typeof p.registeredAt !== 'string' || !Number.isFinite(Date.parse(p.registeredAt)))) throw unavailable();
 return value;
}

// Keep exact identifiers for matching. Only duplicate/conflict checks use a
// second, namespaced key for the same GTIN printed in a different width.
function identityKeys(p) {
 const keys = [...new Set([p.erp_sku, p.barcode].filter(Boolean))].map(value => 'exact:' + value);
 if (validGtin(p.barcode)) keys.push('gtin:' + p.barcode.padStart(14, '0'));
 return keys;
}
const sameProduct = (a, b) => a.erp_sku === b.erp_sku && a.barcode === b.barcode &&
 a.product_name === b.product_name && a.active === b.active;
const publicProduct = ({erp_sku, product_name, barcode, spec, active}) => ({erp_sku, product_name, barcode, spec, active});

// A later official snapshot can absorb exact matches. Quarantine both sides
// of a contradictory registration so old saved mappings cannot silently rebind.
function mergedProducts(base, supplement) {
 if (!supplement.length) return base;
 const indexed = new Map();
 const conflicts = new Set();
 const extras = [];
 function index(product) {
  for (const key of identityKeys(product)) {
   if (!indexed.has(key)) indexed.set(key, []);
   indexed.get(key).push(product);
  }
 }
 for (const product of base) index(product);
 for (const entry of supplement) {
  const product = publicProduct(entry);
  const related = new Set(identityKeys(product).flatMap(key => indexed.get(key) || []));
  if (related.size === 1 && sameProduct([...related][0], product)) continue;
  if (related.size) {
   for (const item of related) conflicts.add(item);
   conflicts.add(product);
  }
  extras.push(product);
  index(product);
 }
 return [...base, ...extras].map(p => conflicts.has(p) ? {...p, active:false, referenceConflict:true} : p);
}

function createSupplementCatalog({env = process.env, storage} = {}) {
 const cached = new Map();
 let client = storage;
 function bucket() {
  client ||= new Storage();
  return client.bucket(env.GCS_BUCKET);
 }

 async function snapshot(name, optional) {
  const source = bucket();
  for (let attempt = 0; attempt < 3; attempt++) {
   let metadata;
   try { [metadata] = await source.file(name).getMetadata(); } catch (e) {
    if (optional && Number(e.code) === 404) return {generation:0, value:{schemaVersion:1, products:[]}};
    throw unavailable();
   }
   const generation = Number(metadata.generation);
   if (!Number.isSafeInteger(generation) || generation <= 0) throw unavailable();
   const prior = cached.get(name);
   if (prior?.generation === generation) return prior;
   let bytes;
   try { [bytes] = await source.file(name, {generation}).download(); } catch (e) {
    if (Number(e.code) === 404) continue; // version replaced after metadata read
    throw unavailable();
   }
   let value;
   try {
    const json = JSON.parse(bytes.toString('utf8'));
    value = optional ? validateSupplement(json) : validateBase(json);
   } catch { throw unavailable(); }
   const current = {generation, value};
   cached.set(name, current);
   return current;
  }
  throw unavailable();
 }

 async function documents() {
  return Promise.all([snapshot(env.ECOUNT_REFERENCE_OBJECT, false), snapshot(env.ECOUNT_REFERENCE_SUPPLEMENT_OBJECT, true)]);
 }

 async function read() {
  const [base, supplement] = await documents();
  const additions = supplement.value.products;
  const latest = additions.reduce((value, entry) => Math.max(value, Date.parse(entry.registeredAt)), 0);
  return {...base.value, products:mergedProducts(base.value.products, additions),
   baseProductCount:base.value.products.length, ...(latest ? {supplementUpdatedAt:new Date(latest).toISOString()} : {})};
 }

 async function register(input, actor) {
  if (!registrationEnabled(env)) throw fault(403, 'CATALOG_REGISTRATION_DISABLED', '此環境未開放新品建檔');
  if (input?.confirmed !== true || !validSku(input.erpSku) || !validGtin(input.barcode) ||
   !validText(input.productName, 255)) throw fault(400, 'CATALOG_PRODUCT_INVALID', '請確認 ECOUNT 品號、商品名稱及有效的實物國際條碼');
  if (!Number.isSafeInteger(Number(actor)) || Number(actor) <= 0) throw fault(403, 'CATALOG_ACTOR_REQUIRED', '無法確認建檔人員');
  const product = {erp_sku:input.erpSku, barcode:input.barcode, product_name:input.productName, spec:'', active:true};
  const keys = new Set(identityKeys(product));
  for (let attempt = 0; attempt < 4; attempt++) {
   const [base, overlay] = await documents();
   const matches = [...base.value.products, ...overlay.value.products].filter(p => identityKeys(p).some(key => keys.has(key)));
   if (matches.some(p => !sameProduct(p, product))) throw fault(409, 'CATALOG_PRODUCT_CONFLICT', '品號、條碼或品名與現有商品有衝突，請核對主檔');
   if (matches.length) return {created:false, product:publicProduct(matches[0])};
   const entry = {...product, registeredBy:String(actor), registeredAt:new Date().toISOString()};
   const payload = {...overlay.value, products:[...overlay.value.products, entry]};
   try {
    await bucket().file(env.ECOUNT_REFERENCE_SUPPLEMENT_OBJECT).save(JSON.stringify(payload), {
     resumable:false, contentType:'application/json', preconditionOpts:{ifGenerationMatch:overlay.generation},
    });
    return {created:true, product};
   } catch (e) {
    if (Number(e.code) !== 412) throw unavailable();
   }
  }
  throw fault(409, 'CATALOG_RETRY', '商品資料已更新，請重新核對後再試');
 }
 return {read, register};
}

module.exports = {registrationEnabled, validGtin, validateBase, createSupplementCatalog};
