const {projectDraftSource}=require('../services/marketplaceDraftSource');
const number='#DRAFT',sku='000123',extraSku='000456';
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(r=>headers.map(h=>r[h]??''))];};
const row=(code=sku,extra={})=>({Name:number,Id:'100','Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'100',Shipping:'0',Total:'100',Taxes:'0','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Payment Method':'card','Cancelled at':'','Lineitem sku':code,'Lineitem name':'商品','Lineitem quantity':'1','Lineitem price':'100','Lineitem discount':'0',...extra});
function fixture(){
 const a={id:'gid://shopify/LineItem/11',sku,quantity:1,unfulfilledQuantity:1,variantId:'gid://shopify/ProductVariant/111',barcode:'4710000000011'};
 const b={id:'gid://shopify/LineItem/12',sku:extraSku,quantity:1,unfulfilledQuantity:1,variantId:'gid://shopify/ProductVariant/112',barcode:'4710000000012'};
 const verification={version:'shopify-current-v2',platform:'Shopify',shop:'synthetic.myshopify.com',orders:[{id:'100',number,cancelled:false,cancelledAt:null,fulfillmentStatus:'unfulfilled',paymentStatus:'paid',currentQuantity:2,remainingQuantity:2,items:[a,b]}]};
 const live=table([row(sku,{'Lineitem id':a.id,'Lineitem requires shipping':true,'Lineitem fulfillment status':'pending'}),row(extraSku,{'Lineitem id':b.id,'Lineitem requires shipping':true,'Lineitem fulfillment status':'pending','Lineitem price':'0'})]);
 return {verification,live,a,b};
}
test('explicit reviewed CSV projection keeps a removed gift out while preserving exact API line/variant evidence',async()=>{
 const f=fixture(),before=structuredClone(f.verification),source=table([row()]);
 const projected=projectDraftSource(source,f.live,f.verification,[number]);
 const parsed=(await import('../services/unifiedMarketplace.mjs')).parseUnifiedMarketplace(projected.rows).parsed;
 expect(parsed.items).toHaveLength(1);expect(parsed.items[0]).toMatchObject({sku,sourceLineId:f.a.id,quantity:1});
 expect(projected.review).toMatchObject({mode:'operator-reviewed-csv-v1',orderNumbers:[number]});
 expect(f.verification).toEqual(before);expect(f.verification.orders[0].items).toHaveLength(2);
});
test('uploaded quantity and reconciled money changes survive live normalization only in the explicit draft projection',async()=>{
 const f=fixture(),source=table([row(sku,{'Lineitem quantity':'2',Subtotal:'200',Total:'200'})]);
 f.a.quantity=3;f.a.unfulfilledQuantity=3;f.verification.orders[0].currentQuantity=4;f.verification.orders[0].remainingQuantity=4;
 const projected=projectDraftSource(source,f.live,f.verification,[number]);
 const {parseUnifiedMarketplace,prepareUnifiedMarketplace}=await import('../services/unifiedMarketplace.mjs');
 const raw=parseUnifiedMarketplace(projected.rows).parsed;
 expect(raw.items[0].quantity).toBe(2);expect(raw.orders[0].financial.totalMinor).toBe(20000);
 const bad=projectDraftSource(table([row(sku,{'Lineitem quantity':'2'})]),f.live,f.verification,[number]);
 expect(parseUnifiedMarketplace(bad.rows).parsed.issues.some(i=>i.code==='ORDER_TOTAL_MISMATCH')).toBe(true);
});
test('manual increases beyond the live outstanding shipment quantity are blocked',()=>{
 const f=fixture();expect(()=>projectDraftSource(table([row(sku,{'Lineitem quantity':'2',Subtotal:'200',Total:'200'})]),f.live,f.verification,[number])).toThrow('超過商城目前待出貨量');
});
test.each(['fulfilled','partially_fulfilled','unknown'])('CSV cannot revive live %s order',fulfillmentStatus=>{
 const f=fixture();f.verification.orders[0].fulfillmentStatus=fulfillmentStatus;
 expect(()=>projectDraftSource(table([row()]),f.live,f.verification,[number])).toThrow('不能覆蓋');
});
test('CSV cannot replace live payment, cancellation or barcode evidence',()=>{
 const f=fixture(),source=table([row(sku,{'Financial Status':'pending','Refunded Amount':'999','Cancelled at':'forged','Lineitem requires shipping':false})]);
 const projected=projectDraftSource(source,f.live,f.verification,[number]);
 const record=Object.fromEntries(projected.rows[0].map((h,i)=>[h,projected.rows[1][i]]));
 expect(record).toMatchObject({'Financial Status':'paid','Refunded Amount':'0','Cancelled at':'','Lineitem requires shipping':true});
});
test.each(['0','-1','1.5','1e2','50001'])('invalid override quantity %s is rejected',value=>{
 const f=fixture();expect(()=>projectDraftSource(table([row(sku,{'Lineitem quantity':value})]),f.live,f.verification,[number])).toThrow('正整數');
});
test('same SKU across live variants requires explicit original line identity',()=>{
 const f=fixture();f.verification.orders[0].items[1].sku=sku;
 expect(()=>projectDraftSource(table([row()]),f.live,f.verification,[number])).toThrow('無法唯一');
 const good=projectDraftSource(table([row(sku,{'Lineitem id':f.a.id})]),f.live,f.verification,[number]);
 expect(good.rows).toHaveLength(2);
});
test('foreign order ID, unknown SKU, duplicate line and absent variant fail closed',()=>{
 for(const source of [table([row(sku,{Id:'999'})]),table([row('UNKNOWN')]),table([row(),row()])]){
  const f=fixture();expect(()=>projectDraftSource(source,f.live,f.verification,[number])).toThrow();
 }
 const f=fixture();delete f.a.variantId;
 expect(()=>projectDraftSource(table([row()]),f.live,f.verification,[number])).toThrow('規格 ID');
});
test('non-selected live orders remain API normalized and are not overridden by the CSV projection',()=>{
 const f=fixture(),other={...f.verification.orders[0],id:'200',number:'#OTHER'};f.verification.orders.push(other);
 const liveRecords=f.live.slice(1).map(r=>Object.fromEntries(f.live[0].map((h,i)=>[h,r[i]])));
 const live=table([...liveRecords,row(sku,{Name:'#OTHER',Id:'200','Lineitem id':f.a.id})]);
 const result=projectDraftSource(table([row(),row(sku,{Name:'#OTHER',Id:'200','Lineitem quantity':'99'})]),live,f.verification,[number]);
 expect(result.rows.find(r=>r[result.rows[0].indexOf('Name')]==='#OTHER')[result.rows[0].indexOf('Lineitem quantity')]).toBe('1');
});
