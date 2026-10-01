import { productIdentifierIssue, parseMarketplaceRows, parseMoneyMinor, buildEcountRows, buildMarketplaceAuditRows, buildPrepickRows, normalizeMarketplaceSettings } from './marketplaceIntake.mjs';

export const MARKETPLACE_ROLES = ['dispatcher', 'admin', 'superadmin'];
export const TEST_ORDER_NUMBERS = ['TST6091550133', 'TST6091550109'];
const t = value => value == null ? '' : String(value).trim();
const norm = value => t(value).replace(/^\uFEFF/, '').replace(/\s+/g, ' ').toLowerCase();
const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'MARKETPLACE_INVALID' }); };
const addIssue = (code, message, orderNumber) => ({ code, message, orderNumber, severity: 'error' });
const ONE_FIELDS = ['訂單編號','建立日期','訂單狀態','名稱','產品SKU','產品','產品數量','數量(單品/組合/任選)','單價','小計','訂單金額(不含金/物流手續費)','訂單金流手續費','訂單運費','總計金額','金流','金流狀態','金流備註','物流狀態','銷售頁名稱','銷售頁編號前綴','來源明細號','顧客','顧客電話','電話國碼','物流','物流備註','運送地址','方便收貨時間','運送超商','超商代號','門市名稱','託運單號'];
const SHOPIFY_FIELDS = ['Name','Id','Created at','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount','Outstanding Balance','Payment Method','Cancelled at','Lineitem quantity','Lineitem name','Lineitem price','Lineitem sku','Lineitem discount','Lineitem id','Lineitem requires shipping','Lineitem fulfillment status','Shipping Name','Shipping Phone','Shipping Street','Shipping Address1','Shipping Address2','Shipping City','Shipping Zip','Shipping Province','Shipping Country','Shipping Company','Shipping Method'];
// SHOPLINE's report columns are selectable. These are explicit aliases, not
// fuzzy matches; missing/ambiguous money columns stop conversion.
const SL_FIELDS = {
  '訂單號碼':['訂單號碼','訂單編號'], '商品貨號':['商品貨號','SKU'], '商品名稱':['商品名稱'],
  '數量':['數量','商品數量'], '單價':['單價','商品單價'], '付款狀態':['付款狀態'],
  '送貨狀態':['送貨狀態','出貨狀態'], '付款方式':['付款方式'], '訂單狀態':['訂單狀態'],
  '訂單小計':['訂單小計'], '運費':['運費'], '優惠折扣':['優惠折扣','折扣金額'],
  '訂單合計':['訂單合計','訂單總計','訂單總金額'], '稅費':['稅費','稅額'],
  '貨幣':['貨幣','幣別'], '退款金額':['退款金額'], '商品折扣金額':['商品折扣金額'],
  '訂單日期':['訂單日期'], '商品明細編號':['商品明細編號'], '商品類型':['商品類型'],
  '商品結帳價':['商品結帳價'], '已退款金額':['已退款金額'],
  ...Object.fromEntries(['收件人','完整地址','收件人電話號碼','送貨方式','出貨備註','門市名稱','送貨編號','全家服務編號 / 7-11 店號'].map(k=>[k,[k]])),
  '郵政編號（如適用)':['郵政編號（如適用)','郵政編號（如適用）'],
  ...Object.fromEntries(['全單折扣金額','折抵購物金分攤','點數折現分攤','自訂折扣合計','折抵購物金','點數折現','附加費','訂單標籤','合作夥伴','推薦代碼','選項','加購品類型'].map(k=>[k,[k]])),
};
const SL_REQUIRED = ['訂單號碼','商品貨號','商品名稱','數量','單價','付款狀態','送貨狀態','付款方式','訂單狀態','訂單小計','運費','優惠折扣','訂單合計'];
export const SHOPLINE_REQUIRED_FIELDS = [...SL_REQUIRED];

// Detect headers independently of row validation so damaged order sheets are
// still offered for selection and report their actual error when parsed.
export function detectMarketplaceHeaders(input) {
  const candidates = [];
  for (let i=0;i<Math.min(10,input.length);i++) {
    const names = input[i].map(norm);
    const has = name => names.includes(norm(name));
    if (has('Name') && has('Lineitem quantity') && has('Lineitem sku')) candidates.push({platform:'Shopify',index:i});
    if (has('訂單編號') && has('產品SKU') && has('產品數量')) candidates.push({platform:'1Shop',index:i});
    if ((has('訂單號碼') || has('訂單編號')) && has('商品貨號') && has('商品名稱')) candidates.push({platform:'SHOPLINE',index:i});
  }
  return candidates;
}

