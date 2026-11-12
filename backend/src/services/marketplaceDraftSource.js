const {createHash}=require('node:crypto');
const clean=v=>String(v??'').trim();
const fail=(message,number)=>Object.assign(new Error(message),{status:400,code:'MARKETPLACE_DRAFT_SOURCE_INVALID',orderNumber:number});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const variantIdPattern=/^gid:\/\/shopify\/ProductVariant\/\d+$/;
const moneyFields=['Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount','Outstanding Balance'];
const deliveryFields=['Shipping Name','Shipping Phone','Shipping Address1','Shipping Address2','Shipping City','Shipping Zip','Shipping Province','Shipping Country','Shipping Company','Shipping Method'];

function shopifyMinor(value){
 const amount=clean(value);
 if(!/^\d+(?:\.\d{1,2})?$/.test(amount))return null;
 const [whole,fraction='']=amount.split('.');
 const minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(minor)?minor:null;
}

function lineDiscounts(rows){
 const groups=new Map();
 for(const {row,id} of rows){
  const sku=clean(row['Lineitem sku']),name=clean(row['Lineitem name']),quantity=Number(row['Lineitem quantity']);
  const unit=shopifyMinor(row['Lineitem price']),discount=shopifyMinor(clean(row['Lineitem discount'])||'0');
  if(!sku||!name||!Number.isSafeInteger(quantity)||quantity<1||quantity>50000||!/^\d+$/.test(clean(row['Lineitem quantity']))||unit===null||discount===null||!Number.isSafeInteger(unit*quantity)||discount>unit*quantity)return null;
  const fullyDiscounted=discount===unit*quantity;
  const key=JSON.stringify([id,sku,name,quantity,unit,fullyDiscounted]);
  if(!groups.has(key))groups.set(key,{discounts:[],fullyDiscounted});
  groups.get(key).discounts.push(discount);
 }
 for(const {discounts} of groups.values())discounts.sort((a,b)=>a-b);
 return groups;
}

// A standard export can contain a paid and a promotional line for one variant
// without line IDs. Prove the entire order equivalent before retaining the
// authoritative lines. Never infer which CSV row belongs to which live ID.
function canPreserveCurrentOrder(bases,liveRows,current,resolved){
 if(bases.length!==liveRows.length||liveRows.length!==current.items.length||current.removedLineIds?.length)return false;
 const verifiedById=new Map(current.items.map(item=>[item.id,item]));
 const liveIds=new Set(liveRows.map(row=>clean(row['Lineitem id'])));
 if(verifiedById.size!==liveRows.length||liveIds.size!==liveRows.length||liveRows.some(row=>{
  const item=verifiedById.get(clean(row['Lineitem id']));
  return !item||!/^gid:\/\/shopify\/LineItem\/\d+$/.test(item.id)||!variantIdPattern.test(item.variantId||'')||
   item.sku!==clean(row['Lineitem sku'])||item.quantity!==Number(row['Lineitem quantity'])||item.unfulfilledQuantity!==item.quantity;
 }))return false;
 const variantBySku=new Map();
 for(const item of current.items){
  if(variantBySku.has(item.sku)&&variantBySku.get(item.sku)!==item.variantId)return false;
  variantBySku.set(item.sku,item.variantId);
 }
 const explicitIds=new Set(),sourceLines=[];
 for(const {uploaded,sku,matches} of resolved){
  let id='';
  if(clean(uploaded['Lineitem id'])){
   if(matches.length!==1||matches[0].sku!==sku||!liveIds.has(matches[0].id)||explicitIds.has(matches[0].id))return false;
   id=matches[0].id;explicitIds.add(id);
  }
  sourceLines.push({row:uploaded,id});
 }
 const sourceDiscounts=lineDiscounts(sourceLines);
 const liveDiscounts=lineDiscounts(liveRows.map(row=>{
  const id=clean(row['Lineitem id']);
  return {row,id:explicitIds.has(id)?id:''};
 }));
 if(!sourceDiscounts||!liveDiscounts||sourceDiscounts.size!==liveDiscounts.size)return false;
 let liveDiscountTotal=0,paidLineCount=0,hasUnallocatedDiscount=false;
 for(const [key,{discounts,fullyDiscounted}] of sourceDiscounts){
  const liveGroup=liveDiscounts.get(key)?.discounts;
  if(!liveGroup||liveGroup.length!==discounts.length||discounts.some((discount,index)=>discount>liveGroup[index]))return false;
  liveDiscountTotal+=liveGroup.reduce((sum,discount)=>sum+discount,0);
  paidLineCount+=fullyDiscounted?0:discounts.length;
  hasUnallocatedDiscount||=discounts.some((discount,index)=>discount!==liveGroup[index]);
 }
 // An unallocated order discount has only one possible recipient when the
 // order has a single paid line. Otherwise require the exact live allocation.
 if(hasUnallocatedDiscount&&paidLineCount!==1)return false;
 const first=liveRows[0];
 if(liveDiscountTotal!==shopifyMinor(first['Discount Amount']))return false;
 if(!moneyFields.every(field=>{
  const amount=shopifyMinor(first[field]);
  return amount!==null&&shopifyMinor(bases[0][field])===amount&&
   bases.slice(1).every(row=>!clean(row[field])||shopifyMinor(row[field])===amount);
 }))return false;
 return ['Currency',...deliveryFields].every(field=>
  clean(bases[0][field])===clean(first[field])&&bases.slice(1).every(row=>!clean(row[field])||clean(row[field])===clean(first[field])));
}

