const { createHash } = require('node:crypto');
const { verifiedFulfilledOrderNumbers } = require('./shopifyFulfillmentStatus');

const clean = value => String(value ?? '').trim();
const orderIdPattern = /^\d{1,25}$/;
const lineIdPattern = /^gid:\/\/shopify\/LineItem\/\d+$/;
const variantIdPattern = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function readUpload(rows, verification) {
 if (!Array.isArray(rows) || rows.length < 2 || !rows.every(Array.isArray)) return null;
 const header = rows[0];
 const numberColumn = header.indexOf('Name');
 const idColumn = header.indexOf('Id');
 if (numberColumn < 0 || idColumn < 0) return null;

 const orders = new Map();
 const ids = new Set();
 for (const order of verification.orders) {
  if (!order?.number || orders.has(order.number) || !orderIdPattern.test(order.id) || ids.has(String(order.id))) return null;
  orders.set(order.number, order);
  ids.add(String(order.id));
 }

 const seenIds = new Set();
 const sourceRows = [];
 let number = '';
 for (const row of rows.slice(1)) {
  if (!row.some(value => clean(value))) continue;
  number = clean(row[numberColumn]) || number;
  const order = orders.get(number);
  const id = clean(row[idColumn]);
  if (!order || (id && id !== String(order.id))) return null;
  if (id) seenIds.add(id);
  sourceRows.push({ number, row });
 }
 if (!sourceRows.length || seenIds.size !== orders.size) return null;
 return { header, orders, sourceRows, numbers: [...new Set(sourceRows.map(({ number }) => number))] };
}

function readyReimport(reimport) {
 return ['pending', 'excluded'].includes(reimport.state) &&
  Number.isSafeInteger(reimport.intakeId) && reimport.intakeId > 0 && reimport.workOrderId == null;
}

function exactHistoricalTarget(conversion, conflict) {
 // A historical line can block a shared SKU in the full preview even though
 // another order uses the live variant and its exact active catalog barcode.
 if (!['SOURCE_BARCODE_MISSING', 'SOURCE_VARIANT_MISSING'].includes(conflict.reviewReason) ||
     conflict.targetOptions?.length !== 1) return null;
 const target = conflict.targetOptions[0];
 const match = conversion.catalog?.products?.[conflict.sourceSku];
 const product = match?.matches?.[0];
 if (match?.status !== 'matched' || match.matches.length !== 1 || product.active !== true ||
     !product.barcode || product.erp_sku !== target.erpSku || product.barcode !== target.erpBarcode ||
     conflict.selectedErpSku !== target.erpSku) return null;
 return product;
}

function independentlyVerifiedLine(item, order, relatedOrders, target) {
 if (!target || !lineIdPattern.test(item.sourceLineId) || !Array.isArray(order?.items)) return false;
 const evidence = relatedOrders.filter(line => line.orderNumber === item.sourceOrderNumber && line.sourceLineId === item.sourceLineId);
 const live = order.items.filter(line => line.id === item.sourceLineId);
 if (evidence.length !== 1 || live.length !== 1) return false;
 const [line] = evidence;
 const [current] = live;
 if (String(line.orderId) !== String(order.id) || line.sourceVerified !== true ||
     current.sku !== item.sku || current.quantity !== item.quantity || line.quantity !== item.quantity) return false;
 if (line.historicalLineConfirmed === true && line.barcodeMissing === true && !current.barcode && !current.variantId) return true;
 return line.barcodeMissing === false && variantIdPattern.test(current.variantId) && line.variantId === current.variantId &&
  current.barcode === target.barcode && line.barcode === target.barcode;
}

