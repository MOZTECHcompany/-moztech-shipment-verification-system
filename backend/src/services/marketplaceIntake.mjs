import { parseOneShopSku } from './oneShopSku.mjs';

// Local-only conversion. Amounts are integer hundredths; no payment or inventory writes.
export const ECOUNT_HEADERS = ['日期', '序號', '客戶/供應商編碼', '客戶/供應商名稱', '承辦人', '專案', '發貨倉庫', '交易類型', '貨幣', '匯率', '銷貨單單號', '品項編碼', '商城訂單編號', '平台', '店鋪', '來源明細號', '品項名稱', '序號/批號', '規格', '數量', '單價', '單價(含稅)', '外幣金額', '稅前價格', '營業稅', '摘要', '產生生產入庫'];

// Online uploader verified on 2026-09-15: standard columns first, custom
// marketplace columns in X:AA. Stored snapshots retain the canonical layout.
export const ECOUNT_UPLOAD_HEADERS = [...ECOUNT_HEADERS.slice(0,12),...ECOUNT_HEADERS.slice(16),...ECOUNT_HEADERS.slice(12,16)];
export function formatEcountProductColumn(sheet,rowCount){
  for(let row=1;row<=rowCount;row++){
    const cell=sheet[`L${row}`];if(!cell)continue;
    if(typeof cell.v==='number'&&!Number.isSafeInteger(cell.v))throw Error('品項編碼不是完整有效的識別碼');
    cell.v=String(cell.v??'');cell.t='s';cell.z='@';delete cell.w;
  }
}
export function buildEcountUploadTable(record){
  if(!Array.isArray(record?.headers)||record.headers.length!==27||new Set(record.headers).size!==27||!Array.isArray(record.rows))throw Error('ECOUNT 保存批次欄位格式無效');
  const indexes=ECOUNT_UPLOAD_HEADERS.map(h=>record.headers.indexOf(h));
  if(indexes.some(i=>i<0)||record.rows.some(r=>!Array.isArray(r)||r.length!==27))throw Error('ECOUNT 保存批次欄位不完整，未產生下載檔');
  const corrected = prepareEcountFinancials(record);
  return {headers:[...ECOUNT_UPLOAD_HEADERS],rows:corrected.rows.map(r=>indexes.map(i=>r[i])), financials:corrected.financials};
}

const LEGACY_FINANCIAL_VERSION = 'twd-vat5-line-v1';
export const ECOUNT_FINANCIAL_VERSION = 'twd-vat5-line-whole-v2';
export const ECOUNT_ROUNDING_FINANCIAL_VERSION = 'twd-vat5-line-whole-round-v3';
export const ECOUNT_GROUPED_MODE = 'product-200-v1';
export const ECOUNT_GROUPED_FINANCIAL_VERSION = 'twd-vat5-product-200-whole-v2';
export const ECOUNT_ROUNDING_GROUPED_FINANCIAL_VERSION = 'twd-vat5-product-200-whole-round-v3';
const ROUNDING_VERSION = 'twd-order-rounding-v1';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
// An explicit grouped download can be rebuilt from an immutable older batch.
// Its original rows remain available for already-posted ERP receipts.
export function groupedSalesRecord(record){
  if(record.settings?.salesExportMode===ECOUNT_GROUPED_MODE)return record;
  if(record.settings?.salesExportMode&&!['order-lines-v1'].includes(record.settings.salesExportMode))throw Error('未知的銷貨彙總版本');
  const source=prepareEcountSourceFinancials(record);
  const grouped={...record,rows:source.rows,settings:{...record.settings,salesExportMode:ECOUNT_GROUPED_MODE},summary:{...record.summary,financialVersion:source.financials.version}};
  delete grouped.salesLayout;
  const view=prepareEcountFinancials(grouped);
  return {...grouped,salesLayout:view.salesLayout};
}
export const ECOUNT_TAX_DESCRIPTION = 'TWD 含稅 5%；訂單總額保留整元，商品分攤尾差按最大餘數分配至元，稅前金額及營業稅均為整元；單價顯示至小數兩位，以明細金額核對。';
export const ECOUNT_ROUNDING_TAX_DESCRIPTION = 'TWD 含稅 5%；保留來源訂單精確金額，每筆訂單含稅總額四捨五入至元，再按最大餘數分攤商品及運費；稅前金額及營業稅均為整元。尾差另列為 ERP 金額減來源金額，不改付款或折扣。';
const safeInteger = n => {if(!Number.isSafeInteger(n)||n<0)throw Error('銷貨金額或數量超出安全範圍');return n;};
const roundRatio = (n,d) => Number((BigInt(n)*2n+BigInt(d))/(BigInt(d)*2n));
function calculateLegacyInclusiveTax(grossMinor, quantity){
  safeInteger(grossMinor);safeInteger(quantity);
  if(!quantity)throw Error('銷貨數量必須大於零');
  // VAT included in gross is 5/105. Round the line tax to whole TWD,
  // never round a unit tax first or derive the line amount from rounded units.
  const taxMinor = roundRatio(grossMinor,2100)*100;
  const netMinor = grossMinor-taxMinor;
  return {grossMinor,netMinor,taxMinor,netUnitMinor:roundRatio(netMinor,quantity)};
}
export function calculateInclusiveTax(grossMinor, quantity){
  safeInteger(grossMinor);
  if(grossMinor%100!==0)throw Error('TWD 銷貨明細須先完成整元分攤，不能改動訂單總額');
  return calculateLegacyInclusiveTax(grossMinor,quantity);
}

// Currency is taken from the source or an explicit store profile. Tax 11 is
// the supported inclusive-TWD mode; an incompatible explicit setting survives
// normalization and is rejected, rather than silently replaced.
export function normalizeMarketplaceSettings(parsed, settings={}){
  const currencies=[...new Set((parsed.orders||[]).map(o=>text(o.financial?.currency)).filter(Boolean))];
  const effective={...settings};
  if(!text(effective.currency)&&currencies.length===1)effective.currency=currencies[0];
  if(effective.currency==='TWD'&&currencies.every(c=>c==='TWD')){
    if(!text(effective.taxMode))effective.taxMode='erp_inclusive';
    if(!text(effective.taxType))effective.taxType='11';
    if(effective.taxMode==='erp_inclusive'&&text(effective.taxType)==='11')effective.taxConfirmed=true;
  }
  return effective;
}

