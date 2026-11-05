// Pure reconciliation engine. No HTTP, cookies, credentials, browser globals or implicit sales creation.
export class AssistantError extends Error {
  constructor(code) { super(code); this.name = 'AssistantError'; this.code = code; }
}
const fail = code => { throw new AssistantError(code); };
export const ROW_BUSINESS_KEYS = Object.freeze(['rowId', 'itemCode', 'sourceLineId', 'quantity', 'unitPrice', 'netAmount', 'taxAmount', 'grossAmount', 'warehouseCode', 'actualSN']);
export const DOCUMENT_BUSINESS_KEYS = Object.freeze(['schemaVersion', 'companyCode', 'voucherNumber', 'customerCode', 'warehouseCode', 'currencyCode', 'approvalStatus', 'linkedDocuments', 'totals', 'otherBusinessFields']);
const string = value => typeof value === 'string' && value.length <= 16000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const orderedObject = value => Array.isArray(value) ? value.map(orderedObject) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, orderedObject(value[key])])) : value;
const canonical = value => JSON.stringify(orderedObject(value));
export async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
export function assertSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !string(snapshot.companyCode) || !snapshot.companyCode || !string(snapshot.voucherNumber) || !/^\d{4}\/\d{2}\/\d{2}-\d+$/.test(snapshot.voucherNumber) || !Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length > 1000) fail('INVALID_DOCUMENT');
  const keys = [...DOCUMENT_BUSINESS_KEYS, 'versionToken','capturedAt','rows'];
  if (Object.keys(snapshot).some(key => !keys.includes(key)) || keys.some(key => !(key in snapshot))) fail('INCOMPLETE_BUSINESS_SNAPSHOT');
  if (['versionToken','capturedAt','customerCode','approvalStatus'].some(key => !string(snapshot[key]) || !snapshot[key]) || ['warehouseCode','currencyCode'].some(key => !string(snapshot[key])) || !Number.isFinite(Date.parse(snapshot.capturedAt)) || !Array.isArray(snapshot.linkedDocuments) || snapshot.linkedDocuments.some(value => !string(value)) || !snapshot.otherBusinessFields || Array.isArray(snapshot.otherBusinessFields)) fail('INCOMPLETE_BUSINESS_SNAPSHOT');
  const decimal = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && value.length <= 64;
  if (!snapshot.totals || Object.keys(snapshot.totals).sort().join(',') !== 'grossAmount,netAmount,taxAmount' || Object.values(snapshot.totals).some(value => !decimal(value))) fail('INCOMPLETE_BUSINESS_SNAPSHOT');
  const rowIds = new Set();
  const serials = new Set();
  for (const row of snapshot.rows) {
    if (Object.keys(row).some(key => ![...ROW_BUSINESS_KEYS,'metadata'].includes(key)) || [...ROW_BUSINESS_KEYS,'metadata'].some(key => !(key in row))) fail('INCOMPLETE_BUSINESS_SNAPSHOT');
    if (ROW_BUSINESS_KEYS.some(key => key === 'actualSN' ? !Array.isArray(row.actualSN) || row.actualSN.some(value => !string(value) || !value) : key === 'sourceLineId' ? row[key] !== null && !string(row[key]) : !string(row[key])) || !row.rowId || !row.itemCode || !string(row.metadata) || !/^\d+$/.test(row.quantity) || !Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) < 1 || ['unitPrice','netAmount','taxAmount','grossAmount'].some(key => !decimal(row[key])) || row.actualSN.length && row.actualSN.length !== Number(row.quantity)) fail('INCOMPLETE_BUSINESS_SNAPSHOT');
    if (rowIds.has(row.rowId)) fail('AMBIGUOUS_ROW');
    rowIds.add(row.rowId);
    for (const sn of row.actualSN) { if (serials.has(sn)) fail('DUPLICATE_SN'); serials.add(sn); }
  }
  return snapshot;
}
export function businessSnapshot(snapshot) {
  assertSnapshot(snapshot);
  return {
    ...Object.fromEntries(DOCUMENT_BUSINESS_KEYS.map(key => [key, snapshot[key]])),
    rows: snapshot.rows.map(row => Object.fromEntries(ROW_BUSINESS_KEYS.map(key => [key, row[key]])))
  };
}
export function assertSameBusiness(before, after) {
  if (canonical(businessSnapshot(before)) !== canonical(businessSnapshot(after))) fail('BUSINESS_FIELDS_CHANGED');
}
export function mergeMetadata(original, content, jobId) {
  if (!string(original) || !string(content) || !/^[a-zA-Z0-9-]{1,80}$/.test(jobId) || /\[\/?CORELY-WMS:/.test(content)) fail('INVALID_METADATA');
  const open = `[CORELY-WMS:${jobId}]`; const close = `[/CORELY-WMS:${jobId}]`;
  const start = original.indexOf(open), end = original.indexOf(close);
  const marker = `${open}\n${content}\n${close}`;
  if (start < 0 && end < 0) return original ? `${original}\n${marker}` : marker;
  if (start < 0 || end < start || original.indexOf(open, start + open.length) >= 0 || original.indexOf(close, end + close.length) >= 0) fail('MALFORMED_WMS_MARKER');
  return original.slice(0, start) + marker + original.slice(end + close.length);
}

export async function buildPreview({ jobId, plan, before, capabilities }) {
  assertSnapshot(before);
  if (!plan || plan.companyCode !== before.companyCode || plan.voucherNumber !== before.voucherNumber) fail('WRONG_DOCUMENT');
  if (plan.businessFingerprint !== await fingerprint(businessSnapshot(before))) fail('BUSINESS_CONFLICT');
  if (!Array.isArray(plan.rows) || !plan.rows.length || new Set(plan.rows.map(row => row.rowId)).size !== plan.rows.length) fail('AMBIGUOUS_ROW');
  for (const row of before.rows) {
    const peers=before.rows.filter(other => other.itemCode===row.itemCode);
    if (peers.length>1 && (!row.sourceLineId || peers.filter(other=>other.sourceLineId===row.sourceLineId).length!==1)) fail('AMBIGUOUS_ROW');
  }
  if (capabilities?.temporaryDraft) fail('TEMPORARY_DRAFT');
  if (capabilities?.loggedIn !== true || capabilities?.existingVoucher !== true || capabilities?.identityLocked !== true) fail('UNVERIFIED_ORIGINAL_DOCUMENT');
  const rows = [];
  for (const planned of plan.rows) {
    const actual = before.rows.find(row => row.rowId === planned.rowId);
    if (!actual || actual.itemCode !== planned.itemCode || actual.quantity !== String(planned.expectedQuantity)) fail('ROW_MISMATCH');
    if (!string(planned.metadata)) fail('INVALID_METADATA');
    const metadata = planned.metadata;
    const maximum = capabilities.metadataMaxLength;
    if (Number.isInteger(maximum) && maximum > 0 && metadata.length > maximum) fail('METADATA_TOO_LONG');
    rows.push({ rowId: actual.rowId, itemCode: actual.itemCode, expectedQuantity: actual.quantity, previousMetadata: actual.metadata, metadata });
  }
  if (plan.expectedVersionToken !== before.versionToken) fail('VERSION_CONFLICT');
  return { jobId, companyCode: before.companyCode, voucherNumber: before.voucherNumber, beforeFingerprint: await fingerprint(businessSnapshot(before)), versionToken: before.versionToken, rows };
}

export function assertSavePermit({ permit, preview, capabilities, now = Date.now() }) {
  if (!permit?.saveAllowed || !['test','live'].includes(permit.mode) || !Number.isFinite(permit.expiresAt) || permit.expiresAt <= now || permit.expiresAt > now + 5 * 60 * 1000) fail('SAVE_DISABLED');
  if (permit.companyCode !== preview.companyCode || permit.voucherNumber !== preview.voucherNumber || permit.jobId !== preview.jobId || permit.planFingerprint !== preview.planFingerprint) fail('PERMIT_MISMATCH');
  const accepted = capabilities?.atomicMetadataOnlyUpdate === true && capabilities?.optimisticConcurrency === true && capabilities?.versionToken === preview.versionToken;
  const boundedTest = permit.mode === 'test' && permit.testSaveAllowed === true && permit.testWriteEnabled === true && capabilities?.acceptanceTestExclusiveDocument === true;
  if (!accepted && !boundedTest) fail('VENDOR_SAVE_NOT_ACCEPTED');
  const maximum=boundedTest ? Math.min(200,Number.isInteger(capabilities?.testMetadataMaxLength)?capabilities.testMetadataMaxLength:0) : capabilities?.metadataMaxLength;
  if ((!boundedTest && capabilities?.metadataLengthAccepted !== true) || !Number.isInteger(maximum) || maximum < 1 || !preview.versionToken) fail('UNVERIFIED_FIELD_LENGTH');
  if (preview.rows.some(row=>row.metadata.length>maximum)) fail('METADATA_TOO_LONG');
}

// Durable receipt states are injected. Persist only hashes, identifiers and save intent, never ERP form/customer data.
export function createEngine({ adapter, receipts, clock = () => Date.now() }) {
  const active = new Set();
  async function recover({ jobId, preview }) {
    if (jobId !== preview.jobId) fail('WRONG_JOB');
    const receipt = await receipts.get(jobId);
    if (!receipt || !['saving', 'uncertain', 'saved'].includes(receipt.state)) fail('NO_SAVE_TO_RECOVER');
    if (receipt.planFingerprint !== preview.planFingerprint) fail('PLAN_FINGERPRINT_MISMATCH');
    const actual = await adapter.read();
    if (actual.companyCode !== preview.companyCode || actual.voucherNumber !== preview.voucherNumber) fail('WRONG_DOCUMENT');
    const businessHash = await fingerprint(businessSnapshot(actual));
    if (businessHash !== receipt.businessFingerprint) fail('BUSINESS_CONFLICT');
    const rows = preview.rows.map(expected => actual.rows.find(row => row.rowId === expected.rowId));
    const metadataHash = await fingerprint(rows.map(row => row ? [row.rowId, row.metadata] : null));
    if (metadataHash !== receipt.metadataFingerprint) return { outcome: 'uncertain', errorCode: 'READBACK_NOT_CONFIRMED' };
    await receipts.set(jobId, { ...receipt, state: 'saved', confirmedAt: clock() });
    return { outcome: 'saved', after: actual, recovered: true };
  }
  return {
    recover,
    async preview(input) {
      const before = await adapter.read(), capabilities = await adapter.capabilities();
      const preview = await buildPreview({ ...input, before, capabilities });
      return { before, capabilities, preview: { ...preview, planFingerprint: await fingerprint(input.plan) } };
    },
    async apply({ jobId, preview, permit }) {
      if (active.has(jobId)) fail('JOB_ALREADY_RUNNING');
      active.add(jobId);
      let noPriorAttempt=false,intentPersistStarted=false;
      try {
        const prior = await receipts.get(jobId);
        if (prior && ['saving', 'uncertain', 'saved'].includes(prior.state)) return recover({ jobId, preview });
        if(prior)fail('UNKNOWN_RECEIPT_STATE');
        noPriorAttempt=true;
        if (jobId !== preview.jobId) fail('WRONG_JOB');
        const capabilities = await adapter.capabilities();
        assertSavePermit({ permit, preview, capabilities, now: clock() });
        const before = await adapter.read();
        if (before.companyCode !== preview.companyCode || before.voucherNumber !== preview.voucherNumber) fail('WRONG_DOCUMENT');
        if (await fingerprint(businessSnapshot(before)) !== preview.beforeFingerprint || before.versionToken !== preview.versionToken) fail('BUSINESS_CONFLICT');
        for (const row of preview.rows) if (before.rows.find(actual => actual.rowId === row.rowId)?.metadata !== row.previousMetadata) fail('METADATA_CONFLICT');
        const receipt = { state: 'saving', planFingerprint: preview.planFingerprint, companyCode: preview.companyCode, voucherNumber: preview.voucherNumber, businessFingerprint: preview.beforeFingerprint, metadataFingerprint: await fingerprint(preview.rows.map(row => [row.rowId, row.metadata])), startedAt: clock() };
        // Persist save intent BEFORE any form fill/save. Lost response can only read back, never click again.
        intentPersistStarted=true;
        await receipts.set(jobId, receipt);
        try {
          await adapter.saveMetadata({ expectedVersionToken: preview.versionToken, expectedBusinessFingerprint: preview.beforeFingerprint, rows: preview.rows });
          const result = await recover({ jobId, preview });
          if (result.outcome !== 'saved') await receipts.set(jobId, { ...receipt, state: 'uncertain' });
          return result;
        } catch (error) {
          await receipts.set(jobId, { ...receipt, state: 'uncertain' });
          return { outcome: 'uncertain', errorCode: error.code || 'SAVE_RESULT_UNKNOWN' };
        }
      } catch(error) {
        // Only a proven empty durable receipt plus rejection before intent persistence establishes
        // that this invocation could not have touched ERP. Prior/unknown receipts remain recover-only.
        if(noPriorAttempt&&!intentPersistStarted)return {outcome:'not_attempted',saveAttempted:false,errorCode:error.code||'PRE_SAVE_REJECTED'};
        throw error;
      } finally { active.delete(jobId); }
    }
  };
}