async function analyzeReadyScope(conversion) {
 const { source, verification, raw, parsed, choices, reimports, barcodeConflicts = [], profileId } = conversion;
 if (source?.platform !== 'Shopify' || verification?.platform !== 'Shopify' || verification.version !== 'shopify-current-v2' ||
     verification.mode !== 'api' || !verification.shop || !/^[a-f0-9]{64}$/.test(verification.currentFingerprint || '') ||
     !profileId || !Array.isArray(verification.orders) || !Array.isArray(raw?.orders) || !Array.isArray(raw.items) ||
     !Array.isArray(parsed?.orders) || !Array.isArray(choices) || !Array.isArray(reimports)) return null;
 const upload = readUpload(source.rows, verification);
 if (!upload) return null;
 const rawOrders = new Map(raw.orders.map(order => [order.sourceOrderNumber, order]));
 const ownerByNumber = new Map(reimports.map(reimport => [reimport.orderNumber, reimport]));
 if (rawOrders.size !== raw.orders.length || rawOrders.size !== upload.orders.size ||
     upload.numbers.some(number => !rawOrders.has(number)) || ownerByNumber.size !== reimports.length ||
     reimports.some(reimport => !rawOrders.has(reimport.orderNumber))) return null;

 const excludedFulfilled = verifiedFulfilledOrderNumbers(verification);
 const fulfilled = new Set(excludedFulfilled);
 const preparedNew = new Set(parsed.orders.map(order => order.sourceOrderNumber));
 const newChoices = new Map(choices.filter(choice => choice.existing !== true).map(choice => [choice.number, choice]));
 const itemsByNumber = Map.groupBy(raw.items, item => item.sourceOrderNumber);
 const itemsBySku = Map.groupBy(raw.items, item => item.sku);
 const held = new Map();
 const hold = (number, reason) => {
  if (fulfilled.has(number)) return;
  if (!held.has(number)) held.set(number, new Set());
  held.get(number).add(reason);
 };

 // Existing drafts are intentionally left out of ordinary preview's parsed
 // sales. Reuse the same order/payment/allocation rules for their eligibility.
 const reviewableReimports = reimports.filter(value => !fulfilled.has(value.orderNumber) && readyReimport(value));
 let reimportPreparation;
 if (reviewableReimports.length) {
  const numbers = new Set(reviewableReimports.map(value => value.orderNumber));
  const { prepareUnifiedMarketplace } = await import('./unifiedMarketplace.mjs');
  reimportPreparation = prepareUnifiedMarketplace({
   ...raw,
   orders: raw.orders.filter(order => numbers.has(order.sourceOrderNumber)),
   items: raw.items.filter(item => numbers.has(item.sourceOrderNumber)),
   issues: (raw.issues || []).filter(issue => !issue.orderNumber || numbers.has(issue.orderNumber)),
  }, conversion.settings);
 }
 const reimportChoices = new Map((reimportPreparation?.choices || []).map(choice => [choice.number, choice]));
 const preparedReimports = new Set((reimportPreparation?.parsed.orders || []).map(order => order.sourceOrderNumber));
 for (const number of upload.numbers) {
  if (fulfilled.has(number)) continue;
  const order = upload.orders.get(number);
  const reimport = ownerByNumber.get(number);
  const choice = reimport ? reimportChoices.get(number) : newChoices.get(number);
  const prepared = reimport ? preparedReimports : preparedNew;
  if (reimport && !readyReimport(reimport)) {
   hold(number, reimport.message || '原訂單仍需核對');
  } else if (reimport && order.items?.some(line => !line.variantId && !line.barcode)) {
   hold(number, '原訂單有缺少商城規格的品項，請開啟原批次核對');
  } else if (order.cancelled !== false || order.cancelledAt || order.fulfillmentStatus !== 'unfulfilled' ||
      !choice?.eligible || !prepared.has(number) || !itemsByNumber.get(number)?.length) {
   hold(number, choice?.eligible === false && choice.reason ? choice.reason : '目前訂單尚未符合轉檔條件');
  }
 }
 for (const review of conversion.orderReviews || []) {
  if (review.canConfirm === false && rawOrders.has(review.orderNumber)) {
   for (const reason of review.blockedReasons?.length ? review.blockedReasons : ['商城訂單仍需核對']) hold(review.orderNumber, reason);
  }
 }

 const conflictSkus = new Set();
 for (const conflict of barcodeConflicts) {
  const items = itemsBySku.get(conflict.sourceSku);
  if (!items?.length || conflictSkus.has(conflict.sourceSku)) return null;
  conflictSkus.add(conflict.sourceSku);
  const target = exactHistoricalTarget(conversion, conflict);
  for (const item of items) {
   if (!independentlyVerifiedLine(item, upload.orders.get(item.sourceOrderNumber), conflict.relatedOrders || [], target)) {
    hold(item.sourceOrderNumber, `商品 ${conflict.sourceSku} 的商城與 ECOUNT 對照待核對`);
   }
  }
 }

 // Global errors cannot be resolved by selecting orders. Per-SKU errors are
 // scoped to whole orders, with only the historical barcode case above able
 // to establish that an individual order using the same SKU is unaffected.
 for (const issue of [...(conversion.output?.issues || []), ...(conversion.prepick?.issues || []), ...(reimportPreparation?.output?.issues || [])]) {
  if (issue.severity !== 'error') continue;
  if (issue.code === 'EMPTY_INTAKE') continue;
  if (issue.orderNumber && rawOrders.has(issue.orderNumber)) {
   hold(issue.orderNumber, issue.message);
  } else if (issue.sku && itemsBySku.has(issue.sku)) {
   if (conflictSkus.has(issue.sku) && ['BARCODE_MISMATCH', 'BARCODE_MAPPING_REQUIRED'].includes(issue.code)) continue;
   for (const item of itemsBySku.get(issue.sku)) hold(item.sourceOrderNumber, issue.message);
  } else return null;
 }

 const candidateNumbers = upload.numbers.filter(number => !held.has(number) && !fulfilled.has(number));
 const heldOrders = upload.numbers.filter(number => held.has(number)).map(orderNumber => ({ orderNumber, reasons: [...held.get(orderNumber)].sort() }));
 if (!candidateNumbers.length || !heldOrders.length) return null;
 const plan = { candidateNumbers, heldOrders, excludedFulfilled };
 const fingerprint = digest(['marketplace-ready-scope-v1', source.rows, profileId, verification.shop,
  verification.currentFingerprint, conversion.sourceClassification?.fingerprint, plan]);
 return { upload, readyScope: { fingerprint, ...plan } };
}

async function buildMarketplaceReadyScope(conversion) {
 return (await analyzeReadyScope(conversion))?.readyScope || null;
}

async function projectMarketplaceReadyRows(conversion, fingerprint) {
 const result = await analyzeReadyScope(conversion);
 if (!result || result.readyScope.fingerprint !== fingerprint) {
  throw Object.assign(new Error('可轉檔的訂單範圍已變更，請重新核對整份檔案'), {
   status: 409, code: 'MARKETPLACE_READY_SCOPE_CHANGED',
  });
 }
 const { readyScope, upload } = result;
 const candidates = new Set(readyScope.candidateNumbers);
 const rows = [upload.header.slice(), ...upload.sourceRows.filter(({ number }) => candidates.has(number)).map(({ row }) => row.slice())];
 return { rows, readyScope };
}

module.exports = { buildMarketplaceReadyScope, projectMarketplaceReadyRows };