export function inspectMarketplaceRows(input) {
  if (!Array.isArray(input) || !input.length || input.length > 5000) fail('原始訂單檔須為 1 至 5,000 列');
  if (input.some(r => !Array.isArray(r) || r.length > 200)) fail('原始檔最多 200 欄');
  const candidates = detectMarketplaceHeaders(input);
  if (candidates.length !== 1) fail(candidates.length ? '檔案含多組平台表頭，請分開匯出後再選檔' : '無法辨識原始訂單格式。請使用 1Shop 訂單 Excel、Shopify 訂單 CSV 或 SHOPLINE 訂單報表；不要上傳彙總表或 ECOUNT 銷貨檔。');
  const {platform,index} = candidates[0], header = input[index].map(norm);
  const nonempty = header.filter(Boolean);
  if (new Set(nonempty).size !== nonempty.length) fail('原始檔含重複欄名，請核對後重新匯出');
  const aliases = platform === 'SHOPLINE' ? SL_FIELDS : Object.fromEntries((platform === '1Shop' ? ONE_FIELDS : SHOPIFY_FIELDS).map(k=>[k,[k]]));
  const columns = [];
  for (const [name,names] of Object.entries(aliases)) {
    const matches = header.flatMap((h,i)=>names.some(n=>norm(n)===h)?[i]:[]);
    if (matches.length>1) fail(`欄位「${name}」有多個可能來源，請只保留一欄`);
    if (matches.length) columns.push([name,matches[0]]);
  }
  if (platform==='SHOPLINE') {
    const missing=SL_REQUIRED.filter(k=>!columns.some(([name])=>name===k||(k==='單價'&&name==='商品結帳價')));
    if(missing.length) fail(`SHOPLINE 訂單報表缺少：${missing.join('、')}。請在平台匯出設定加入這些欄位。`);
    if(columns.some(([name])=>name==='商品結帳價')){
      if(columns.some(([name])=>name==='單價'))fail('SHOPLINE 同時包含單價與商品結帳價，請確認使用原生訂單報表');
      const nativeRequired=['已退款金額','貨幣','稅費','附加費','自訂折扣合計','折抵購物金','點數折現','商品折扣金額','全單折扣金額','折抵購物金分攤','點數折現分攤','商品類型'];
      const absent=nativeRequired.filter(k=>!columns.some(([name])=>name===k));
      if(absent.length)fail(`SHOPLINE 原生報表缺少核對欄位：${absent.join('、')}。請勾選後重新匯出。`);
    }
  }
  const rows=[columns.map(([name])=>name),...input.slice(index+1).map(row=>columns.map(([name,col])=>{
    const value=row[col]??'';
    if(['產品SKU','Lineitem sku','商品貨號'].includes(name)){const problem=productIdentifierIssue(value);if(problem)fail(problem);}
    if(!['string','number','boolean'].includes(typeof value) || (typeof value==='number'&&!Number.isFinite(value)) || String(value).length>5000) fail('來源儲存格格式或長度無效');
    // Keep only the safe expiry signal, not free-form payment references.
    return name==='金流備註' ? (/過期|逾期|逾時|期限已過|超過.*期限/.test(String(value))?'交易逾時':'') : value;
  }))];
  return {platform,rows};
}
const paymentStatus = raw => {
  const v=t(raw).toLowerCase();
  if(/部分/.test(v))return 'unknown';
  if(/退款|refunded/.test(v))return 'refunded';
  if(/未付款|待付款|付款中|等待|尚未|失敗|逾期|過期/.test(v))return 'pending';
  if(/已付款|付款完成|付款成功|已收款/.test(v))return 'paid';
  return ['paid','pending','refunded','partially_refunded'].includes(v)?v:'unknown';
};
const fulfillmentStatus = raw => {
  const v=t(raw).toLowerCase();
  if(/取消/.test(v))return 'cancelled';
  if(/未出貨|待出貨|等待出貨|備貨中|尚未出貨/.test(v))return 'unfulfilled';
  if(/部分/.test(v))return 'partial';
  if(/已出貨|已發貨|已送達|已到達|已取貨|已完成/.test(v))return 'fulfilled';
  return ['unfulfilled','fulfilled','partial'].includes(v)?v:'unknown';
};
function parseShopline(rows) {
  const records=rows.slice(1).filter(r=>r.some(v=>t(v))).map(r=>Object.fromEntries(rows[0].map((k,i)=>[k,r[i]??''])));
  if(rows[0].includes('商品結帳價'))return parseNativeShopline(records);
  let last='';
  const normalized=records.map(r=>{
    const number=t(r['訂單號碼'])||last;last=number;
    return {Name:number,'Lineitem sku':r['商品貨號'],'Lineitem name':r['商品名稱'],'Lineitem quantity':r['數量'],'Lineitem price':r['單價'],'Lineitem discount':r['商品折扣金額']??'',
      'Financial Status':t(r['付款狀態'])?paymentStatus(r['付款狀態']):'', 'Fulfillment Status':t(r['送貨狀態'])?fulfillmentStatus(r['送貨狀態']):'',
      'Payment Method':r['付款方式'], 'Cancelled at':/取消/.test(t(r['訂單狀態']))?'cancelled':'', Currency:r['貨幣']??'',
      Subtotal:r['訂單小計'],Shipping:r['運費'],Total:r['訂單合計'],Taxes:r['稅費']??'0','Discount Amount':r['優惠折扣'],
      'Refunded Amount':r['退款金額']??'0','Lineitem id':r['商品明細編號']??'','Created at':r['訂單日期']??''};
  });
  // Currency must be explicit in the file or later confirmed as TWD in settings.
  normalized.forEach(r=>{if(!t(r.Currency))r.Currency='TWD';});
  const parsed=parseMarketplaceRows(normalized,{platform:'Shopify',allowAllOrders:true});
  parsed.platform='SHOPLINE';
  for(const order of parsed.orders){
    order.sourcePlatform='SHOPLINE';
    const r=records.find(r=>t(r['訂單號碼'])===order.sourceOrderNumber)||{};
    order.rawPaymentStatus=t(r['付款狀態']);order.rawFulfillmentStatus=t(r['送貨狀態']);order.orderStatus=t(r['訂單狀態']);
    if(!rows[0].includes('貨幣'))order.financial.currency=null;
    if(!rows[0].includes('退款金額'))order.financial.refundedMinor=null;
    if(!rows[0].includes('稅費'))order.financial.taxMinor=null;
    const matched=parsed.items.filter(i=>i.sourceOrderNumber===order.sourceOrderNumber);
    matched.forEach(i=>{i.id='SL-'+i.id;i.sourceLineId='SL-'+i.sourceLineId;});order.itemIds=matched.map(i=>i.id);
    // SHOPLINE may export bundle headers and components. Missing SKUs/prices
    // remain errors; do not count bundle headers as additional physical goods.
    if(records.some(r=>t(r['訂單號碼'])===order.sourceOrderNumber&&/組合|子商品/.test(t(r['商品類型']))))parsed.issues.push(addIssue('SHOPLINE_BUNDLE_REVIEW','SHOPLINE 組合商品須用實際匯出核對主／子商品結構，暫不自動轉銷貨',order.sourceOrderNumber));
  }
  return parsed;
}

