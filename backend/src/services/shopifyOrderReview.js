// This evidence is attached only after the server's live Shopify read. Neither
// CSV columns nor store settings can create a refund eligibility proof.
const {createHash}=require('node:crypto');
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>Object.assign(new Error(message),{status:400,code:'SHOPIFY_REVIEW_REQUIRED'});
const money=value=>Number.isSafeInteger(value)&&value>=0;
const DECISION='net-payment-with-allowance-v1';
function applyShopifyOrderReviews(raw,verification,draftSourceReview=null){
 const reviews=[];
 if(verification?.platform!=='Shopify'||verification?.version!=='shopify-current-v2')return {reviewRequired:false,orderReviews:reviews};
 for(const order of raw.orders){
  const evidence=verification.orders.find(value=>value.number===order.sourceOrderNumber);
  if(!evidence)continue;
  if(evidence.cancelled||evidence.currentQuantity===0)continue;
  const proof=evidence.refundEvidence;
  const editChanges=require('./shopifyOrderEdits').reviewEditChanges(evidence);
  const cancelledItems=(evidence.allItems||[]).filter(item=>item.originalQuantity>item.currentQuantity&&(item.currentQuantity===0&&evidence.removedLineIds?.includes(item.id)||proof?.refunds?.some(refund=>refund.lines.some(line=>line.lineId===item.id)))).map(item=>({id:item.id,name:item.name,sku:item.sku,quantity:item.originalQuantity-item.currentQuantity,reason:'商城已取消／移除，非本次出貨品項'}));
  const remainingItems=evidence.items.map(item=>({id:item.id,name:item.name,sku:item.sku,quantity:item.quantity}));
  if(order.paymentStatus!=='partially_refunded'){
   if(cancelledItems.length&&(!draftSourceReview||draftSourceReview.currentOrderNumbers?.includes(order.sourceOrderNumber)))reviews.push({orderNumber:order.sourceOrderNumber,type:'removed_items',summary:'已依商城目前有效商品轉檔，取消品項不出貨',cancelledItems,remainingItems,...(editChanges.length?{editChanges}:{}),live:{totalMinor:evidence.totalMinor,refundedMinor:evidence.refundedMinor||0,netPaymentMinor:evidence.netPaymentMinor??evidence.receivedMinor},decisionRequired:false,canConfirm:true,blockedReasons:[]});
   continue;
  }
  const {fingerprint,...unsigned}=proof||{};
  if(proof?.version!=='shopify-refund-remainder-v1'||proof.status!=='verified-unfulfilled-remainder'||fingerprint!==hash(unsigned)||proof.orderId.replace('gid://shopify/Order/','')!==String(evidence.id)||proof.updatedAt!==evidence.updatedAt||evidence.cancelled!==false||evidence.fulfillmentStatus!=='unfulfilled'||evidence.currentQuantity!==evidence.remainingQuantity||proof.apiTotalMinor!==order.financial.totalMinor||proof.apiSubtotalMinor!==order.financial.subtotalMinor||proof.refundedMinor!==order.financial.refundedMinor||proof.netPaymentMinor!==proof.receivedMinor-proof.refundedMinor||order.financial.outstandingMinor!==0)throw fail(`${order.sourceOrderNumber}：部分退款缺少完整即時核對證據`);
  const items=raw.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber),allowance=proof.apiTotalMinor-proof.netPaymentMinor,subtotal=items.reduce((sum,item)=>sum+item.lineSubtotalMinor,0);
  if(!items.length||items.some(item=>!money(item.lineSubtotalMinor))||!money(allowance)||subtotal!==proof.apiSubtotalMinor||allowance>subtotal||proof.netPaymentMinor<=0||evidence.items.length!==items.length||items.some(item=>evidence.items.filter(line=>line.id===item.sourceLineId&&line.quantity===item.quantity&&line.netMinor===item.lineSubtotalMinor).length!==1))throw fail(`${order.sourceOrderNumber}：退款後商品淨額與實收折讓無法核對`);
  const total=BigInt(subtotal),parts=items.map(item=>{const product=BigInt(allowance)*BigInt(item.lineSubtotalMinor);return {item,value:total?Number(product/total):0,remainder:total?product%total:0n};});
  let left=allowance-parts.reduce((sum,part)=>sum+part.value,0);
  for(const part of [...parts].sort((a,b)=>a.remainder===b.remainder?a.item.sourceLineId.localeCompare(b.item.sourceLineId):a.remainder>b.remainder?-1:1)){if(!left)break;part.value++;left--;}
  for(const part of parts){part.item.platformLineSubtotalMinor=part.item.lineSubtotalMinor;part.item.orderAllowanceMinor=part.value;part.item.lineSubtotalMinor-=part.value;}
  order.financial={...order.financial,platformTotalMinor:proof.apiTotalMinor,platformSubtotalMinor:proof.apiSubtotalMinor,platformDiscountMinor:order.financial.discountMinor,discountMinor:order.financial.discountMinor+allowance,operatorAllowanceMinor:allowance,netPaymentMinor:proof.netPaymentMinor,subtotalMinor:proof.apiSubtotalMinor-allowance,totalMinor:proof.netPaymentMinor};
  const proposal={decision:DECISION,fingerprint:hash({version:DECISION,orderNumber:order.sourceOrderNumber,evidenceFingerprint:evidence.fingerprint,proofFingerprint:fingerprint,salesTotalMinor:proof.netPaymentMinor,allowanceMinor:allowance}),salesTotalMinor:proof.netPaymentMinor,allowanceMinor:allowance};
  order.shopifyRefundRemainder={version:'shopify-refund-remainder-v1',evidenceFingerprint:fingerprint,proposalFingerprint:proposal.fingerprint,apiTotalMinor:proof.apiTotalMinor,refundedMinor:proof.refundedMinor,receivedMinor:proof.receivedMinor,netPaymentMinor:proof.netPaymentMinor,allowanceMinor:allowance};
  raw.issues=raw.issues.filter(issue=>issue.orderNumber!==order.sourceOrderNumber||issue.code!=='UNPAID_ORDER');
  reviews.push({orderNumber:order.sourceOrderNumber,type:'partial_refund',summary:'取消品項不出貨；請確認以退款後實收及額外折讓轉檔',cancelledItems,remainingItems,...(editChanges.length?{editChanges}:{}),live:{totalMinor:proof.apiTotalMinor,refundedMinor:proof.refundedMinor,netPaymentMinor:proof.netPaymentMinor},decisionRequired:true,proposal,canConfirm:true,blockedReasons:[]});
 }
 return {reviewRequired:reviews.length>0,orderReviews:reviews};
}
function authorizeShopifyOrderReviews(conversion,decisions,{actorId,commandId}){
 const required=(conversion.orderReviews||[]).filter(review=>review.decisionRequired);
 if(decisions===undefined&&!required.length)return;
 if(!Array.isArray(decisions)||decisions.length!==required.length||new Set(decisions.map(value=>value?.orderNumber)).size!==decisions.length||decisions.some(value=>!value||Object.keys(value).sort().join(',')!=='decision,fingerprint,orderNumber'||typeof value.orderNumber!=='string'||!required.some(review=>review.orderNumber===value.orderNumber&&review.proposal.decision===value.decision&&review.proposal.fingerprint===value.fingerprint)))throw fail('請重新核對退款後實收與折讓，並明確確認本次方案');
 conversion.sourceEvidence={...conversion.sourceEvidence,orderReviews:clone(conversion.orderReviews||[]),reviewAuthorization:{version:'shopify-order-review-v1',actorId,commandId,orderNumbers:(conversion.orderReviews||[]).map(review=>review.orderNumber).sort(),decisions:clone(decisions)}};
}
module.exports={applyShopifyOrderReviews,authorizeShopifyOrderReviews};
