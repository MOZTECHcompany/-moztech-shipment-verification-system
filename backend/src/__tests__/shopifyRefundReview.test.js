const {fixture,bag,table,response,connection,shop,profile,preparation}=require('../../tests/fixtures/anonymous-shopify-refund-review.cjs');
const {verifyShopifyRows}=require('../services/shopifyOrderVerification');
const {authorizeShopifyOrderReviews}=require('../services/shopifyOrderReview');
const run=(f,fetchImpl=async()=>response(f.current))=>verifyShopifyRows(f.rows,{shop,token:'synthetic-only',fetchImpl});
function harness(f=fixture()){
 const pool={query:jest.fn(async sql=>({rows:sql.includes('marketplace_store_profiles')?[profile]:[]}))};
 return {f,pool,prepare:preparation(pool,new Map([[f.current.id,f.current]]))};
}
test('partial refund reads successful cash refund799 separately from refunded-line subtotal758.63 and preserves true status',async()=>{
 const f=fixture(),result=await run(f),order=result.verification.orders[0];
 expect(order).toMatchObject({paymentStatus:'partially_refunded',refundedMinor:79900,receivedMinor:187900,netPaymentMinor:108000,totalMinor:112037,currentQuantity:1,remainingQuantity:1,refundEvidence:{version:'shopify-refund-remainder-v1',refunds:[{refundMinor:79900,lines:[{subtotalMinor:75863,restockType:'CANCEL',quantity:1}],transactions:[{amountMinor:79900,status:'SUCCESS'}]}]}});
 expect(result.rows).toHaveLength(2);expect(order.allItems.find(item=>item.sku==='4711299273674')).toMatchObject({currentQuantity:0,unfulfilledQuantity:0});
});
test('proposal uses current net1120.37 minus extra allowance40.37 exactly once; raw refund/current/payment remain auditable',async()=>{
 const h=harness(),r=await h.prepare({rows:h.f.rows},{overwriteOrderNumbers:[h.f.number]});
 expect(r.output.ok).toBe(true);expect(r.prepick.ok).toBe(true);expect(r.reviewRequired).toBe(true);
 expect(r.orderReviews[0]).toMatchObject({type:'partial_refund',decisionRequired:true,live:{totalMinor:112037,refundedMinor:79900,netPaymentMinor:108000},proposal:{decision:'net-payment-with-allowance-v1',salesTotalMinor:108000,allowanceMinor:4037},remainingItems:[{sku:'4711299274589',quantity:1}],cancelledItems:[{sku:'4711299273674',quantity:1}]});
 expect(r.raw.orders[0]).toMatchObject({paymentStatus:'partially_refunded',financial:{totalMinor:108000,subtotalMinor:108000,platformTotalMinor:112037,operatorAllowanceMinor:4037,refundedMinor:79900,netPaymentMinor:108000}});
 expect(r.raw.items[0]).toMatchObject({lineSubtotalMinor:108000,platformLineSubtotalMinor:112037,orderAllowanceMinor:4037});expect(r.output.summary.ecountTotalMinor).toBe(108000);
 const {oldRaw}=require('../services/marketplaceDraftOverwrite').draftOverwriteTools,{prepareUnifiedMarketplace}=await import('../services/unifiedMarketplace.mjs');
 const snapshot={platform:'Shopify',orders:r.parsed.orders.map(order=>({...order,sourceFinancial:r.raw.orders[0].financial})),items:r.parsed.items};
 const rebuilt=prepareUnifiedMarketplace(oldRaw(snapshot,new Set([h.f.number])),r.settings);expect(rebuilt.output.ok).toBe(true);expect(rebuilt.output.summary.ecountTotalMinor).toBe(108000);expect(rebuilt.parsed.items[0].lineSubtotalMinor).toBe(108000);
 expect(r.raw.issues.some(issue=>issue.code==='UNPAID_ORDER')).toBe(false);
 const {buildPrepickRows,validateMarketplaceExport}=await import('../services/marketplaceIntake.mjs');expect(buildPrepickRows(r.parsed,{...r.settings,pendingTestAcknowledged:false}).ok).toBe(true);expect(validateMarketplaceExport(r.parsed,{...r.settings,pendingTestAcknowledged:false}).issues.some(issue=>issue.code==='PENDING_TEST_ACK_REQUIRED')).toBe(false);
});
test('official canceled brown line and distinct active pink line use complete current four goods and3103.14 rather than stale five/3877/150',async()=>{
 const h=harness(fixture(false)),r=await h.prepare({rows:h.f.rows},{overwriteOrderNumbers:[h.f.number]});
 expect(r.output.ok).toBe(true);expect(r.raw.items).toHaveLength(4);expect(r.raw.items.some(item=>item.sku==='4711299273674')).toBe(false);expect(r.raw.items.some(item=>item.sku==='4711299273667')).toBe(true);expect(r.raw.orders[0].financial.totalMinor).toBe(310314);
 expect(r.sourceEvidence.draftSourceReview).toMatchObject({mode:'shopify-current-after-removal-v1',currentOrderNumbers:[h.f.number]});expect(r.orderReviews[0]).toMatchObject({type:'removed_items',decisionRequired:false,live:{totalMinor:310314,refundedMinor:0,netPaymentMinor:0}});expect(r.reviewRequired).toBe(true);expect(r.sourceEvidence.rows).toEqual(r.source.rows);expect(JSON.stringify(r.sourceEvidence.rows)).toContain('3877');
 authorizeShopifyOrderReviews(r,[],{actorId:1,commandId:'synthetic'});expect(r.sourceEvidence.reviewAuthorization.decisions).toEqual([]);
});
test.each(['unknown','duplicate','missing-active','active-quantity'])('historical cancellation cannot hide %s source changes',async kind=>{
 const f=fixture(false);if(kind==='unknown')f.original.push({...f.original[0],'Lineitem sku':'UNKNOWN'});if(kind==='duplicate')f.original.push({...f.original[0]});if(kind==='missing-active')f.original.pop();if(kind==='active-quantity')f.original[0]['Lineitem quantity']='2';f.rows=table(f.original);
 const h=harness(f);await expect(h.prepare({rows:f.rows},{overwriteOrderNumbers:[f.number]})).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_SOURCE_INVALID'});
});
test.each(['pending-txn','wrong-cash','return','cancel-quantity','missing-refunds','net-mismatch','outstanding','fulfilled','tax'])('unproven refund %s fails closed',async kind=>{
 const f=fixture(),refund=f.current.refunds[0];if(kind==='pending-txn')refund.transactions.nodes[0].status='PENDING';if(kind==='wrong-cash')refund.transactions.nodes[0].amountSet=bag('758.63');if(kind==='return')refund.refundLineItems.nodes[0].restockType='RETURN';if(kind==='cancel-quantity')refund.refundLineItems.nodes[0].quantity=2;if(kind==='missing-refunds')f.current.refunds=[];if(kind==='net-mismatch')f.current.netPaymentSet=bag('1080.01');if(kind==='outstanding')f.current.totalOutstandingSet=bag('1');if(kind==='fulfilled'){f.current.lineItems.nodes[0].unfulfilledQuantity=0;f.current.displayFulfillmentStatus='FULFILLED';}if(kind==='tax')refund.refundLineItems.nodes[0].totalTaxSet=bag('1');
 await expect(run(f)).rejects.toMatchObject({code:expect.stringMatching(/^SHOPIFY_(REFUND|FULFILLMENT)_REVIEW_REQUIRED$/)});
});
test('fresh proposal fingerprint binds one cent/status evidence changes and accepts only exact server enum/fingerprint, never client amounts',async()=>{
 const h=harness(),r=await h.prepare({rows:h.f.rows}),proposal=r.orderReviews[0].proposal,decision={orderNumber:h.f.number,decision:proposal.decision,fingerprint:proposal.fingerprint};
 for(const decisions of [undefined,[],[{...decision,amount:1080}],[{...decision,fingerprint:'a'.repeat(64)}],[decision,decision]])expect(()=>authorizeShopifyOrderReviews(r,decisions,{actorId:1,commandId:'one'})).toThrow('重新核對');
 authorizeShopifyOrderReviews(r,[decision],{actorId:1,commandId:'one'});expect(r.sourceEvidence.reviewAuthorization).toMatchObject({actorId:1,commandId:'one',decisions:[decision]});
 h.f.current.netPaymentSet=bag('1080.01');h.f.current.totalReceivedSet=bag('1879.01');const fresh=await h.prepare({rows:h.f.rows},{refresh:true});expect(fresh.orderReviews[0].proposal.fingerprint).not.toBe(proposal.fingerprint);
});
test('both refund connections paginate fully, with order/version and repeated cursor checks',async()=>{
 const f=fixture(),refund=f.current.refunds[0],lines=refund.refundLineItems.nodes,transactions=refund.transactions.nodes;
 refund.refundLineItems={nodes:[],pageInfo:{hasNextPage:true,endCursor:'LINES'}};refund.transactions={nodes:[],pageInfo:{hasNextPage:true,endCursor:'TXNS'}};
 const fetchImpl=jest.fn(async(url,request)=>{const {variables}=JSON.parse(request.body);return variables.id===f.current.id?response(f.current):response({...refund,order:{id:f.current.id,updatedAt:f.current.updatedAt},refundLineItems:connection(lines),transactions:connection(transactions)},'refund');});
 expect((await run(f,fetchImpl)).verification.orders[0].refundedMinor).toBe(79900);expect(fetchImpl).toHaveBeenCalledTimes(3);
 for(const mode of ['changed','cursor']){
  const fetchBad=async(url,request)=>JSON.parse(request.body).variables.id===f.current.id?response(f.current):response({...refund,order:{id:f.current.id,updatedAt:mode==='changed'?'2026-10-29T03:01:15Z':f.current.updatedAt},refundLineItems:mode==='cursor'?refund.refundLineItems:connection(lines),transactions:connection(transactions)},'refund');
  await expect(run(f,fetchBad)).rejects.toMatchObject({code:mode==='changed'?'SHOPIFY_ORDER_CHANGED':'SHOPIFY_REFUND_REVIEW_REQUIRED'});
 }
});
test('fully canceled zero cash order remains excluded even when Shopify retains a zero-value CANCEL refund record',async()=>{
 const f=fixture(false);f.current.cancelledAt='2026-10-29T04:00:00Z';for(const item of f.current.lineItems.nodes){item.currentQuantity=0;item.unfulfilledQuantity=0;item.priceAfterAllDiscountsBeforeTaxesSet=bag(0);}f.current.currentSubtotalLineItemsQuantity=0;f.current.currentSubtotalPriceSet=bag(0);f.current.currentTotalPriceSet=bag(0);f.current.totalOutstandingSet=bag(0);f.current.currentTotalDiscountsSet=bag(0);
 const h=harness(f),r=await h.prepare({rows:f.rows});expect(r.parsed.orders).toHaveLength(0);expect(r.raw.orders[0]).toMatchObject({cancelled:true,currentQuantity:0});expect(r.reviewRequired).toBe(false);expect(r.orderReviews).toEqual([]);
});
test.each(['0','2','99999'])('a historical canceled row cannot conceal invalid/different quantity %s',async value=>{
 const f=fixture(false);f.original[1]['Lineitem quantity']=value;f.rows=table(f.original);const h=harness(f);await expect(h.prepare({rows:f.rows},{overwriteOrderNumbers:[f.number]})).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_SOURCE_INVALID'});
});
test('normal POST cannot bypass explicit review even with guessed confirmed settings and server preview fingerprint',async()=>{
 const express=require('express'),request=require('supertest'),{createMarketplaceRouter}=require('../routes/marketplaceRoutes');
 for(const partial of [true,false]){const h=harness(fixture(partial)),r=await h.prepare({rows:h.f.rows}),prepare=jest.fn(async()=>r),pool={query:jest.fn(),connect:jest.fn()},app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:1,role:'dispatcher',management_scope:'all'};next();});app.use('/intakes',createMarketplaceRouter({pool,prepareMarketplace:prepare,shippingService:{},draftOverwriteService:{}}));
  const response=await request(app).post('/intakes').send({rows:h.f.rows,previewFingerprint:r.verification.currentFingerprint,confirmed:true,notImportedConfirmed:true,reviewDecisions:r.orderReviews.filter(review=>review.decisionRequired).map(review=>({orderNumber:review.orderNumber,decision:review.proposal.decision,fingerprint:review.proposal.fingerprint}))});expect(response.status).toBe(400);expect(response.body.code).toBe('SHOPIFY_REVIEW_REQUIRED');expect(pool.connect).not.toHaveBeenCalled();
 }
});
test('a verified partial cancellation of a still-active line displays only the canceled quantity and retains real remaining quantity',async()=>{
 const f=fixture();f.current.lineItems.nodes.pop();f.current.lineItems.nodes[0].quantity=2;f.current.refunds[0].refundLineItems.nodes[0].lineItem={id:f.current.lineItems.nodes[0].id,sku:f.current.lineItems.nodes[0].sku};f.original=f.original.slice(0,1);f.original[0]['Lineitem quantity']='1';f.rows=table(f.original);
 const h=harness(f),r=await h.prepare({rows:f.rows},{overwriteOrderNumbers:[f.number]});expect(r.orderReviews[0]).toMatchObject({cancelledItems:[{sku:'4711299274589',quantity:1}],remainingItems:[{sku:'4711299274589',quantity:1}]});expect(r.raw.items[0].quantity).toBe(1);
});
test('a file without the canceled historical row preserves the existing explicit manual projection without an inaccurate current-items review',async()=>{
 const f=fixture(false);f.original=[{...f.original[0],Subtotal:'990',Total:'990','Discount Amount':'0'}];f.rows=table(f.original);const h=harness(f),r=await h.prepare({rows:f.rows},{overwriteOrderNumbers:[f.number]});expect(r.output.ok).toBe(true);expect(r.raw.items).toHaveLength(1);expect(r.raw.orders[0].financial.totalMinor).toBe(99000);expect(r.sourceEvidence.draftSourceReview.mode).toBe('operator-reviewed-csv-v1');expect(r.reviewRequired).toBe(false);expect(r.orderReviews).toEqual([]);
});