// Native SHOPLINE exports subtotal before order discounts and provides the
// actual allocation on each product row. Preserve those allocations, including
// credits/points; never infer a new discount from the final order total.
function parseNativeShopline(records){
  const groups=new Map(), issues=[], metadata=new Map(), normalized=[];
  let last='';
  for(const r of records){const number=t(r['訂單號碼'])||last;last=number;
    if(!number)fail('SHOPLINE 商品列缺少訂單號碼');
    if(!groups.has(number))groups.set(number,[]);groups.get(number).push(r);
  }
  for(const [number,lines] of groups){
    const problem=(code,message)=>issues.push(addIssue(code,message,number));
    const get=(key,required=false)=>{
      const values=[...new Set(lines.map(r=>t(r[key])).filter(Boolean))];
      if(values.length>1)problem('ORDER_FIELD_CONFLICT',`同一訂單的「${key}」不一致`);
      if(required&&!values.length)problem('MISSING_ORDER_VALUE',`訂單缺少「${key}」`);
      return values[0]||'';
    };
    const money=(value,key,required=false)=>{
      try{const n=parseMoneyMinor(value);if(n==null&&required)problem('MISSING_MONEY',`缺少「${key}」金額`);
        if(n!=null&&n<0)problem('NEGATIVE_MONEY',`「${key}」不可為負數`);return n??0;
      }catch{problem('INVALID_MONEY',`「${key}」金額格式無效`);return 0;}
    };
    const orderMoney=key=>money(get(key,true),key,true);
    const source={subtotalMinor:orderMoney('訂單小計'),discountMinor:orderMoney('優惠折扣'),customDiscountMinor:orderMoney('自訂折扣合計'),creditMinor:orderMoney('折抵購物金'),pointsMinor:orderMoney('點數折現'),surchargeMinor:orderMoney('附加費')};
    const shipping=orderMoney('運費'),tax=orderMoney('稅費'),total=orderMoney('訂單合計'),refund=orderMoney('已退款金額');
    const sums={gross:0,discount:0,credit:0,points:0,net:0};
    const converted=lines.map(r=>{
      const unit=money(r['商品結帳價'],'商品結帳價',true),qty=Number(r['數量']);
      const parts={product:money(r['商品折扣金額'],'商品折扣金額'),order:money(r['全單折扣金額'],'全單折扣金額'),credit:money(r['折抵購物金分攤'],'折抵購物金分攤'),points:money(r['點數折現分攤'],'點數折現分攤')};
      const discount=Object.values(parts).reduce((a,b)=>a+b,0),gross=unit*qty;
      if(!Number.isSafeInteger(gross)||gross<discount)problem('SHOPLINE_LINE_AMOUNT','商品折扣分攤超過金額或數量／金額無效');
      sums.gross+=gross;sums.discount+=parts.product+parts.order;sums.credit+=parts.credit;sums.points+=parts.points;sums.net+=gross-discount;
      if(/組合|子商品/.test(t(r['商品類型'])))problem('SHOPLINE_BUNDLE_REVIEW','SHOPLINE 組合主／子商品結構尚須核對，暫不自動轉銷貨');
      return {r,parts,gross,discount,unit};
    });
    if(!Object.values(sums).every(Number.isSafeInteger))problem('MONEY_OVERFLOW','SHOPLINE 商品合計超出安全範圍');
    if(sums.gross!==source.subtotalMinor||sums.discount!==source.discountMinor+source.customDiscountMinor||sums.credit!==source.creditMinor||sums.points!==source.pointsMinor)
      problem('SHOPLINE_ALLOCATION_MISMATCH','SHOPLINE 商品金額、折扣、購物金或點數分攤與訂單欄位不符，請核對原報表');
    if(sums.net+shipping+tax+source.surchargeMinor!==total)problem('ORDER_TOTAL_MISMATCH','SHOPLINE 商品淨額＋運費＋稅費＋附加費與訂單合計不符');
    if(source.surchargeMinor)problem('SHOPLINE_SURCHARGE_MAPPING','SHOPLINE 附加費尚未設定 ECOUNT 專用品項');
    if(tax)problem('SOURCE_TAX_ALLOCATION','來源另列稅費，須先核對商品稅別，不能重複計稅');
    const common={Name:number,'Financial Status':paymentStatus(get('付款狀態',true)),'Fulfillment Status':fulfillmentStatus(get('送貨狀態',true)),
      'Payment Method':get('付款方式',true),'Cancelled at':/取消/.test(get('訂單狀態',true))?'cancelled':'',Currency:get('貨幣',true),
      Subtotal:sums.net/100,Shipping:shipping/100,Total:total/100,Taxes:tax/100,'Discount Amount':(sums.discount+sums.credit+sums.points)/100,'Refunded Amount':refund/100,'Created at':get('訂單日期')};
    for(const {r,discount,unit} of converted)normalized.push({...common,'Lineitem sku':r['商品貨號'],'Lineitem name':r['商品名稱'],'Lineitem quantity':r['數量'],'Lineitem price':unit/100,'Lineitem discount':discount/100,'Lineitem id':r['商品明細編號']??''});
    metadata.set(number,{source,net:sums.net,converted,rawPaymentStatus:get('付款狀態'),rawFulfillmentStatus:get('送貨狀態'),orderStatus:get('訂單狀態'),attribution:{orderTags:get('訂單標籤'),partner:get('合作夥伴'),referralCode:get('推薦代碼')}});
  }
  const parsed=parseMarketplaceRows(normalized,{platform:'Shopify',allowAllOrders:true});parsed.platform='SHOPLINE';parsed.issues.push(...issues);
  for(const order of parsed.orders){const meta=metadata.get(order.sourceOrderNumber);
    Object.assign(order,{sourcePlatform:'SHOPLINE',rawPaymentStatus:meta.rawPaymentStatus,rawFulfillmentStatus:meta.rawFulfillmentStatus,orderStatus:meta.orderStatus,attribution:meta.attribution});
    Object.assign(order.financial,meta.source,{nativeNetSubtotalMinor:meta.net});
    const items=parsed.items.filter(i=>i.sourceOrderNumber===order.sourceOrderNumber);
    items.forEach((item,index)=>{const source=meta.converted[index];item.id='SL-'+item.id;item.sourceLineId='SL-'+item.sourceLineId;
      item.sourceLineSubtotalMinor=source.gross;item.sourceDiscounts=source.parts;item.productType=t(source.r['商品類型']);item.variant=t(source.r['選項']);});
    order.itemIds=items.map(i=>i.id);
  }
  parsed.summary=summarize(parsed);return parsed;
}
export function parseUnifiedMarketplace(input) {
  const source=inspectMarketplaceRows(input);
  const parsed=source.platform==='SHOPLINE'?parseShopline(source.rows):parseMarketplaceRows(source.rows,{platform:source.platform,allowAllOrders:true});
  return {source,parsed};
}