// Source receipts always retain their cents. Version two requires whole order
// totals; version three records each order's half-up ERP target and its delta.
// Both use stable largest remainders for whole-dollar source-row allocations.
function wholeTwdSourceAmounts(record,{roundOrders=false}={}){
  const amounts=new Map(),orderTotals=new Map(),quantities=new Map(),roundingOrders=[];
  for(const order of record.orders||[]){
    const total=safeInteger(order.financial?.totalMinor);
    if(!roundOrders&&total%100!==0)throw Error(`訂單 ${order.sourceOrderNumber} 的 TWD 總額含小數，無法同時保留原總額與整元銷貨，請核對來源金額`);
    const orderKey=JSON.stringify([order.sourcePlatform,order.sourceOrderNumber]);
    if(orderTotals.has(orderKey))throw Error('銷貨來源訂單編號重複');
    const erpTotal=roundOrders?safeInteger(roundRatio(total,100)*100):total;
    orderTotals.set(orderKey,erpTotal);
    const entries=(record.items||[]).filter(i=>i.sourceOrderNumber===order.sourceOrderNumber).map(i=>({id:i.sourceLineId,amount:safeInteger(i.kind==='bundle_component'?0:i.lineSubtotalMinor),quantity:i.quantity}));
    const shipping=order.financial?.shippingMinor??0;
    if(shipping>0)entries.push({id:stableId([order.sourcePlatform,order.sourceOrderNumber,'shipping']),amount:safeInteger(shipping),quantity:1});
    if(!entries.length||sum(entries.map(e=>e.amount))!==total)throw Error(`銷貨金額與來源訂單 ${order.sourceOrderNumber} 不符`);
    if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('銷貨來源明細編號重複');
    let remainder=erpTotal/100;
    for(const entry of entries){entry.whole=Math.floor(entry.amount/100);entry.remainder=entry.amount%100;remainder-=entry.whole;}
    const ranked=[...entries].sort((a,b)=>b.remainder-a.remainder||(a.id<b.id?-1:a.id>b.id?1:0));
    for(const entry of ranked){if(!remainder)break;entry.whole++;remainder--;}
    if(remainder)throw Error('銷貨整元分攤無法核對');
    for(const entry of entries){
      const key=JSON.stringify([order.sourcePlatform,order.sourceOrderNumber,entry.id]);
      amounts.set(key,entry.whole*100);
      if(roundOrders){if(!safeInteger(entry.quantity))throw Error('銷貨數量必須大於零');quantities.set(key,entry.quantity);}
    }
    if(roundOrders)roundingOrders.push({identity:[order.sourcePlatform,order.sourceOrderNumber],sourceTotalMinor:total,ecountTotalMinor:erpTotal,roundingDeltaMinor:erpTotal-total,
      lines:[...entries].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(e=>({sourceLineId:e.id,quantity:e.quantity,sourceGrossMinor:e.amount,ecountGrossMinor:e.whole*100,roundingDeltaMinor:e.whole*100-e.amount}))});
  }
  if(!roundOrders)return {amounts,orderTotals};
  roundingOrders.sort((a,b)=>JSON.stringify(a.identity)<JSON.stringify(b.identity)?-1:JSON.stringify(a.identity)>JSON.stringify(b.identity)?1:0);
  const sourceTotalMinor=safeInteger(sum(roundingOrders.map(o=>o.sourceTotalMinor))),ecountTotalMinor=safeInteger(sum(roundingOrders.map(o=>o.ecountTotalMinor)));
  return {amounts,orderTotals,quantities,rounding:{version:ROUNDING_VERSION,policy:'half-up',sourceTotalMinor,ecountTotalMinor,roundingDeltaMinor:ecountTotalMinor-sourceTotalMinor,orders:roundingOrders}};
}
function roundingFinancials(rounding){
  return rounding?{sourceTotalMinor:rounding.sourceTotalMinor,ecountTotalMinor:rounding.ecountTotalMinor,roundingDeltaMinor:rounding.roundingDeltaMinor,roundingPolicy:rounding.policy}:{};
}
export function prepareEcountSourceFinancials(record){
  for(const item of record.items||[]){const problem=productIdentifierIssue(item.sku);if(problem)throw Error(problem);}
  const headers=record.headers||[], col=h=>headers.indexOf(h);
  const required=['交易類型','數量','單價(含稅)','單價','稅前價格','營業稅','商城訂單編號','平台','店鋪','來源明細號'];
  if(required.some(h=>col(h)<0)||!record.rows?.length)throw Error('銷貨金額核對欄位不完整');
  if(record.summary?.financialVersion&&![LEGACY_FINANCIAL_VERSION,ECOUNT_FINANCIAL_VERSION,ECOUNT_ROUNDING_FINANCIAL_VERSION].includes(record.summary.financialVersion))throw Error('未知的銷貨計稅版本，請核對原批次');
  const legacy=!record.summary?.financialVersion;
  const rounded=record.summary?.financialVersion===ECOUNT_ROUNDING_FINANCIAL_VERSION;
  const whole=rounded||record.summary?.financialVersion===ECOUNT_FINANCIAL_VERSION;
  const allocation=whole?wholeTwdSourceAmounts(record,{roundOrders:rounded}):null;
  if(rounded&&JSON.stringify(canonical(record.rounding))!==JSON.stringify(canonical(allocation.rounding)))throw Error('保存的訂單整元尾差對照不一致，未產生下載檔');
  if(rounded&&['sourceTotalMinor','roundingDeltaMinor'].some(k=>record.summary?.[k]!==allocation.rounding[k]))throw Error('保存的來源總額／整元尾差與批次不符');
  if(legacy&&(!record.orders?.length||record.settings?.currency!=='TWD'||record.settings?.taxType!=='11'||record.settings?.taxConfirmed!==true))throw Error('舊批次缺少原始訂單或稅制，無法安全重建稅額');
  const byOrder=new Map(), seen=new Set();
  let netTotal=0,taxTotal=0,grossTotal=0;
  const rows=record.rows.map(original=>{
    const row=[...original], get=h=>row[col(h)];
    if(String(get('交易類型'))!=='11')throw Error('目前僅支援營業稅 11 的 TWD 含稅 5% 計算');
    const identity=['平台','店鋪','商城訂單編號','來源明細號'].map(get);
    if(identity.some(v=>!String(v??'').trim())||seen.has(JSON.stringify(identity)))throw Error('銷貨來源編號缺漏或重複');
    seen.add(JSON.stringify(identity));
    const quantity=Number(get('數量')), unit=parseMoneyMinor(get('單價(含稅)'));
    if(unit===null)throw Error('含稅單價不可空白');
    const grouped=record.settings?.salesExportMode===ECOUNT_GROUPED_MODE;
    // Rounded unit prices are display values in v3; the exact row allocation
    // is authoritative, including at the safe-integer boundary.
    let gross=rounded?undefined:safeInteger(unit*quantity);
    if(whole){
      const key=JSON.stringify([identity[0],identity[2],identity[3]]);
      gross=allocation.amounts.get(key);
      safeInteger(gross);
      if(rounded&&quantity!==allocation.quantities.get(key))throw Error('保存銷貨的數量與來源明細不符');
      if(unit!==roundRatio(gross,quantity))throw Error('來源含稅單價與成交金額不符');
    }else if(grouped){
      const item=record.items?.find(i=>i.sourceOrderNumber===identity[2]&&i.sourceLineId===identity[3]);
      const order=record.orders?.find(o=>o.sourceOrderNumber===identity[2]&&o.sourcePlatform===identity[0]);
      gross=item?(item.kind==='bundle_component'?0:item.lineSubtotalMinor):order?.financial.shippingMinor;
      safeInteger(gross);
      if(!item&&identity[3]!==stableId([identity[0],identity[2],'shipping']))throw Error('彙總來源明細不明');
      if(unit!==roundRatio(gross,quantity))throw Error('來源含稅單價與成交金額不符');
    }
    const f=(whole?calculateInclusiveTax:calculateLegacyInclusiveTax)(gross,quantity);
    if(!legacy&&(['單價','稅前價格','營業稅'].some(h=>parseMoneyMinor(get(h))!==({'單價':f.netUnitMinor,'稅前價格':f.netMinor,'營業稅':f.taxMinor}[h]))))throw Error('保存銷貨的稅前金額／營業稅不一致，請核對原批次');
    if(legacy){
      // Only repair the known blank/zero export defect. Never overwrite a
      // different historical tax result or alter source references/summary/SN.
      for(const h of ['單價','稅前價格','營業稅'])if(![null,0].includes(parseMoneyMinor(get(h))))throw Error('舊批次已有金額，須人工核對計稅方式');
      row[col('單價')]=f.netUnitMinor/100;row[col('稅前價格')]=f.netMinor/100;row[col('營業稅')]=f.taxMinor/100;
    }
    grossTotal=safeInteger(grossTotal+f.grossMinor);netTotal=safeInteger(netTotal+f.netMinor);taxTotal=safeInteger(taxTotal+f.taxMinor);
    const key=JSON.stringify(identity.slice(0,3));byOrder.set(key,safeInteger((byOrder.get(key)||0)+f.grossMinor));
    return row;
  });
  if(record.orders){
    if(byOrder.size!==record.orders.length)throw Error('銷貨訂單筆數與原批次不一致');
    for(const o of record.orders){const key=JSON.stringify([o.sourcePlatform,record.settings.store,o.sourceOrderNumber]),target=rounded?allocation.orderTotals.get(JSON.stringify([o.sourcePlatform,o.sourceOrderNumber])):o.financial.totalMinor;if(byOrder.get(key)!==target)throw Error(`銷貨金額與來源訂單 ${o.sourceOrderNumber} 不符`);}
  }
  if(record.summary?.ecountTotalMinor!==grossTotal||netTotal+taxTotal!==grossTotal)throw Error('銷貨稅前／稅額／含稅總額與批次不符');
  return {rows,financials:{version:rounded?ECOUNT_ROUNDING_FINANCIAL_VERSION:whole?ECOUNT_FINANCIAL_VERSION:LEGACY_FINANCIAL_VERSION,description:rounded?ECOUNT_ROUNDING_TAX_DESCRIPTION:whole?ECOUNT_TAX_DESCRIPTION:'TWD 含稅 5%；沿用原批次每列營業稅四捨五入至元及原始分攤。',netMinor:netTotal,taxMinor:taxTotal,grossMinor:grossTotal,recalculatedLegacy:legacy,...roundingFinancials(allocation?.rounding)}};
}

