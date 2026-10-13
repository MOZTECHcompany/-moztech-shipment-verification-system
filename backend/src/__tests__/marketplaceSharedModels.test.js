const {createMarketplacePreparation}=require('../services/marketplacePreparation');
const {resolveProducts}=require('../services/marketplaceProductCatalog');
const {confirmBarcodeReview}=require('../services/marketplaceBarcodeReviews');

const sku='4711299271373';
const names=['MOZTECH iPhone 防窺晶霧貼 - iPhone 14 Pro Max','MOZTECH iPhone 防窺晶霧貼 - iPhone 15 Plus'];
const table=records=>{
 const headers=[...new Set(records.flatMap(Object.keys))];
 return [headers,...records.map(record=>headers.map(header=>record[header]??''))];
};
const line=index=>({orderNumber:'#SHARED-MODELS',orderId:'900001',lineId:`gid://shopify/LineItem/${910001+index}`,
 variantId:`gid://shopify/ProductVariant/${920001+index}`,name:names[index],quantity:1,price:890,barcode:sku,fulfilled:false});
function rowsFor(lines){
 return table(lines.map(item=>{
  const total=lines.filter(other=>other.orderNumber===item.orderNumber).reduce((sum,other)=>sum+other.quantity*other.price,0);
  return {Name:item.orderNumber,Id:item.orderId,'Financial Status':'paid','Fulfillment Status':item.fulfilled?'fulfilled':'unfulfilled',
   Currency:'TWD',Subtotal:String(total),Shipping:'0',Taxes:'0',Total:String(total),'Discount Amount':'0','Refunded Amount':'0',
   'Outstanding Balance':'0','Payment Method':'card','Lineitem quantity':String(item.quantity),'Lineitem name':item.name,
   'Lineitem price':String(item.price),'Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':item.lineId};
 }));
}
function harness(){
 const h={lines:[line(0),line(1)],products:[{erp_sku:sku,barcode:sku,product_name:'MOZTECH-防窺晶霧貼-iPhone6.7 14ProMax/15Plus',spec:'共用款',active:true}]};
 const profile={id:7,platform:'Shopify',store:'AUDIT shared models',settings:{store:'AUDIT shared models',customerCode:'00063',
  customerName:'AUDIT shared models',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,
  shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}}};
 h.profile=profile;
 h.pool={query:jest.fn(async sql=>{
  if(!/^SELECT\b/.test(sql))throw Error('The preparation test must not write database records');
  return {rows:sql.includes('marketplace_store_profiles')?[profile]:[]};
 }),connect:jest.fn()};
 h.verifyShopify=jest.fn(async()=>({rows:rowsFor(h.lines),verification:{shop:'audit.myshopify.com',
  orders:[...new Set(h.lines.map(item=>item.orderNumber))].map(number=>{
   const current=h.lines.filter(item=>item.orderNumber===number);
   return {number,id:current[0].orderId,currentQuantity:current.reduce((sum,item)=>sum+item.quantity,0),
    fulfillmentStatus:current[0].fulfilled?'fulfilled':'unfulfilled',items:current.filter(item=>item.proof!==false).map(item=>({
     id:item.lineId,sku,barcode:item.barcode,variantId:item.variantId,name:item.name,quantity:item.quantity}))};
  })}}));
 h.lookup=jest.fn(async keys=>({products:resolveProducts(keys,h.products),sync:{source_note:'Read-only local test catalog'}}));
 h.prepare=createMarketplacePreparation({pool:h.pool,verifyShopify:h.verifyShopify,resolveProducts:h.lookup});
 h.input=()=>({rows:rowsFor(h.lines)});
 return h;
}
const expectReadOnly=h=>{
 expect(h.pool.connect).not.toHaveBeenCalled();
 expect(h.pool.query.mock.calls.every(([sql])=>/^SELECT\b/.test(sql))).toBe(true);
};

