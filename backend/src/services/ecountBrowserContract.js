const { fail } = require('./cartonContents');
const { digest, ordered } = require('./ecountReferenceManifest');
const { normalizedVoucher } = require('./ecountReferenceIdentity');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const invalid = message => fail('ECOUNT_BROWSER_INVALID_EVIDENCE', message, 400);
function config(env = process.env) {
    const mode = ['off','preview','test','live'].includes(env.ECOUNT_BROWSER_ASSISTANT_MODE) ? env.ECOUNT_BROWSER_ASSISTANT_MODE : 'off';
    let documents = [];
    try { const value = JSON.parse(env.ECOUNT_BROWSER_ASSISTANT_DOCUMENTS || '[]'); if (Array.isArray(value) && value.length <= 100) documents = value.filter(row => typeof row.companyCode === 'string' && normalizedVoucher(row.voucherNumber).dated).map(row => ({ companyCode: row.companyCode, voucherNumber: normalizedVoucher(row.voucherNumber).value })); } catch { /* fail closed */ }
    let companyMappings=[];
    if(mode==='test')try{
        const value=JSON.parse(env.ECOUNT_BROWSER_ASSISTANT_COMPANIES||'[]'),codes=new Set(),names=new Set(),taxIds=new Set();
        const literal=(text,max)=>typeof text==='string'&&text.length>0&&text.length<=max&&text===text.trim()&&!/[\u0000-\u001f\u007f]/.test(text);
        if(Array.isArray(value)&&value.length<=100&&value.every(row=>{
            if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='companyCode,companyName,taxId'||!literal(row.companyCode,64)||!literal(row.companyName,128)||typeof row.taxId!=='string'||!/^\d{8}$/.test(row.taxId)||codes.has(row.companyCode)||names.has(row.companyName)||taxIds.has(row.taxId))return false;
            codes.add(row.companyCode);names.add(row.companyName);taxIds.add(row.taxId);return true;
        }))companyMappings=value.map(row=>({companyCode:row.companyCode,companyName:row.companyName,taxId:row.taxId}));
    }catch{/* Reject the complete ambiguous/invalid mapping; never infer a code. */}
    return { mode, enabled: mode !== 'off', metadataFieldLabel: 'WMS箱號明細', documents,companyMappings,
        acceptanceProof: /^[a-f0-9]{64}$/.test(env.ECOUNT_BROWSER_ASSISTANT_ACCEPTANCE_PROOF || '') ? env.ECOUNT_BROWSER_ASSISTANT_ACCEPTANCE_PROOF : null,
        concurrencyCapability: env.ECOUNT_BROWSER_ASSISTANT_CONCURRENCY_CAPABILITY === 'native-compare-and-set' ? 'native-compare-and-set' : null,
        testWriteEnabled: env.ECOUNT_BROWSER_ASSISTANT_TEST_WRITE_ENABLED === 'true' };
}
function boundedString(value, name, { empty = false, max = 10000 } = {}) {
    if (typeof value !== 'string' || !empty && !value || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw invalid(name + ' 格式無效');
    return value;
}
function snapshot(value) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 1000 || !Array.isArray(value.linkedDocuments) || value.linkedDocuments.length > 1000
        || !value.otherBusinessFields || Array.isArray(value.otherBusinessFields) || typeof value.otherBusinessFields !== 'object' || !value.totals || typeof value.totals !== 'object') throw invalid('原銷貨單快照不完整');
    const allowed = ['schemaVersion','companyCode','voucherNumber','versionToken','capturedAt','customerCode','warehouseCode','currencyCode','approvalStatus','linkedDocuments','totals','otherBusinessFields','rows'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !(key in value))) throw invalid('原銷貨單欄位範圍不完整');
    for (const key of ['companyCode','voucherNumber','versionToken','capturedAt','customerCode','warehouseCode','currencyCode','approvalStatus']) boundedString(value[key], key, { empty: ['warehouseCode','currencyCode'].includes(key), max: 512 });
    if (!Number.isFinite(Date.parse(value.capturedAt)) || normalizedVoucher(value.voucherNumber).value !== value.voucherNumber || !normalizedVoucher(value.voucherNumber).dated) throw invalid('必須精確讀取含日期的原銷貨單號與擷取時間');
    const decimal = (number, name) => { if (typeof number !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(number) || number.length > 64) throw invalid(name + ' 必須保留原始十進位文字'); };
    if (Object.keys(value.totals).sort().join(',') !== 'grossAmount,netAmount,taxAmount') throw invalid('原單合計欄位不完整');
    for (const [key, number] of Object.entries(value.totals)) decimal(number, key);
    for (const link of value.linkedDocuments) boundedString(link, '關聯單據', { max: 512 });
    if (JSON.stringify(value.otherBusinessFields).length > 100000) throw invalid('原單額外欄位過大');
    const ids = new Set(), sns = new Set(), rowKeys = ['rowId','itemCode','sourceLineId','quantity','unitPrice','netAmount','taxAmount','grossAmount','warehouseCode','actualSN','metadata'];
    for (const row of value.rows) {
        if (!row || typeof row !== 'object' || Object.keys(row).some(key => !rowKeys.includes(key)) || rowKeys.some(key => !(key in row))) throw invalid('原單商品列欄位不完整');
        for (const key of ['rowId','itemCode']) boundedString(row[key], key, { max: 255 });
        if (ids.has(row.rowId)) throw invalid('原單列識別重複'); ids.add(row.rowId);
        if (row.sourceLineId !== null) boundedString(row.sourceLineId, '來源列識別', { max: 255 });
        if (typeof row.quantity !== 'string' || !/^\d+$/.test(row.quantity) || !Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) < 1) throw invalid('原銷貨數量不是完整正整數');
        for (const key of ['unitPrice','netAmount','taxAmount','grossAmount']) decimal(row[key], key);
        boundedString(row.warehouseCode, '列倉庫', { empty: true, max: 255 }); boundedString(row.metadata, '箱號欄', { empty: true });
        if (!Array.isArray(row.actualSN) || row.actualSN.length > 10000 || row.actualSN.length && row.actualSN.length !== Number(row.quantity)) throw invalid('原單實際 SN 不完整');
        for (const sn of row.actualSN) { boundedString(sn, 'SN', { max: 100 }); if (sns.has(sn)) throw invalid('原單 SN 重複'); sns.add(sn); }
    }
    // Copy only after validating the complete declared document contract.
    return JSON.parse(JSON.stringify(value));
}
function businessFingerprint(value) {
    const { capturedAt, versionToken, ...business } = snapshot(value);
    return digest({ ...business, rows: business.rows.map(({ metadata, ...row }) => row) });
}
function mergeMetadata(previous, orderId, content) {
    const start=`[CORELY-WMS:${orderId}]`,end=`[/CORELY-WMS:${orderId}]`,block=`${start}${content}${end}`;
    const opens=previous.split(start).length-1,closes=previous.split(end).length-1;
    if(opens!==closes||opens>1||previous.includes('[CORELY-WMS:')&&!opens||previous.includes('[/CORELY-WMS:')&&!closes)throw fail('ECOUNT_BROWSER_METADATA_CONFLICT','箱號欄的既有 WMS 區塊不完整或屬於另一張 WMS 單，請主管核對');
    if(opens){const a=previous.indexOf(start),b=previous.indexOf(end),outside=previous.slice(0,a)+previous.slice(b+end.length);if(b<a||/\[\/?CORELY-WMS:/.test(previous.slice(a+start.length,b))||/\[\/?CORELY-WMS:/.test(outside))throw fail('ECOUNT_BROWSER_METADATA_CONFLICT','箱號欄的既有 WMS 區塊格式錯誤');return previous.slice(0,a)+block+previous.slice(b+end.length);}
    return previous+(previous?'\n':'')+block;
}
function buildPlan(manifest, binding, beforeValue, capabilities, settings) {
    const before = snapshot(beforeValue);
    if (!manifest.ready || !manifest.rows.length) throw fail('ECOUNT_BROWSER_MANIFEST_BLOCKED', '請先完成有箱號分配的正數出貨核對');
    if (before.companyCode !== binding.company_code || before.voucherNumber !== binding.voucher_number) throw fail('ECOUNT_BROWSER_DOCUMENT_MISMATCH', '目前畫面不是這筆工作指定的公司與原銷貨單');
    const totals = new Map(manifest.totals.map(row => [row.itemCode, row])), external = new Map();
    for (const row of before.rows) { const rows = external.get(row.itemCode) || []; rows.push(row); external.set(row.itemCode, rows); }
    if (external.size !== totals.size) throw fail('ECOUNT_BROWSER_LINES_MISMATCH', '原銷貨單商品範圍與 WMS 不一致');
    const rows = [];
    for (const [itemCode, expected] of totals) {
        const matches = external.get(itemCode);
        if (!matches || matches.reduce((sum, row) => sum + Number(row.quantity), 0) !== expected.quantity || JSON.stringify(ordered(matches.flatMap(row => row.actualSN))) !== JSON.stringify(expected.actualSN)) throw fail('ECOUNT_BROWSER_LINES_MISMATCH', '原單品號、數量或實際 SN 與 WMS 不一致');
        for (const row of matches) {
            const grouped = [...manifest.rows, ...manifest.looseRows].filter(line => line.itemCode === itemCode && (matches.length === 1 || line.sourceLineId === row.sourceLineId));
            if (matches.length > 1 && (!row.sourceLineId || matches.filter(other => other.sourceLineId === row.sourceLineId).length !== 1 || grouped.some(line => !line.sourceLineId))) throw fail('ECOUNT_BROWSER_AMBIGUOUS_LINE', '同品號多列缺少唯一來源列識別，不能自動配對');
            if (grouped.reduce((sum, line) => sum + line.quantity, 0) !== Number(row.quantity) || JSON.stringify(ordered(grouped.flatMap(line => line.actualSN))) !== JSON.stringify(ordered(row.actualSN))) throw fail('ECOUNT_BROWSER_AMBIGUOUS_LINE', '原單列的來源、數量或 SN 不一致');
            const cartons = new Map(); let loose = 0;
            for (const line of grouped) { if (line.cartonId) cartons.set(line.cartonId, (cartons.get(line.cartonId) || 0) + line.quantity); else loose += line.quantity; }
            const content = `WMS-${manifest.orderId} | ` + [...cartons].sort(([a],[b]) => a.localeCompare(b, 'en')).map(([id, qty]) => `${id} 出 ${qty} 件`).concat(loose ? [`散件 ${loose} 件`] : []).join('; ');
            const metadata=mergeMetadata(row.metadata,manifest.orderId,content);
            if (metadata.length > 10000) throw fail('ECOUNT_BROWSER_METADATA_CONFLICT', '箱號明細加上原有備註超過欄位長度，請主管核對');
            rows.push({ rowId: row.rowId, itemCode, expectedQuantity: row.quantity, metadata });
        }
    }
    const plan = { schemaVersion: 1, companyCode: before.companyCode, voucherNumber: before.voucherNumber, businessFingerprint: businessFingerprint(before), expectedVersionToken: before.versionToken, metadataFieldLabel: settings.metadataFieldLabel, rows };
    const allowedDocument = settings.documents.some(row => row.companyCode === before.companyCode && row.voucherNumber === before.voucherNumber);
    const testSaveAllowed=settings.mode==='test'&&settings.testWriteEnabled&&allowedDocument&&capabilities?.acceptanceTestExclusiveDocument===true&&capabilities?.versionToken===before.versionToken;
    const liveSaveAllowed=settings.mode==='live'&&!!settings.acceptanceProof&&settings.concurrencyCapability==='native-compare-and-set'
        &&capabilities?.atomicMetadataOnlyUpdate===true&&capabilities?.optimisticConcurrency===true&&capabilities?.versionToken===before.versionToken;
    const saveAllowed=testSaveAllowed||liveSaveAllowed;
    return { before, plan, planFingerprint: digest(plan), saveAllowed, reason: saveAllowed ? null : '尚未通過原單僅文字修改與原生並行保護驗收；目前只能預覽，不會儲存 ECOUNT' };
}
function verifyAfter(before, afterValue, plan) {
    const after = snapshot(afterValue);
    if (businessFingerprint(before) !== businessFingerprint(after)) throw fail('ECOUNT_BROWSER_BUSINESS_CHANGED', '原單數量、金額、SN、庫存相關或其他業務欄位已變更，不可確認成功');
    const expected = new Map(plan.rows.map(row => [row.rowId, row.metadata]));
    if (after.rows.some(row => row.metadata !== expected.get(row.rowId))) throw fail('ECOUNT_BROWSER_READBACK_MISMATCH', '重新讀取的箱號文字與預期不一致');
    return after;
}
function verifyFrozenAttempt(job, after) {
    const plan=job.plan,before=job.before_snapshot;
    if(!plan||plan.saveAllowed!==true||!['test','live'].includes(plan.mode)||digest(plan)!==job.plan_fingerprint
        ||plan.companyCode!==job.company_code||plan.voucherNumber!==job.voucher_number
        ||before?.companyCode!==job.company_code||before?.voucherNumber!==job.voucher_number
        ||businessFingerprint(before)!==plan.businessFingerprint)throw fail('ECOUNT_BROWSER_FROZEN_EVIDENCE_INVALID','原回寫計畫、公司或銷貨單的存證不完整，不能確認舊結果');
    return verifyAfter(before,after,plan);
}
module.exports = { uuid, config, snapshot, businessFingerprint, buildPlan, verifyAfter, mergeMetadata,verifyFrozenAttempt };