// Source rows remain immutable and order-grained. Only the ERP view is grouped.
// The saved allocation manifest connects each ERP segment to its source lines.
export function prepareEcountFinancials(record){
  const source=prepareEcountSourceFinancials(record);
  const rounded=source.financials.version===ECOUNT_ROUNDING_FINANCIAL_VERSION;
  const whole=rounded||source.financials.version===ECOUNT_FINANCIAL_VERSION;
  const mode=record.settings?.salesExportMode;
  if(!mode||mode==='order-lines-v1')return source;
  if(mode!==ECOUNT_GROUPED_MODE)throw Error('未知的銷貨彙總版本');
  if(JSON.stringify(record.headers)!==JSON.stringify(ECOUNT_HEADERS))throw Error('彙總銷貨原始欄位順序不符');
  if(!record.items?.length||!record.orders?.length)throw Error('彙總銷貨缺少原訂單明細');
  const identity=r=>JSON.stringify([r[13],r[14],r[12],r[15]]);
  const physical=new Map(record.items.map(i=>[JSON.stringify([record.orders.find(o=>o.sourceOrderNumber===i.sourceOrderNumber)?.sourcePlatform,record.settings.store,i.sourceOrderNumber,i.sourceLineId]),i]));
  const groups=new Map(),compare=(a,b)=>a<b?-1:a>b?1:0;
  for(const r of [...source.rows].sort((a,b)=>compare(identity(a),identity(b)))){
    if(r[10]!==record.settings.batchNumber||r[14]!==record.settings.store||r[2]!==record.settings.customerCode||r[6]!==record.settings.warehouseCode)throw Error('銷貨列不屬於本批客戶、店鋪或倉庫');
    if(String(r[17]||'').trim())throw Error('原明細已有序號/批號，不可重新彙總；請保留原銷貨格式');
    const item=physical.get(identity(r)),m=item?record.settings.skuMappings?.[item.sku]:record.settings.shippingSku;
    if(!m||m.erpSku!==r[11])throw Error('彙總商品對照與原明細不符');
    const barcode=item?mappingScanCode(m):'';
    // Keep differing ERP variants, warehouses, tax/currency and stock/nonstock
    // separate even when a supplier has reused the same printed barcode.
    const key=JSON.stringify([r.slice(0,12),r[13],r[14],r[18],barcode,!!item,r[25]]);
    if(!groups.has(key))groups.set(key,{key,row:r,barcode,physical:!!item,quantity:0,grossMinor:0,sources:[]});
    const g=groups.get(key),grossMinor=parseMoneyMinor(r[23])+parseMoneyMinor(r[24]);
    g.quantity=safeInteger(g.quantity+r[19]);g.grossMinor=safeInteger(g.grossMinor+grossMinor);
    g.sources.push({identity:[r[13],r[14],r[12],r[15]],quantity:r[19],grossMinor});
  }
  const rows=[],lines=[];
  for(const g of [...groups.values()].sort((a,b)=>compare(a.key,b.key))){
    let sourceIndex=0,sourceUsed=0;
    for(let offset=0;offset<g.quantity;offset+=200){
      const quantity=Math.min(200,g.quantity-offset);
      const portion=(amount,n,d)=>Number((BigInt(amount)*BigInt(n)*2n+BigInt(d))/(BigInt(d)*2n));
      const grossMinor=whole?(portion(g.grossMinor/100,offset+quantity,g.quantity)-portion(g.grossMinor/100,offset,g.quantity))*100:portion(g.grossMinor,offset+quantity,g.quantity)-portion(g.grossMinor,offset,g.quantity);
      const tax=(whole?calculateInclusiveTax:calculateLegacyInclusiveTax)(grossMinor,quantity),r=[...g.row],allocations=[];
      let remaining=quantity;
      while(remaining){
        const s=g.sources[sourceIndex],take=Math.min(remaining,s.quantity-sourceUsed);
        allocations.push({identity:s.identity,quantity:take,sourceGrossMinor:portion(s.grossMinor,sourceUsed+take,s.quantity)-portion(s.grossMinor,sourceUsed,s.quantity)});
        remaining-=take;sourceUsed+=take;
        if(sourceUsed===s.quantity){sourceUsed=0;sourceIndex++;}
      }
      r[12]=record.settings.batchNumber;
      r[15]=`AG-${stableId([g.key,offset/200]).slice(1)}`;
      r[17]='';r[19]=quantity;r[20]=tax.netUnitMinor/100;r[21]=roundRatio(grossMinor,quantity)/100;r[23]=tax.netMinor/100;r[24]=tax.taxMinor/100;
      rows.push(r);lines.push({lineId:r[15],productCode:r[11],barcode:g.barcode,physical:g.physical,quantity,grossMinor,netMinor:tax.netMinor,taxMinor:tax.taxMinor,allocations});
    }
  }
  const salesLayout={version:ECOUNT_GROUPED_MODE,maxQuantity:200,lines};
  if(record.salesLayout&&JSON.stringify(canonical(record.salesLayout))!==JSON.stringify(canonical(salesLayout)))throw Error('保存的銷貨彙總對照不一致，未產生下載檔');
  const grossMinor=sum(lines.map(l=>l.grossMinor)),netMinor=sum(lines.map(l=>l.netMinor)),taxMinor=sum(lines.map(l=>l.taxMinor));
  if(grossMinor!==source.financials.grossMinor||netMinor+taxMinor!==grossMinor)throw Error('彙總銷貨金額與原訂單總額不符');
  return {rows,salesLayout,financials:{version:rounded?ECOUNT_ROUNDING_GROUPED_FINANCIAL_VERSION:whole?ECOUNT_GROUPED_FINANCIAL_VERSION:'twd-vat5-product-200-v1',description:rounded?`${ECOUNT_ROUNDING_TAX_DESCRIPTION} 同批商品彙總，每列最多 200 件；單價為加權均價，以明細金額核對。`:whole?'同批商品彙總，每列最多 200 件；含稅金額按件數分攤至元，稅前金額及營業稅均為整元。單價為加權均價，明細稅前加稅額為核對金額。':'同批商品彙總，每列最多 200 件；保留原批次金額及計稅方式。',netMinor,taxMinor,grossMinor,recalculatedLegacy:false,...(rounded?roundingFinancials(record.rounding):{})}};
}

const text = (value) => value == null ? '' : String(value).trim();
const blank = (value) => text(value) === '';
const sum = (values) => values.reduce((a, b) => Number.isSafeInteger(a + b) ? a + b : NaN, 0);
const issue = (code, message, extra = {}, severity = 'error') => ({ code, severity, message, ...extra });
const REQUIRED = {
  '1Shop': ['訂單編號', '名稱', '產品SKU', '產品', '產品數量', '單價', '小計', '訂單金額(不含金/物流手續費)', '訂單金流手續費', '訂單運費', '總計金額', '金流狀態', '物流狀態'],
  Shopify: ['Name', 'Financial Status', 'Fulfillment Status', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total', 'Discount Amount', 'Refunded Amount', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku'],
};