test('two complete Shopify models sharing one exact ERP barcode convert automatically and retain each source identity',async()=>{
 const h=harness(),input=h.input(),result=await h.prepare(input);
 expect(result.output.ok).toBe(true);expect(result.prepick.ok).toBe(true);
 expect(result.barcodeConflicts).toEqual([]);expect(result.barcodeReviews).toEqual([]);
 expect(result.output.summary).toMatchObject({physicalQuantity:2,sourceTotalMinor:178000,ecountTotalMinor:178000});
 expect(result.settings.skuMappings[sku]).toMatchObject({erpSku:sku,barcode:sku,barcodeConfirmed:true,confirmed:true});
 expect(result.parsed.items.map(item=>({sourceLineId:item.sourceLineId,name:item.productName,quantity:item.quantity}))).toEqual(
  h.lines.map(item=>({sourceLineId:item.lineId,name:item.name,quantity:item.quantity})));
 expect(result.sourceEvidence.rows).toEqual(input.rows);
 expect(result.sourceEvidence.verification.orders[0].items).toEqual(h.lines.map(item=>({id:item.lineId,sku,barcode:sku,
  variantId:item.variantId,name:item.name,quantity:item.quantity})));
 expect(result.prepick.rows).toHaveLength(1);
 expect(result.prepick.rows[0][result.prepick.headers.indexOf('實體數量')]).toBe(2);
 expect(result.prepick.rows[0][result.prepick.headers.indexOf('ECOUNT品項編碼')]).toBe(sku);
 expectReadOnly(h);
});

test('450 shared units from different models and orders export as 200, 200, 50 with source quantity and money allocations',async()=>{
 const h=harness();
 Object.assign(h.lines[0],{orderNumber:'#SHARED-FIRST',quantity:210,price:100});
 Object.assign(h.lines[1],{orderNumber:'#SHARED-SECOND',orderId:'900002',quantity:240,price:200});
 const result=await h.prepare(h.input());
 expect(result.output.ok).toBe(true);expect(result.prepick.ok).toBe(true);
 const {prepareEcountFinancials,buildEcountUploadTable}=await import('../services/marketplaceIntake.mjs');
 const record={...result.output,settings:result.settings,orders:result.parsed.orders,items:result.parsed.items};
 const view=prepareEcountFinancials(record),file=buildEcountUploadTable(record);
 expect(view.rows.map(row=>row[19])).toEqual([200,200,50]);
 expect(file.headers).toHaveLength(27);
 expect(file.rows.map(row=>row[file.headers.indexOf('數量')])).toEqual([200,200,50]);
 expect(file.rows.every(row=>row[file.headers.indexOf('品項編碼')]===sku)).toBe(true);
 expect(view.rows.reduce((sum,row)=>sum+row[23]+row[24],0)).toBe(69000);
 expect(result.output.summary).toMatchObject({physicalQuantity:450,sourceTotalMinor:6900000,ecountTotalMinor:6900000});
 expect(result.prepick.rows).toHaveLength(1);expect(result.prepick.rows[0][5]).toBe(450);
 const allocations=result.output.salesLayout.lines.flatMap(item=>item.allocations);
 for(const item of result.parsed.items){
  const source=allocations.filter(allocation=>allocation.identity[2]===item.sourceOrderNumber&&allocation.identity[3]===item.sourceLineId);
  expect(source.reduce((sum,allocation)=>sum+allocation.quantity,0)).toBe(item.quantity);
  expect(source.reduce((sum,allocation)=>sum+allocation.sourceGrossMinor,0)).toBe(item.lineSubtotalMinor);
 }
 expect(result.parsed.items.map(item=>item.productName)).toEqual(names);
 expectReadOnly(h);
});

test('a single complete version keeps automatic matching',async()=>{
 const h=harness();h.lines.pop();const result=await h.prepare(h.input());
 expect(result.output.ok).toBe(true);expect(result.prepick.ok).toBe(true);expect(result.barcodeConflicts).toEqual([]);
 expect(result.output.summary).toMatchObject({physicalQuantity:1,ecountTotalMinor:89000});expectReadOnly(h);
});

test.each(['missing second variant','invalid second variant','missing second source proof','missing single variant'])(
 '%s cannot borrow another line or exact barcode to enable conversion',async change=>{
  const h=harness();
  if(change==='missing second variant')h.lines[1].variantId='';
  if(change==='invalid second variant')h.lines[1].variantId='gid://shopify/LineItem/920002';
  if(change==='missing second source proof')h.lines[1].proof=false;
  if(change==='missing single variant'){h.lines.pop();h.lines[0].variantId='';}
  const result=await h.prepare(h.input());
  expect(result.output).toMatchObject({ok:false,rows:[]});expect(result.prepick).toMatchObject({ok:false,rows:[]});
  expect(result.barcodeConflicts).toHaveLength(1);expect(result.barcodeConflicts[0].canConfirm).toBe(false);
  expect(result.settings.skuMappings[sku].barcodeConfirmed).toBe(false);expect(result.barcodeReviews).toEqual([]);expectReadOnly(h);
 });