function canShip(order,settings){
  if(order.currentQuantity===0)return {eligible:false,reason:order.cancelled?'Shopify 已取消訂單':'Shopify 商品已全部移除'};
  if(order.cancelled||order.fulfillmentStatus!=='unfulfilled'||(order.financial.refundedMinor??0)>0||!['paid','pending'].includes(order.paymentStatus))return {eligible:false,reason:'已出貨、取消、退款或狀態不明'};
  if(order.paymentStatus==='paid')return {eligible:true,reason:'已付款／未出貨'};
  const cod=/貨到付款|貨到收款|取貨付款|cash\s*on\s*delivery|\bcod\b/i.test(order.paymentMethod)||(order.sourcePlatform==='Shopify'&&t(order.paymentMethod).toLowerCase()==='custom');
  if(cod&&!order.paymentNote)return {eligible:true,reason:'貨到付款／未出貨'};
  if(settings.includeTestOrders===true&&order.sourcePlatform==='1Shop'&&TEST_ORDER_NUMBERS.includes(order.sourceOrderNumber))return {eligible:true,reason:'指定 TEST 未付款測試'};
  return {eligible:false,reason:order.paymentNote||'未付款，且不是已辨識的貨到付款'};
}
function summarize(parsed){
  const sum=key=>parsed.orders.every(o=>o.financial[key]!=null)?parsed.orders.reduce((n,o)=>n+o.financial[key],0):null;
  return {orderCount:parsed.orders.length,itemCount:parsed.items.length,totalQuantity:parsed.items.reduce((n,i)=>n+(i.quantity||0),0),totalMinor:sum('totalMinor'),subtotalMinor:sum('subtotalMinor'),shippingMinor:sum('shippingMinor'),feeMinor:sum('feeMinor'),pendingOrderCount:parsed.orders.filter(o=>o.paymentStatus==='pending').length,bundleComponentCount:parsed.items.filter(i=>i.kind==='bundle_component').length};
}
// Largest-remainder allocation preserves every cent and is stable on row reorder.
function allocate(amount,items,weights){
  const total=weights.reduce((a,b)=>a+BigInt(b),0n);
  if(!Number.isSafeInteger(amount)||amount<0||total<=0n||BigInt(amount)>total)fail('折扣超過可分攤商品金額');
  const parts=items.map((item,i)=>{const n=BigInt(amount)*BigInt(weights[i]);return {id:item.sourceLineId,index:i,value:Number(n/total),remainder:n%total};});
  let left=amount-parts.reduce((n,p)=>n+p.value,0);
  const ranked=[...parts].sort((a,b)=>a.remainder===b.remainder?(a.id<b.id?-1:a.id>b.id?1:0):(a.remainder>b.remainder?-1:1));
  for(const p of ranked){if(!left)break;p.value++;left--;}
  return parts.map(p=>p.value);
}
export function prepareUnifiedMarketplace(raw,settings={}){
  const choices=raw.orders.map(o=>({...canShip(o,settings),number:o.sourceOrderNumber}));
  const selected=new Set(choices.filter(c=>c.eligible).map(c=>c.number));
  const parsed={...raw,orders:raw.orders.filter(o=>selected.has(o.sourceOrderNumber)).map(o=>({...o,financial:{...o.financial}})),items:raw.items.filter(i=>selected.has(i.sourceOrderNumber)).map(i=>({...i})),issues:raw.issues.filter(i=>!i.orderNumber||selected.has(i.orderNumber))};
  for(const order of parsed.orders){
    if(raw.platform==='1Shop')continue;
    if(order.financial.nativeNetSubtotalMinor!=null){order.financial.sourceSubtotalMinor=order.financial.subtotalMinor;order.financial.subtotalMinor=order.financial.nativeNetSubtotalMinor;continue;}
    const f=order.financial,items=parsed.items.filter(i=>i.sourceOrderNumber===order.sourceOrderNumber);
    if(items.some(i=>!Number.isSafeInteger(i.lineSubtotalMinor)||i.lineSubtotalMinor<0)||!Number.isSafeInteger(f.subtotalMinor))continue;
    const remaining=items.reduce((n,i)=>n+i.lineSubtotalMinor,0)-f.subtotalMinor;
    const netShipping=f.totalMinor-f.subtotalMinor-(f.taxMinor??0);
    if(remaining<0||netShipping<0||netShipping>f.shippingMinor){parsed.issues.push(addIssue('UNRESOLVED_DISCOUNT','商品折扣或運費折抵無法由來源總額核對，請確認平台報表欄位',order.sourceOrderNumber));continue;}
    if((f.taxMinor??0)!==0){parsed.issues.push(addIssue('SOURCE_TAX_ALLOCATION','來源另列稅額，須先核對各商品稅別與分攤；本次不自行改寫含稅價格',order.sourceOrderNumber));continue;}
    if(remaining>0||netShipping!==f.shippingMinor){
      try{
        const discounts=remaining?allocate(remaining,items,items.map(i=>i.lineSubtotalMinor)):items.map(()=>0);
        items.forEach((i,index)=>{i.sourceLineSubtotalMinor=i.lineSubtotalMinor;i.allocatedDiscountMinor=discounts[index];i.lineSubtotalMinor-=discounts[index];});
        f.sourceShippingMinor=f.shippingMinor;f.shippingMinor=netShipping;
      }catch(e){parsed.issues.push(addIssue('ALLOCATION_FAILED',e.message,order.sourceOrderNumber));continue;}
    }
    parsed.issues=parsed.issues.filter(i=>i.orderNumber!==order.sourceOrderNumber||!['DISCOUNT_ALLOCATION_REQUIRED','SHIPPING_DISCOUNT_ALLOCATION_REQUIRED'].includes(i.code));
  }
  parsed.summary=summarize(parsed);
  const effective=normalizeMarketplaceSettings(parsed,{...settings,pendingTestAcknowledged:true,discountAllocationConfirmed:!parsed.issues.some(i=>['UNRESOLVED_DISCOUNT','SOURCE_TAX_ALLOCATION','ALLOCATION_FAILED'].includes(i.code))});
  const output=buildEcountRows(parsed,effective);
  const prepick=buildPrepickRows(parsed,{...effective,preview:true});
  return {parsed,choices,output,prepick,audit:buildMarketplaceAuditRows(raw,effective),effectiveSettings:effective};
}

export function buildUnifiedConversion(rows,settings){
  const {source,parsed:raw}=parseUnifiedMarketplace(rows);
  const prepared=prepareUnifiedMarketplace(raw,settings);
  if(!prepared.output.ok)throw Object.assign(new Error('請先完成來源、商品與 ECOUNT 欄位核對'),{status:400,code:'MARKETPLACE_NOT_READY',issues:prepared.output.issues});
  if(prepared.parsed.items.length>1000||prepared.parsed.summary.totalQuantity>50000)fail('本批超過 1,000 商品列或 50,000 件，請分批轉檔');
  for(const order of prepared.parsed.orders){if(!t(order.sourceOrderNumber)||t(order.sourceOrderNumber).length>100)fail('商城訂單號最多 100 字');}
  if(t(settings.store).length>100||t(settings.customerCode).length>30||t(settings.warehouseCode).length>30)fail('店鋪、客戶或倉庫欄位過長');
  return {source,raw,...prepared};
}