function records(rows){
 const headers=rows[0],result=new Map();let last='';
 for(const row of rows.slice(1)){
  if(!row.some(v=>clean(v)))continue;
  const record=Object.fromEntries(headers.map((key,i)=>[key,row[i]??'']));
  const number=clean(record.Name)||last;last=number;
  if(!number)throw fail('商品列缺少訂單編號');
  if(!result.has(number))result.set(number,[]);
  result.get(number).push(record);
 }
 return result;
}

// Only the reviewed draft endpoint can select this projection. Live Shopify
// identity, status and variant/barcode evidence remain authoritative; the
// operator's file supplies the explicitly reviewed shipment quantities/money.
function projectDraftSource(sourceRows,verifiedRows,verification,orderNumbers){
 const selected=new Set(orderNumbers);
 if(!selected.size||selected.size!==orderNumbers.length||orderNumbers.some(n=>typeof n!=='string'||!n||n.length>100))throw fail('請選擇有效且不重複的原訂單');
 if(verification?.version!=='shopify-current-v2'||verification.platform!=='Shopify')throw fail('覆蓋前須取得完整 Shopify 即時核對資料');
 const source=records(sourceRows),live=records(verifiedRows),projected=[],currentOrders=[];
 for(const [number,liveRows] of live){
  if(!selected.has(number)){projected.push(...liveRows);continue;}
  const evidence=verification.orders.filter(o=>o.number===number);
  if(evidence.length!==1||!source.has(number))throw fail('上傳檔與原商城訂單無法唯一核對',number);
  const current=evidence[0];
  const verifiedRefund=current.paymentStatus==='partially_refunded'&&current.refundEvidence?.version==='shopify-refund-remainder-v1';
  if(current.cancelled!==false||current.cancelledAt||current.fulfillmentStatus!=='unfulfilled'||current.currentQuantity!==current.remainingQuantity||!['paid','pending'].includes(current.paymentStatus)&&!verifiedRefund)throw fail('已出貨、取消或狀態待核對的訂單不能覆蓋草稿',number);
  const bases=source.get(number),ids=[...new Set(bases.map(r=>clean(r.Id)).filter(Boolean))];
  if(ids.length!==1||ids[0]!==String(current.id).replace('gid://shopify/Order/',''))throw fail('上傳檔訂單 ID 與 Shopify 不同',number);
  // Standard exports retain canceled historical lines without line IDs. Only
  // an exact, unique live current=0 identity can remove such a row. The rest
  // of the file must cover every active line and quantity before current API
  // money replaces stale historical order totals/discounts.
  const removed=(current.allItems||[]).filter(item=>item.currentQuantity===0&&item.unfulfilledQuantity===0&&current.removedLineIds?.includes(item.id));
  const resolved=bases.map(uploaded=>{
   const sku=clean(uploaded['Lineitem sku']),id=clean(uploaded['Lineitem id']);
   const matches=[...current.items,...removed].filter(item=>id?(item.id===id||item.id.split('/').pop()===id):item.sku===sku);
   return {uploaded,sku,matches};
  });
  const hasRemoved=resolved.some(value=>value.matches.length===1&&removed.some(item=>item.id===value.matches[0].id));
  if(hasRemoved||verifiedRefund){
   const used=new Set();
   for(const value of resolved){
    if(value.matches.length!==1||value.matches[0].sku!==value.sku||used.has(value.matches[0].id))throw fail(`商品 ${value.sku||'未填貨號'} 無法唯一對應商城目前或已取消品項，請核對貨號`,number);
    const item=value.matches[0];used.add(item.id);
    if(removed.some(removed=>removed.id===item.id)){
     if(!/^[1-9]\d*$/.test(clean(value.uploaded['Lineitem quantity']))||Number(value.uploaded['Lineitem quantity'])!==item.originalQuantity)throw fail(`已取消商品 ${value.sku} 的歷史數量與商城不符，請重新匯出或核對修改`,number);
     continue;
    }
    if(!/^[1-9]\d*$/.test(clean(value.uploaded['Lineitem quantity']))||Number(value.uploaded['Lineitem quantity'])!==item.quantity)throw fail(`商品 ${value.sku} 的新版數量與商城目前有效數量不同；請先確認商城修改結果`,number);
   }
   if(current.items.some(item=>!used.has(item.id)))throw fail(`本檔缺少商城有效商品 ${current.items.filter(item=>!used.has(item.id)).map(item=>item.sku).join('、')}，請重新匯出或核對修改`,number);
   projected.push(...liveRows);currentOrders.push(number);continue;
  }
  const hasAmbiguousSku=resolved.some(({uploaded,matches})=>!clean(uploaded['Lineitem id'])&&matches.length>1);
  if(hasAmbiguousSku&&canPreserveCurrentOrder(bases,liveRows,current,resolved)){
   projected.push(...liveRows);continue;
  }
  const first=liveRows[0],used=new Set();
  for(const uploaded of bases){
   const sku=clean(uploaded['Lineitem sku']),id=clean(uploaded['Lineitem id']);
   const matches=current.items.filter(item=>id?(item.id===id||item.id.split('/').pop()===id):item.sku===sku);
   if(matches.length!==1||matches[0].sku!==sku||used.has(matches[0].id))throw fail('商品明細無法唯一對應 Shopify；請保留商品明細 ID，不能用列順序猜測',number);
   const item=matches[0];used.add(item.id);
   if(!variantIdPattern.test(item.variantId||''))throw fail('商品缺少可核對的 Shopify 規格 ID',number);
   const quantity=clean(uploaded['Lineitem quantity']);
   if(!/^[1-9]\d*$/.test(quantity)||!Number.isSafeInteger(Number(quantity))||Number(quantity)>50000)throw fail('新版商品數量須為正整數；不出貨的商品請移除該列',number);
   if(!Number.isSafeInteger(item.unfulfilledQuantity)||Number(quantity)>item.unfulfilledQuantity)throw fail('新版數量超過商城目前待出貨量，請先核對商城訂單後再轉檔',number);
   const currentRow=liveRows.find(r=>clean(r['Lineitem id'])===item.id);
   if(!currentRow)throw fail('Shopify 商品明細未完整回傳',number);
   projected.push({...first,...uploaded,Name:number,Id:current.id,'Lineitem id':item.id,
    // A CSV cannot revive an order or supply unverified barcode/variant data.
    'Financial Status':first['Financial Status'],'Fulfillment Status':first['Fulfillment Status'],
    'Cancelled at':first['Cancelled at'],'Refunded Amount':first['Refunded Amount'],
    'Outstanding Balance':first['Outstanding Balance'],'Payment Method':first['Payment Method'],Currency:first.Currency,
    'Lineitem requires shipping':currentRow['Lineitem requires shipping'],
    'Lineitem fulfillment status':currentRow['Lineitem fulfillment status']});
  }
 }
 if([...selected].some(n=>!live.has(n)))throw fail('新版訂單未通過商城核對');
 const headers=[...new Set([...verifiedRows[0],...sourceRows[0],...projected.flatMap(Object.keys)])];
 const rows=[headers,...projected.map(r=>headers.map(h=>r[h]??''))];
 return {rows,review:{mode:currentOrders.length?'shopify-current-after-removal-v1':'operator-reviewed-csv-v1',currentOrderNumbers:currentOrders.sort(),orderNumbers:[...selected].sort(),sourceFingerprint:hash(sourceRows),effectiveRowsFingerprint:hash(rows)}};
}
module.exports={projectDraftSource};