test('an eligible duplicate order and line identity cannot convert as two shared models',async()=>{
 const h=harness();h.lines[1].lineId=h.lines[0].lineId;
 const result=await h.prepare(h.input());
 expect(result.output.ok).toBe(false);expect(result.output.rows).toEqual([]);
 expect(result.output.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'SOURCE_LINE_ID_COLLISION'})]));
 expectReadOnly(h);
});

test('shared versions with a blank ERP barcode retain the existing explicit review requirement',async()=>{
 const h=harness();h.products[0].barcode='';const result=await h.prepare(h.input());
 expect(result.output).toMatchObject({ok:false,rows:[]});expect(result.prepick).toMatchObject({ok:false,rows:[]});
 expect(result.barcodeConflicts[0]).toMatchObject({reviewReason:'ERP_BARCODE_MISSING',erpBarcode:'',sourceBarcode:sku,canConfirm:true});
 expect(result.barcodeConflicts[0]).not.toHaveProperty('barcodeProof');expectReadOnly(h);
});

test('fully blank API barcodes still require a physical scan and persisted review instead of inferring the shared SKU',async()=>{
 const h=harness();for(const item of h.lines)item.barcode='';const result=await h.prepare(h.input());
 expect(result.output).toMatchObject({ok:false,rows:[]});expect(result.prepick).toMatchObject({ok:false,rows:[]});
 expect(result.barcodeConflicts[0]).toMatchObject({sourceBarcode:'',physicalBarcode:'',barcodeProof:'physical-scan-v1',
  requiresPhysicalBarcode:true,canEnterPhysicalBarcode:true,canConfirm:false});
 expect(result.settings.skuMappings[sku]).toMatchObject({barcode:'',barcodeConfirmed:false});
 expect(result.sourceEvidence.verification.orders[0].items.every(item=>item.barcode==='')).toBe(true);expectReadOnly(h);
});

test('an explicit physical scan and server review unlock 450 shared units while API and ERP barcode evidence stay blank',async()=>{
 const h=harness();h.products[0].barcode='';
 Object.assign(h.lines[0],{orderNumber:'#SHARED-FIRST',quantity:210,price:100,barcode:''});
 Object.assign(h.lines[1],{orderNumber:'#SHARED-SECOND',orderId:'900002',quantity:240,price:200,barcode:''});
 const savedReviews=[];
 h.pool.query.mockImplementation(async(sql,params)=>{
  if(sql.startsWith('INSERT INTO marketplace_product_mapping_reviews')){
   const record={id:31,store_profile_id:params[0],fingerprint:params[1],evidence:JSON.parse(params[2]),
    confirmed_by:params[3],confirmed_at:'2026-10-13T01:00:00Z'};
   savedReviews.push(record);return {rows:[record]};
  }
  if(!/^SELECT\b/.test(sql))throw Error('Only in-memory review insertion is allowed in this test');
  if(sql.includes('marketplace_product_mapping_reviews'))return {rows:savedReviews.filter(record=>
   record.store_profile_id===params[0]&&(sql.includes("evidence->>'barcodeProof'='physical-scan-v1'")?
    params[1].includes(record.evidence.sourceSku):params[1].includes(record.fingerprint)))};
  return {rows:sql.includes('marketplace_store_profiles')?[h.profile]:[]};
 });
 const initial=await h.prepare(h.input());
 expect(initial.output.ok).toBe(false);
 expect(initial.barcodeConflicts[0]).toMatchObject({sourceBarcode:'',erpBarcode:'',physicalBarcode:'',barcodeProof:'physical-scan-v1',canConfirm:false});
 const scanned=await h.prepare({...h.input(),settings:{skuMappings:{[sku]:{physicalBarcode:sku}}}},{refresh:true});
 expect(scanned.output.ok).toBe(false);expect(scanned.prepick.ok).toBe(false);
 expect(scanned.barcodeConflicts[0]).toMatchObject({sourceBarcode:'',erpBarcode:'',physicalBarcode:sku,
  barcodeProof:'physical-scan-v1',variantIds:h.lines.map(item=>item.variantId),canConfirm:true});
 expect(scanned.settings.skuMappings[sku].barcodeConfirmed).toBe(false);
 const record=await confirmBarcodeReview(h.pool,scanned.barcodeReviewCandidates[0],{id:9,role:'admin'});
 expect(record.evidence).toMatchObject({sourceBarcode:'',erpBarcode:'',physicalBarcode:sku,barcodeProof:'physical-scan-v1'});
 const approved=await h.prepare(h.input(),{refresh:true});
 expect(approved.output.ok).toBe(true);expect(approved.prepick.ok).toBe(true);expect(approved.barcodeConflicts).toEqual([]);
 expect(approved.barcodeReviews).toEqual([{id:record.id,fingerprint:record.fingerprint,evidence:record.evidence}]);
 expect(approved.settings.skuMappings[sku]).toMatchObject({barcode:sku,physicalBarcode:sku,barcodeConfirmed:true});
 expect(approved.prepick.rows).toHaveLength(1);expect(approved.prepick.rows[0][5]).toBe(450);
 expect(approved.output.salesLayout.lines.map(item=>item.quantity)).toEqual([200,200,50]);
 expect(approved.output.summary).toMatchObject({physicalQuantity:450,sourceTotalMinor:6900000,ecountTotalMinor:6900000});
 expect(approved.parsed.items.map(item=>item.productName)).toEqual(names);
 expect(approved.sourceEvidence.verification.orders.flatMap(order=>order.items).map(item=>({id:item.id,variantId:item.variantId,barcode:item.barcode}))).toEqual(
  h.lines.map(item=>({id:item.lineId,variantId:item.variantId,barcode:''})));
 expect(h.products[0].barcode).toBe('');expect(h.pool.connect).not.toHaveBeenCalled();
 expect(h.pool.query.mock.calls.filter(([sql])=>!/^SELECT\b/.test(sql))).toHaveLength(1);
});