export function parseMoneyMinor(value) {
  if (blank(value)) return null;
  const source = text(value);
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(source)) throw new Error('金額必須是最多兩位小數的數值');
  const negative = source.startsWith('-');
  const [whole, fraction = ''] = source.replace(/^-/, '').replaceAll(',', '').split('.');
  const result = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('金額超出可安全處理範圍');
  return Number(result);
}

export function formatMinor(value) {
  if (value == null) return '';
  if (!Number.isSafeInteger(value)) throw new Error('金額不是安全整數');
  const amount = BigInt(value);
  const positive = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${positive / 100n}.${String(positive % 100n).padStart(2, '0')}`;
}

function stableId(parts) {
  // A generated reference is stable across row reordering, not a platform line ID.
  let hash = 144066263297769815596495629667062367629n;
  for (const char of JSON.stringify(parts.map(text))) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(128, hash * 309485009821345068724781371n);
  }
  return `L${hash.toString(16).padStart(32, '0')}`;
}

function tableRows(rows, issues) {
  if (!Array.isArray(rows) || !rows.length) return { headers: [], data: [] };
  if (Array.isArray(rows[0])) {
    const headers = rows[0].map(text);
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) issues.push(issue('DUPLICATE_HEADERS', '來源檔含重複欄名，無法安全辨識欄位'));
    return { headers, data: rows.slice(1).map((row, index) => ({ sourceRow: index + 2, data: Object.fromEntries(headers.map((key, i) => [key, row?.[i] ?? ''])) })) };
  }
  return { headers: Object.keys(rows[0] || {}), data: rows.map((row, index) => ({ sourceRow: index + 2, data: row })) };
}

function status(value, platform, fulfillment = false) {
  const raw = text(value).toLowerCase();
  if (platform === 'Shopify') return raw || 'unknown';
  if (fulfillment) {
    if (/取消/.test(raw)) return 'cancelled';
    if (/等待|尚未|未出貨/.test(raw)) return 'unfulfilled';
    if (/已出貨|已送達|已完成/.test(raw)) return 'fulfilled';
    return 'unknown';
  }
  if (/退款/.test(raw)) return 'refunded';
  if (/等待|尚未|未付款|付款失敗|過期|逾期/.test(raw)) return 'pending';
  if (/已付款|付款完成|付款成功|已收款/.test(raw)) return 'paid';
  return 'unknown';
}

export function parseMarketplaceRows(rows, { platform, allowedOrderNumbers, allowAllOrders = false } = {}) {
  const issues = [];
  const result = { platform, orders: [], items: [], summary: {}, issues };
  const finish = () => {
    const orders = result.orders;
    const safeTotal = (values) => { const value = sum(values); if (!Number.isSafeInteger(value)) { issues.push(issue('SUMMARY_OVERFLOW', '合計超出可安全處理範圍')); return null; } return value; };
    const total = (key) => orders.every((o) => o.financial[key] != null) ? safeTotal(orders.map((o) => o.financial[key])) : null;
    result.summary = { orderCount: orders.length, itemCount: result.items.length, totalQuantity: safeTotal(result.items.map((i) => i.quantity || 0)), totalMinor: total('totalMinor'), subtotalMinor: total('subtotalMinor'), shippingMinor: total('shippingMinor'), feeMinor: total('feeMinor'), refundedMinor: total('refundedMinor'), excludedOrderCount: 0, excludedRowCount: 0, bundleComponentCount: result.items.filter((i) => i.kind === 'bundle_component').length, pendingOrderCount: orders.filter((o) => o.paymentStatus === 'pending').length, currencies: [...new Set(orders.map((o) => o.financial.currency).filter(Boolean))], ...result.summary };
    return result;
  };
  if (!REQUIRED[platform]) { issues.push(issue('UNSUPPORTED_PLATFORM', '請明確選擇 1Shop 或 Shopify')); return finish(); }
  if (!allowAllOrders && (!Array.isArray(allowedOrderNumbers) || !allowedOrderNumbers.length || allowedOrderNumbers.some((n) => !text(n)))) {
    issues.push(issue('ALLOWLIST_REQUIRED', '必須指定本次授權處理的訂單編號')); return finish();
  }
  const allowed = new Set((allowedOrderNumbers || []).map(text));
  const { headers, data } = tableRows(rows, issues);
  const missing = REQUIRED[platform].filter((key) => !headers.includes(key));
  if (missing.length) issues.push(issue('MISSING_HEADERS', `缺少來源欄位：${missing.join('、')}`));
  if (issues.length) return finish();
  const grouped = new Map();
  const allOrderNumbers = new Set();
  const excluded = new Set();
  let excludedRows = 0;
  let lastOrder = '';
  let footer = null;
  const nonempty = data.filter(({ data: row }) => Object.values(row).some((value) => !blank(value)));
  for (let index = 0; index < nonempty.length; index++) {
    const entry = nonempty[index];
    const row = entry.data;
    let number = text(row[platform === '1Shop' ? '訂單編號' : 'Name']);
    if (platform === '1Shop' && /^總計\s*\d+張訂單$/.test(number)) {
      if (index !== nonempty.length - 1 || ['產品SKU', '產品數量', '單價', '小計'].some((key) => !blank(row[key]))) issues.push(issue('INVALID_FOOTER', '總計列必須位於檔案最後且不得包含商品資料', { sourceRow: entry.sourceRow }));
      else footer = { ...entry, count: Number(number.match(/(\d+)張訂單/)[1]) };
      continue;
    }
    if (platform === 'Shopify' && !number) number = lastOrder;
    if (!number) { issues.push(issue('MISSING_ORDER_NUMBER', '商品列缺少來源訂單編號', { sourceRow: entry.sourceRow })); continue; }
    lastOrder = number;
    allOrderNumbers.add(number);
    if (!allowAllOrders && !allowed.has(number)) { excluded.add(number); excludedRows++; continue; }
    if (!grouped.has(number)) grouped.set(number, []);
    grouped.get(number).push(entry);
  }
  result.summary = { excludedOrderCount: excluded.size, excludedRowCount: excludedRows };
  if (excluded.size) issues.push(issue('ORDERS_EXCLUDED', `已排除 ${excluded.size} 筆未在授權清單的訂單`, {}, 'warning'));
  for (const number of allowed) if (!grouped.has(number)) issues.push(issue('ALLOWED_ORDER_MISSING', '來源檔缺少本次指定訂單', { orderNumber: number }));
  if (footer && footer.count !== allOrderNumbers.size) issues.push(issue('FOOTER_COUNT_MISMATCH', '總計訂單數與來源商品明細不符', { sourceRow: footer.sourceRow }));

  for (const [number, entries] of grouped) {
    const context = { orderNumber: number };
    const get = (key, required = false) => {
      const values = [...new Set(entries.map(({ data: row }) => text(row[key])).filter(Boolean))];
      if (values.length > 1) issues.push(issue('ORDER_FIELD_CONFLICT', `同一訂單的「${key}」不一致`, context));
      if (required && !values.length) issues.push(issue('MISSING_ORDER_VALUE', `訂單缺少「${key}」`, context));
      return values[0] || '';
    };
    const money = (value, field, extra = context, required = false) => {
      try {
        const amount = parseMoneyMinor(value);
        if (amount == null && required) issues.push(issue('MISSING_MONEY', `缺少「${field}」金額`, extra));
        if (amount != null && amount < 0) issues.push(issue('NEGATIVE_MONEY', `「${field}」不可用負數當待出貨商品`, extra));
        return amount;
      } catch { issues.push(issue('INVALID_MONEY', `「${field}」金額格式或精度無效`, extra)); return null; }
    };
    const orderMoney = (key, required = false) => money(get(key), key, context, required);
    const isOne = platform === '1Shop';
    const rawPaymentStatus = get(isOne ? '金流狀態' : 'Financial Status', true);
    const rawFulfillmentStatus = get(isOne ? '物流狀態' : 'Fulfillment Status', true);
    const order = {
      sourceOrderNumber: number, sourcePlatform: platform, sourceOrderId: isOne ? number : get('Id'), createdAt: get(isOne ? '建立日期' : 'Created at'),
      paymentStatus: status(rawPaymentStatus, platform), rawPaymentStatus, paymentMethod: get(isOne ? '金流' : 'Payment Method'),
      paymentNote: isOne && /過期|逾期|逾時|期限已過|超過.*期限/.test(get('金流備註')) ? '付款期限已過' : '',
      fulfillmentStatus: status(rawFulfillmentStatus, platform, true), rawFulfillmentStatus, orderStatus: isOne ? get('訂單狀態') : '',
      cancelled: isOne ? /取消/.test(get('訂單狀態')) : Boolean(get('Cancelled at')),
      salesPageName: isOne ? get('銷售頁名稱') : '', salesPagePrefix: isOne ? get('銷售頁編號前綴') : '',
      financial: isOne ? { subtotalMinor: orderMoney('訂單金額(不含金/物流手續費)', true), totalMinor: orderMoney('總計金額', true), shippingMinor: orderMoney('訂單運費', true), feeMinor: orderMoney('訂單金流手續費', true), taxMinor: null, discountMinor: null, refundedMinor: null, outstandingMinor: null, currency: null } : { subtotalMinor: orderMoney('Subtotal', true), totalMinor: orderMoney('Total', true), shippingMinor: orderMoney('Shipping', true), feeMinor: null, taxMinor: orderMoney('Taxes', true), discountMinor: orderMoney('Discount Amount', true), refundedMinor: orderMoney('Refunded Amount', true), outstandingMinor: orderMoney('Outstanding Balance'), currency: get('Currency', true) },
      itemIds: [],
    };
    result.orders.push(order);
    const seenIds = new Map();
    for (const { data: row, sourceRow } of entries) {
      const extra = { orderNumber: number, sourceRow };
      const qtyText = text(row[isOne ? '產品數量' : 'Lineitem quantity']);
      const quantity = /^\d+$/.test(qtyText) && Number.isSafeInteger(Number(qtyText)) && Number(qtyText) > 0 ? Number(qtyText) : null;
      if (quantity == null) issues.push(issue('INVALID_QUANTITY', '商品數量必須為正整數', extra));
      const rawSku = row[isOne ? '產品SKU' : 'Lineitem sku'];
      const sku = text(rawSku);
      const skuProblem = productIdentifierIssue(rawSku);
      if(skuProblem)issues.push(issue('INVALID_PRODUCT_IDENTIFIER',skuProblem,extra));
      const productName = text(row[isOne ? '產品' : 'Lineitem name']);
      if (!sku || !productName) issues.push(issue('MISSING_PRODUCT', '商品列缺少 SKU 或產品名稱', extra));
      const unitPriceMinor = money(row[isOne ? '單價' : 'Lineitem price'], '商品單價', extra, !isOne);
      const gross = quantity != null && unitPriceMinor != null ? quantity * unitPriceMinor : null;
      if (gross != null && !Number.isSafeInteger(gross)) issues.push(issue('MONEY_OVERFLOW', '商品總額超出可安全處理範圍', extra));
      const lineDiscountMinor = isOne ? null : money(row['Lineitem discount'], 'Lineitem discount', extra);
      const lineSubtotalMinor = isOne ? money(row['小計'], '商品小計', extra) : gross == null ? null : gross - (lineDiscountMinor ?? 0);
      const groupName = isOne ? text(row['名稱']) : '';
      const kind = isOne && unitPriceMinor == null && lineSubtotalMinor == null && blank(row['數量(單品/組合/任選)']) ? 'bundle_component' : 'single';
      const explicitLineId = text(row['來源明細號'] ?? row['Lineitem id'] ?? row['Lineitem ID']);
      const identity = [platform, number, sku, productName, groupName, quantity, unitPriceMinor, lineDiscountMinor, lineSubtotalMinor];
      const canonical = JSON.stringify(identity);
      const sourceLineId = explicitLineId || stableId(identity);
      if (seenIds.has(sourceLineId)) issues.push(issue(seenIds.get(sourceLineId) === canonical ? 'AMBIGUOUS_SOURCE_LINE' : 'SOURCE_LINE_ID_COLLISION', '來源明細識別重複或衝突；請提供唯一平台商品明細 ID，不要以重新排序列號代替', extra));
      seenIds.set(sourceLineId, canonical);
      const item = { id: stableId([platform, number, sourceLineId]), sourceLineId, sourceOrderNumber: number, sourceRow, sku, productName, groupName, groupId: groupName ? stableId([platform, number, groupName]) : '', kind, quantity, unitPriceMinor, lineSubtotalMinor, lineDiscountMinor, category: '', sourceLineIdOrigin: explicitLineId ? 'platform' : 'content', ...(isOne ? parseOneShopSku(sku) : null) };
      if (isOne && kind !== 'bundle_component' && (unitPriceMinor == null || lineSubtotalMinor == null)) issues.push(issue('MISSING_LINE_MONEY', '商品列缺少單價或小計，不能從相鄰列補價格', extra));
      if (isOne && gross != null && lineSubtotalMinor != null && gross !== lineSubtotalMinor) issues.push(issue('LINE_AMOUNT_MISMATCH', '數量乘單價與商品小計不符；請確認折扣及組合數量', extra));
      result.items.push(item); order.itemIds.push(item.id);
    }
    const items = result.items.filter((item) => item.sourceOrderNumber === number);
    for (const component of items.filter((item) => item.kind === 'bundle_component')) {
      const anchors = items.filter((item) => item.groupId === component.groupId && item.unitPriceMinor != null && item.lineSubtotalMinor != null);
      if (!component.groupName || component.groupName === '一般品' || anchors.length !== 1) issues.push(issue('AMBIGUOUS_BUNDLE', '空白價格商品無法唯一對應組合主商品，不能假設為零元', { ...context, sourceRow: component.sourceRow }));
      else { anchors[0].kind = 'bundle_anchor'; issues.push(issue('BUNDLE_ALLOCATION_REQUIRED', '組合元件價格空白；須確認由主商品承擔金額、此元件以零元入帳且照數量出貨', { ...context, sourceRow: component.sourceRow }, 'confirmation')); }
    }
    const f = order.financial;
    if (isOne) {
      if ([f.subtotalMinor, f.shippingMinor, f.feeMinor, f.totalMinor].every((n) => n != null) && f.subtotalMinor + f.shippingMinor + f.feeMinor !== f.totalMinor) issues.push(issue('ORDER_TOTAL_MISMATCH', '商品訂單金額＋運費＋金流手續費與總計不符', context));
      const knownLines = sum(items.map((i) => i.lineSubtotalMinor ?? 0));
      if (f.subtotalMinor != null && knownLines !== f.subtotalMinor) issues.push(issue('ITEM_SUBTOTAL_MISMATCH', '已知商品小計無法對應訂單商品金額；不可用訂單總額倒推單價', context));
    } else {
      const gross = sum(items.map((i) => (i.unitPriceMinor ?? 0) * (i.quantity ?? 0)));
      if ([f.shippingMinor, f.taxMinor, f.discountMinor, f.totalMinor].every((n) => n != null) && gross + f.shippingMinor + f.taxMinor - f.discountMinor !== f.totalMinor) issues.push(issue('ORDER_TOTAL_MISMATCH', '商品原額＋運費＋稅－整單折扣與總計不符，須核對原平台金額', context));
      if (f.subtotalMinor != null && sum(items.map((i) => i.lineSubtotalMinor ?? 0)) !== f.subtotalMinor) issues.push(issue('DISCOUNT_ALLOCATION_REQUIRED', '整單折扣尚未完整分攤至商品，不能自行平均或重複扣折扣', context, 'confirmation'));
      if (f.subtotalMinor != null && f.shippingMinor != null && f.taxMinor != null && f.totalMinor != null && f.subtotalMinor + f.shippingMinor + f.taxMinor !== f.totalMinor) issues.push(issue('SHIPPING_DISCOUNT_ALLOCATION_REQUIRED', '運費可能含折抵，須先取得運費折扣分攤再輸出 ECOUNT', context, 'confirmation'));
    }
    if (order.paymentStatus !== 'paid') issues.push(issue('UNPAID_ORDER', '付款狀態未證實已付；測試轉檔不會變更付款或允許正式出貨', context, 'warning'));
  }
  if (footer && !excluded.size) {
    for (const [column, field] of [['訂單金額(不含金/物流手續費)', 'subtotalMinor'], ['訂單運費', 'shippingMinor'], ['總計金額', 'totalMinor']]) {
      try {
        const value = parseMoneyMinor(footer.data[column]);
        if (value != null && result.orders.every((o) => o.financial[field] != null) && value !== sum(result.orders.map((o) => o.financial[field]))) issues.push(issue('FOOTER_AMOUNT_MISMATCH', `總計列「${column}」與訂單合計不符`, { sourceRow: footer.sourceRow }));
      } catch { issues.push(issue('INVALID_FOOTER_MONEY', '總計列金額格式無效', { sourceRow: footer.sourceRow })); }
    }
  }
  return finish();
}

export function productIdentifierIssue(value) {
  const code = text(value);
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(code)) return `貨號「${code}」已變成科學記號，無法確認完整品號。請重新下載平台原始訂單檔，勿用 Excel 另存 CSV。`;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '商品編碼超出數字精度，請改用保留完整品號的文字欄位';
  return '';
}

// Internal labels are explicit warehouse identities; they never fill EAN.
export function mappingScanCode(mapping={}) {
  if(mapping.scanCodeType==='internal')return mapping.internalScanConfirmed===true&&!text(mapping.barcode)?text(mapping.internalScanCode):'';
  return mapping.barcodeConfirmed===true||(mapping.confirmed===true&&mapping.barcodeConfirmed!==false)?text(mapping.barcode):'';
}
export function mappingScanIdentity(mapping={}) {
  const scan=mappingScanCode(mapping),internal=mapping.scanCodeType==='internal';
  return {barcode:scan,internationalBarcode:internal?null:scan||null,internalScanCode:internal?scan||null:null,codeType:internal?'internal':'international'};
}

function mappingIssues(parsed, settings, requireBarcode = true) {
  const issues = [];
  for (const sku of new Set(parsed.items.map((item) => item.sku))) {
    const m = settings.skuMappings?.[sku];
    for(const value of [sku,m?.erpSku,m?.barcode,m?.internalScanCode]){const problem=productIdentifierIssue(value);if(problem)issues.push(issue('INVALID_PRODUCT_IDENTIFIER',problem,{sku}));}
    if (!(m?.erpConfirmed === true || m?.confirmed === true) || !text(m?.erpSku)) issues.push(issue('PRODUCT_MAPPING_REQUIRED', `SKU ${sku} 必須確認 ERP 品項編碼`, { sku }));
    if (requireBarcode && !mappingScanCode(m)) issues.push(issue('BARCODE_MAPPING_REQUIRED', `SKU ${sku} 的實物條碼尚未確認，不可用 SKU 自行代替`, { sku }));
  }
  return issues;
}

export function validateMarketplaceExport(parsed, settings = {}) {
  settings=normalizeMarketplaceSettings(parsed,settings);
  const issues = [...(parsed.issues || []).filter((i) => i.severity === 'error'), ...mappingIssues(parsed, settings, false)];
  const rounded=parsed.orders?.some(o=>Number.isSafeInteger(o.financial?.totalMinor)&&o.financial.totalMinor%100!==0);
  if(settings.salesExportMode&&!['order-lines-v1',ECOUNT_GROUPED_MODE].includes(settings.salesExportMode))issues.push(issue('EXPORT_MODE_INVALID','銷貨彙總設定無效'));
  if (!parsed.items?.length) issues.push(issue('EMPTY_INTAKE', '沒有可轉換的商品明細'));
  for (const [key, label] of [['store', '店鋪'], ['customerCode', 'ECOUNT 客戶碼'], ['warehouseCode', '發貨倉庫'], ['batchSequence', '銷貨分組序號']]) if (!text(settings[key])) issues.push(issue('SETTING_REQUIRED', `請填寫並確認${label}`, { field: key }));
  if (!/^\d{1,4}$/.test(text(settings.batchSequence)) || !Number.isSafeInteger(Number(settings.batchSequence)) || Number(settings.batchSequence) <= 0) issues.push(issue('INVALID_BATCH_SEQUENCE', '銷貨分組序號必須是 1 至 9999 的正整數'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(settings.date)) || Number.isNaN(Date.parse(`${settings.date}T00:00:00Z`)) || new Date(`${settings.date}T00:00:00Z`).toISOString().slice(0, 10) !== settings.date) issues.push(issue('DATE_REQUIRED', '請指定有效的銷貨日期'));
  if (settings.currency !== 'TWD') issues.push(issue('CURRENCY_REQUIRED', '本次 ECOUNT 轉檔僅支援明確確認的 TWD'));
  if ((!/^(?:WMS|TEST)-[A-Za-z0-9-]+$/.test(text(settings.batchNumber)) || text(settings.batchNumber).length>20)) issues.push(issue('BATCH_NUMBER_REQUIRED', '請填寫 WMS- 或 TEST- 開頭、最長 20 字的唯一銷貨追蹤號；仍須在 ERP 確認未重複使用'));
  if (!settings.taxConfirmed || settings.taxMode !== 'erp_inclusive' || text(settings.taxType) !== '11') issues.push(issue('TAX_SETTING_REQUIRED', '請確認 ECOUNT 營業稅交易類型 11，含稅 5%，轉檔明確列出稅前金額及營業稅'));
  for (const [key,label] of [['erpStaffCode','承辦人'],['erpProjectCode','專案']]) if(text(settings[key])&&settings.erpResponsibilityConfirmed!==true) issues.push(issue('ERP_RESPONSIBILITY_REQUIRED', `請確認 ECOUNT ${label}編碼；不能直接使用 WMS 登入帳號`,{field:key}));
  if (text(settings.erpCurrencyCode) && settings.erpCurrencyConfirmed !== true) issues.push(issue('ERP_CURRENCY_REQUIRED', 'ECOUNT 貨幣代碼須另行確認；來源 TWD 不代表 ERP 主檔代碼'));
  for (const i of (parsed.issues || []).filter((i) => i.severity === 'confirmation')) {
    if (i.code !== 'BUNDLE_ALLOCATION_REQUIRED' || settings.bundleZeroConfirmed !== true) issues.push({ ...i, severity: 'error' });
  }
  for (const order of parsed.orders || []) {
    const context = { orderNumber: order.sourceOrderNumber };
    if (order.cancelled || !['unfulfilled'].includes(order.fulfillmentStatus) || !['paid', 'pending'].includes(order.paymentStatus) || (order.financial.refundedMinor ?? 0) > 0) issues.push(issue('ORDER_NOT_ELIGIBLE', '取消、退款、已履行或狀態不明訂單不能由此測試轉檔出貨', context));
    if (order.paymentStatus !== 'paid' && settings.pendingTestAcknowledged !== true) issues.push(issue('PENDING_TEST_ACK_REQUIRED', '請確認這是未付款訂單的限定測試，不代表已收款或正式放行', context));
    if (order.financial.currency && order.financial.currency !== settings.currency) issues.push(issue('CURRENCY_MISMATCH', '來源幣別與匯出設定不符', context));
    if ((order.financial.feeMinor ?? 0) !== 0) issues.push(issue('FEE_MAPPING_REQUIRED', '本次尚未設定金流手續費專用品項，不能漏列或併入商品', context));
    if ((order.financial.shippingMinor ?? 0) > 0 && (!settings.shippingSku?.confirmed || !settings.shippingSku?.nonStock || !text(settings.shippingSku?.erpSku))) issues.push(issue('SHIPPING_MAPPING_REQUIRED', '有運費時，須確認 ECOUNT 運費品項為非庫存／數量管理除外', context));
    for (const item of parsed.items.filter((i) => i.sourceOrderNumber === order.sourceOrderNumber)) {
      const amount = item.kind === 'bundle_component' && settings.bundleZeroConfirmed ? 0 : item.lineSubtotalMinor;
      if (amount == null) issues.push(issue('UNRESOLVED_LINE_MONEY', '商品金額仍未確認', { ...context, sourceRow: item.sourceRow }));
      else if (!rounded && settings.salesExportMode!==ECOUNT_GROUPED_MODE && item.quantity && amount % item.quantity !== 0) issues.push(issue('UNIT_PRICE_PRECISION', '商品淨額無法以兩位小數單價精確分配；須先確認 ECOUNT 精度及分攤方式', { ...context, sourceRow: item.sourceRow }));
    }
  }
  for (const sku of new Set(parsed.items.map((item) => item.sku))) {
    const m = settings.skuMappings?.[sku];
    if (!mappingScanCode(m)) issues.push(issue('BARCODE_UNCONFIRMED', `SKU ${sku} 條碼待確認；ECOUNT 銷貨檔不含條碼，之後 WMS 作業前仍須核對`, { sku }, 'warning'));
  }
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

const REPORT_HEADERS = ['平台', '店鋪', '商城訂單編號', '付款狀態', '付款方式', '付款期限提示', '履行狀態', '商品列數', '商品件數', '商品金額', '運費', '金流手續費', '稅額（來源）', '折扣（來源）', '訂單總額（非實收）', '退款（來源）', '未收餘額（來源）', '來源銷售頁', '來源銷售頁前綴', '購物金折抵（來源）', '點數折現（來源）', '自訂折扣（來源）', '附加費（來源）'];

function financialReportRow(parsed, order, settings, exactMoney = false) {
  const items = parsed.items.filter((item) => item.sourceOrderNumber === order.sourceOrderNumber);
  const f = order.financial;
  const moneyCell = (value) => value == null ? '' : exactMoney ? formatMinor(value) : value / 100;
  return [order.sourcePlatform, text(settings.store), order.sourceOrderNumber, order.rawPaymentStatus, order.paymentMethod, order.paymentNote, order.rawFulfillmentStatus, items.length, sum(items.map((i) => i.quantity)), moneyCell(f.subtotalMinor), moneyCell(f.shippingMinor), moneyCell(f.feeMinor), moneyCell(f.taxMinor), moneyCell(f.discountMinor), moneyCell(f.totalMinor), moneyCell(f.refundedMinor), moneyCell(f.outstandingMinor), order.salesPageName, order.salesPagePrefix, moneyCell(f.creditMinor), moneyCell(f.pointsMinor), moneyCell(f.customDiscountMinor), moneyCell(f.surchargeMinor)];
}

export function buildMarketplaceAuditRows(parsed, settings = {}) {
  const issues = [...(parsed.issues || []).filter((i) => i.severity === 'error')];
  return { ok: issues.length === 0, issues, headers: [...REPORT_HEADERS, '核對狀態'], rows: issues.length ? [] : parsed.orders.map((order) => [...financialReportRow(parsed, order, settings,Object.values(order.financial).some(v=>Number.isSafeInteger(v)&&v%100!==0)), '待核對；訂單總額不是實收，不是出貨授權或 ERP／WMS 匯入檔']), summary: { ...parsed.summary } };
}

export function buildEcountRows(parsed, settings = {}) {
  settings=normalizeMarketplaceSettings(parsed,settings);
  const validation = validateMarketplaceExport(parsed, settings);
  const result = { ...validation, headers: [...ECOUNT_HEADERS], rows: [], reportHeaders: [...REPORT_HEADERS], reportRows: [], summary: { ...parsed.summary } };
  if (!validation.ok) return result;
  const rounded=parsed.orders.some(o=>o.financial.totalMinor%100!==0);
  let allocation;
  try{allocation=wholeTwdSourceAmounts(parsed,{roundOrders:rounded});}catch(e){result.ok=false;result.issues.push(issue('TWD_ALLOCATION_INVALID',e.message));return result;}
  if(rounded){result.rounding=allocation.rounding;result.reportHeaders.push('ECOUNT含稅銷貨金額','整元尾差（ERP減來源）');}
  const emitted = new Map();
  const rowFor = (order, item, mapping, amount, shipping = false) => {
    amount=allocation.amounts.get(JSON.stringify([order.sourcePlatform,order.sourceOrderNumber,item.sourceLineId]));
    emitted.set(order.sourceOrderNumber, (emitted.get(order.sourceOrderNumber) || 0) + amount);
    const row = Array(27).fill('');
    const tax=calculateInclusiveTax(amount,item.quantity);
    const put = { 0: settings.date.replaceAll('-', ''), 1: Number(settings.batchSequence), 2: text(settings.customerCode), 3: text(settings.customerName), 4:text(settings.erpStaffCode), 5:text(settings.erpProjectCode), 6: text(settings.warehouseCode), 7: text(settings.taxType), 8: text(settings.erpCurrencyCode), 10: text(settings.batchNumber), 11: text(mapping.erpSku), 12: order.sourceOrderNumber, 13: order.sourcePlatform, 14: text(settings.store), 15: item.sourceLineId, 16: text(mapping.erpName || mapping.name || item.productName), 18: text(mapping.spec), 19: item.quantity, 20:tax.netUnitMinor/100, 21:roundRatio(amount,item.quantity)/100, 23:tax.netMinor/100, 24:tax.taxMinor/100, 25:text(settings.summaryNote) };
    for (const [index, value] of Object.entries(put)) row[Number(index)] = value;
    return row;
  };
  for (const order of parsed.orders) {
    const items = parsed.items.filter((i) => i.sourceOrderNumber === order.sourceOrderNumber);
    for (const item of items) result.rows.push(rowFor(order, item, settings.skuMappings[item.sku], item.kind === 'bundle_component' ? 0 : item.lineSubtotalMinor));
    if (order.financial.shippingMinor > 0) result.rows.push(rowFor(order, { quantity: 1, sourceLineId: stableId([order.sourcePlatform, order.sourceOrderNumber, 'shipping']), productName: '運費（非庫存）' }, settings.shippingSku, order.financial.shippingMinor, true));
    const f = order.financial;
    const target=allocation.orderTotals.get(JSON.stringify([order.sourcePlatform,order.sourceOrderNumber]));
    result.reportRows.push([...financialReportRow(parsed, order, settings, rounded),...(rounded?[formatMinor(target),formatMinor(target-f.totalMinor)]:[])]);
    if (emitted.get(order.sourceOrderNumber) !== target) result.issues.push(issue('ECOUNT_ROUNDTRIP_MISMATCH', 'ECOUNT 商品／運費及稅額合計與訂單銷貨目標金額不符，請調整經確認的稅制或分攤', { orderNumber: order.sourceOrderNumber }));
  }
  result.ok = !result.issues.some((i) => i.severity === 'error');
  if (!result.ok) { result.rows = []; result.reportRows = []; }
  else result.summary = { ...result.summary, financialVersion:rounded?ECOUNT_ROUNDING_FINANCIAL_VERSION:ECOUNT_FINANCIAL_VERSION,ecountNetMinor:sum(result.rows.map(r=>parseMoneyMinor(r[23]))),ecountTaxMinor:sum(result.rows.map(r=>parseMoneyMinor(r[24]))),ecountRowCount: result.rows.length, sourceTotalMinor:sum(parsed.orders.map(o=>o.financial.totalMinor)),ecountTotalMinor: sum([...emitted.values()]),roundingDeltaMinor:rounded?allocation.rounding.roundingDeltaMinor:0, physicalItemCount: parsed.items.length, physicalQuantity: sum(parsed.items.map((i) => i.quantity)) };
  if(result.ok&&settings.salesExportMode===ECOUNT_GROUPED_MODE){
    try{
      const exportView=prepareEcountFinancials({...result,settings,items:parsed.items,orders:parsed.orders});
      result.salesLayout=exportView.salesLayout;
      result.summary={...result.summary,ecountRowCount:exportView.rows.length,ecountNetMinor:exportView.financials.netMinor,ecountTaxMinor:exportView.financials.taxMinor,salesExportMode:ECOUNT_GROUPED_MODE};
    }catch(e){result.ok=false;result.issues.push(issue('AGGREGATION_INVALID',e.message));result.rows=[];result.reportRows=[];}
  }
  return result;
}

export function warehouseProductDetails(item = {}, mapping = {}) {
  return {
    productName: text(item.productName) || text(mapping.erpName || mapping.name),
    erpName: text(mapping.erpName || mapping.name),
    spec: text(mapping.spec),
  };
}

// Old snapshots keep their quantities and identifiers. Only their warehouse
// presentation is rebuilt from the effective order lines saved in that batch.
export function warehousePrepickDetails(prepick, items = [], skuMappings = {}) {
  const headers = [...(prepick?.headers || [])];
  const skuIndex = headers.indexOf('來源SKU'), nameIndex = headers.indexOf('商品名稱');
  if (skuIndex < 0 || nameIndex < 0) return prepick;
  const addColumn = label => {
    const existing = headers.indexOf(label);
    return existing < 0 ? headers.push(label) - 1 : existing;
  };
  const erpNameIndex = addColumn('ECOUNT品項名稱'), specIndex = addColumn('規格');
  const names = new Map();
  for (const item of items) {
    const sku = text(item.sku), name = text(item.productName);
    if (!name) continue;
    if (!names.has(sku)) names.set(sku, new Set());
    names.get(sku).add(name);
  }
  const rows = (prepick.rows || []).map((row, index) => {
    const next = [...row], sku = text(row[skuIndex]), savedSkus = prepick.sourceSkuGroups?.[index];
    // Exact old source keys win. New grouped cells use newline-separated full
    // campaign SKUs; each fallback entry must still be an exact known source.
    const knownSource = value => typeof value === 'string' && (names.has(value) || Object.hasOwn(skuMappings, value));
    const parts = sku.split('\n');
    let skus = [sku];
    if (Array.isArray(savedSkus) && savedSkus.length && savedSkus.join('\n') === sku && savedSkus.every(knownSource)) skus = savedSkus;
    else if (!knownSource(sku) && parts.every(knownSource)) skus = parts;
    const details = warehouseProductDetails({}, skuMappings[skus[0]] || {});
    const sourceNames = [...new Set(skus.flatMap(value => [...(names.get(value) || [])]))];
    next[nameIndex] = sourceNames.length ? sourceNames.join('\n') : text(row[nameIndex]) || details.productName;
    next[erpNameIndex] = details.erpName;
    next[specIndex] = details.spec;
    return next;
  });
  return { ...prepick, headers, rows };
}

export function buildPrepickRows(parsed, settings = {}) {
  const hasInternal=Object.values(settings.skuMappings||{}).some(m=>m.scanCodeType==='internal');
  const preview = settings.preview === true;
  const issues = [...(parsed.issues || []).filter((i) => i.severity === 'error'), ...(preview ? [] : mappingIssues(parsed, settings))];
  if (!preview && parsed.orders.some((o) => o.paymentStatus !== 'paid') && settings.pendingTestAcknowledged !== true) issues.push(issue('PENDING_TEST_ACK_REQUIRED', '未付款訂單預揀表僅供明確確認的限定測試'));
  if (!preview && parsed.orders.some((o) => o.cancelled || o.fulfillmentStatus !== 'unfulfilled' || !['paid', 'pending'].includes(o.paymentStatus) || (o.financial.refundedMinor ?? 0) > 0)) issues.push(issue('ORDER_NOT_ELIGIBLE', '此檔包含不能出貨的訂單狀態'));
  const result = { ok: issues.length === 0, issues, headers: ['分類（對照設定）', '來源SKU', 'ECOUNT品項編碼', hasInternal?'商品掃描碼':preview ? '商品條碼（確認後顯示）' : '已確認國際條碼', '商品名稱', '實體數量', '商城訂單數', '來源商城訂單', '來源組合／分組', '用途', 'ECOUNT品項名稱', '規格', '來源團組名稱', '來源團次', ...(hasInternal?['掃描碼類型','國際條碼','內部掃描碼']:[])], rows: [], sourceSkuGroups: [], summary: { ...parsed.summary } };
  if (!result.ok) return result;
  const groups = new Map();
  for (const item of parsed.items) {
    const m = settings.skuMappings?.[item.sku] || {};
    const barcodeConfirmed = Boolean(mappingScanCode(m));
    const erpConfirmed = !!text(m.erpSku) && (m.erpConfirmed === true || m.confirmed === true);
    const key = JSON.stringify(item.sourceSkuFormat && barcodeConfirmed && erpConfirmed ? ['product', m.erpSku, mappingScanCode(m), m.scanCodeType||'international', text(m.spec), text(m.category)] : ['source', item.sku, m.erpSku, mappingScanCode(m)]);
    if (!groups.has(key)) groups.set(key, { item, mapping: m, quantity: 0, orders: new Set(), groups: new Set(), skus: new Set(), campaigns: new Map() });
    const group = groups.get(key);
    group.quantity += item.quantity; group.orders.add(item.sourceOrderNumber); group.skus.add(item.sku);
    if (item.groupName) group.groups.add(item.groupName);
    if (item.campaignGroupName && item.campaignRound) group.campaigns.set(JSON.stringify([item.campaignGroupName, item.campaignRound]), [item.campaignGroupName, item.campaignRound]);
  }
  result.rows = [...groups.values()].map(({ item, mapping: m, quantity, orders, groups: sourceGroups, skus, campaigns }) => {
    const barcodeConfirmed = Boolean(mappingScanCode(m));
    const sourceSkus = [...skus].sort(), sourceCampaigns = [...campaigns].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
    result.sourceSkuGroups.push(sourceSkus);
    return [text(m.category) || '未分類', sourceSkus.join('\n'), text(m.erpSku), barcodeConfirmed ? mappingScanCode(m) : '', text(m.erpName || item.productName), quantity, orders.size, [...orders].sort().join(' / '), [...sourceGroups].sort().join(' / '), preview ? `待核對${!mappingScanCode(m) || !barcodeConfirmed ? '；條碼未確認' : ''}；不是出貨授權或 ERP／WMS 匯入檔` : '測試預揀；不是 ECOUNT／WMS 匯入檔', '', '', sourceCampaigns.map(value => value[0]).join('\n'), sourceCampaigns.map(value => value[1]).join('\n'), ...(hasInternal?[m.scanCodeType==='internal'?'內部掃描碼':'國際條碼', m.scanCodeType==='internal'?'':mappingScanCode(m), m.scanCodeType==='internal'?mappingScanCode(m):'']:[])];
  });
  result.summary = { ...result.summary, skuCount: result.rows.length, physicalQuantity: sum(result.rows.map((r) => r[5])) };
  return warehousePrepickDetails(result, parsed.items, settings.skuMappings);
}