test('one blank API barcode blocks shared conversion and cannot use physical confirmation',async()=>{
 const h=harness();h.lines[1].barcode='';const result=await h.prepare(h.input());
 expect(result.output).toMatchObject({ok:false,rows:[]});expect(result.prepick).toMatchObject({ok:false,rows:[]});
 expect(result.barcodeConflicts[0]).toMatchObject({reviewReason:'SOURCE_BARCODE_MISSING',canConfirm:false});
 expect(result.barcodeConflicts[0].requiresPhysicalBarcode).not.toBe(true);expectReadOnly(h);
});

test('different nonempty API barcodes for one source SKU remain ambiguous',async()=>{
 const h=harness();h.lines[1].barcode='4711299271380';
 await expect(h.prepare(h.input())).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});expectReadOnly(h);
});

test.each(['ambiguous','inactive'])('%s ERP identities cannot produce a sales file for shared models',async state=>{
 const h=harness();
 if(state==='ambiguous')h.products.push({...h.products[0],erp_sku:'AUDIT-DUPLICATE'});
 else h.products[0].active=false;
 const result=await h.prepare(h.input());
 expect(result.output).toMatchObject({ok:false,rows:[]});
 expect(result.settings.skuMappings[sku].confirmed).toBe(false);expect(result.settings.skuMappings[sku].barcodeConfirmed).toBe(false);
 expect(result.barcodeReviews).toEqual([]);expectReadOnly(h);
});

test('a fulfilled same-SKU order with a different barcode is excluded from the eligible shared conversion',async()=>{
 const h=harness();h.lines.push({...line(2),orderNumber:'#SHARED-FULFILLED',orderId:'900003',name:'已出貨版本',
  fulfilled:true,barcode:'4711299271380',variantId:''});
 const result=await h.prepare(h.input());
 expect(result.output.ok).toBe(true);expect(result.prepick.ok).toBe(true);expect(result.barcodeConflicts).toEqual([]);
 expect(result.output.summary).toMatchObject({physicalQuantity:2,ecountTotalMinor:178000});
 expect(result.parsed.items.map(item=>item.productName)).toEqual(names);
 expect(result.choices).toEqual(expect.arrayContaining([expect.objectContaining({number:'#SHARED-FULFILLED',eligible:false})]));
 expect(result.sourceEvidence.verification.orders.find(order=>order.number==='#SHARED-FULFILLED').items[0].barcode).toBe('4711299271380');
 expectReadOnly(h);
});
