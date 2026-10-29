const {randomBytes,randomUUID}=require('node:crypto');
const {createMarketplacePreparation}=require('../../src/services/marketplacePreparation');
const {createMarketplaceDraftOverwriteService}=require('../../src/services/marketplaceDraftOverwrite');
const {resolveProducts}=require('../../src/services/marketplaceProductCatalog');
const {enableFlow}=require('../../src/services/warehouseRelease');
const sku='4711299273094';
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(record=>headers.map(key=>record[key]??''))];};
const row=(number,id,quantity=2)=>({Name:number,Id:String(id),'Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:String(quantity*100),Shipping:'0',Taxes:'0',Total:String(quantity*100),'Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Payment Method':'credit_card','Lineitem quantity':String(quantity),'Lineitem name':'Synthetic physical product','Lineitem price':'100','Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':`gid://shopify/LineItem/${id}`,'Lineitem requires shipping':'true','Shipping Name':'Synthetic recipient','Shipping Phone':'0000000000','Shipping Address1':'Synthetic local address'});
async function createMixedFixture(pool,users){
 const tag=randomBytes(5).toString('hex').toUpperCase(),store='Native synthetic '+tag,base=Number.parseInt(tag.slice(0,7),16)+100000;
 const numbers={A:'#N'+tag+'A',B:'#N'+tag+'B',C:'#N'+tag+'C'},originals={A:row(numbers.A,base),B:row(numbers.B,base+1),C:row(numbers.C,base+2)};
 const apiRows=new Map(Object.values(originals).map(record=>[record.Name,[record]]));
 const settings={store,customerCode:'LOCAL',customerName:'Synthetic local customer',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,date:'2026-10-29',batchSequence:'1',batchNumber:'TEST-'+tag,salesExportMode:'product-200-v1',skuMappings:{[sku]:{erpSku:sku,erpName:'Synthetic ERP product',barcode:sku,confirmed:true,barcodeConfirmed:true}}};
 const profile=(await pool.query('INSERT INTO marketplace_store_profiles(platform,store,settings,updated_by) VALUES($1,$2,$3,$4) RETURNING id',['Shopify',store,JSON.stringify({...settings,shopifyShop:'native-fixture.myshopify.com'}),users.dispatcher.id])).rows[0];
 let verificationCalls=0;
 const unified=await import('../../src/services/unifiedMarketplace.mjs');
 const verifyShopify=async rows=>{
  verificationCalls++;
  const field=rows[0].indexOf('Name'),requested=[...new Set(rows.slice(1).map(record=>record[field]).filter(Boolean))],records=requested.flatMap(number=>apiRows.get(number)||[]);
  if(records.length!==requested.length)throw Error('Synthetic verifier has no fixture for requested order');
  const live=table(records),raw=unified.parseUnifiedMarketplace(live).parsed;
  const orders=raw.orders.map(order=>{
   const items=raw.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber),quantity=items.reduce((sum,item)=>sum+item.quantity,0),financial=order.financial;
   return {number:order.sourceOrderNumber,id:records.find(record=>record.Name===order.sourceOrderNumber).Id,cancelled:false,cancelledAt:null,currency:'TWD',fulfillmentStatus:'unfulfilled',paymentStatus:'paid',currentQuantity:quantity,remainingQuantity:quantity,subtotalMinor:financial.subtotalMinor,shippingMinor:financial.shippingMinor,discountMinor:financial.discountMinor,productDiscountMinor:financial.discountMinor,shippingGrossMinor:financial.shippingMinor,shippingDiscountMinor:0,shippingCancellationMinor:0,shippingLines:[],removedLineIds:[],totalMinor:financial.totalMinor,receivedMinor:financial.totalMinor,outstandingMinor:0,shippingSource:'shopify-current',items:items.map(item=>({id:item.sourceLineId,sku:item.sku,barcode:sku,variantId:'gid://shopify/ProductVariant/50001',quantity:item.quantity,unfulfilledQuantity:item.quantity,netMinor:item.lineSubtotalMinor}))};
  });
  return {rows:live,verification:{mode:'api',platform:'Shopify',shop:'native-fixture.myshopify.com',version:'shopify-current-v2',orders}};
 };
 const prepareMarketplace=createMarketplacePreparation({pool,verifyShopify,resolveProducts:async skus=>({sync:null,products:resolveProducts(skus,[{erp_sku:sku,barcode:sku,product_name:'Synthetic ERP product',spec:'',active:true}])})});
 const service=createMarketplaceDraftOverwriteService({pool,prepareMarketplace,mixedEnabled:()=>true,enabled:()=>true});
 // Seed a normal pre-existing, unexecuted owner using the actual preparation
 // result. This is synthetic setup; the operation under test creates the run.
 const ownerRows=table([originals.A,originals.B]),conversion=await prepareMarketplace({rows:ownerRows,settings,profileId:String(profile.id)},{refresh:true});
 if(!conversion.output.ok)throw Error('Synthetic owner preparation failed: '+JSON.stringify(conversion.output.issues));
 const snapshot={platform:'Shopify',handler:{userId:users.dispatcher.id,name:users.dispatcher.name},settings:conversion.settings,sourceEvidence:conversion.sourceEvidence,barcodeReviews:conversion.barcodeReviews,summary:conversion.output.summary,headers:conversion.output.headers,rows:conversion.output.rows,reportHeaders:conversion.output.reportHeaders,reportRows:conversion.output.reportRows,orders:conversion.parsed.orders.map(order=>({...order,sourceFinancial:conversion.raw.orders.find(raw=>raw.sourceOrderNumber===order.sourceOrderNumber).financial})),items:conversion.parsed.items,prepick:conversion.prepick,...(conversion.output.salesLayout?{salesLayout:conversion.output.salesLayout}:{}),...(conversion.output.rounding?{rounding:conversion.output.rounding}:{})};
 const owner=(await pool.query('INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,fingerprint,created_by,snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[settings.batchNumber,'Shopify',store,tag.padEnd(64,'0'),users.dispatcher.id,JSON.stringify(snapshot)])).rows[0];
 const {warehouseProductDetails,mappingScanIdentity}=await import('../../src/services/marketplaceIntake.mjs');
 for(const order of snapshot.orders){const items=snapshot.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber).map(item=>({sourceLineId:item.sourceLineId,sourceSku:item.sku,productCode:sku,...warehouseProductDetails(item,snapshot.settings.skuMappings[sku]),quantity:item.quantity,...mappingScanIdentity(snapshot.settings.skuMappings[sku]),groupName:item.groupName}));await pool.query('INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number,expected_items,financial) VALUES($1,$2,$3,$4,$5,$6)',[owner.id,'Shopify',store,order.sourceOrderNumber,JSON.stringify(items),JSON.stringify({source:order.sourceFinancial,ecount:order.financial})]);}
 await enableFlow(pool,owner.id,users.dispatcher.id);
 const records=[row(numbers.A,base,1),originals.C];
 const request={scopeMode:'uploaded-file-v2',rows:table(records),settings,profileId:String(profile.id)};
 async function body(){const preview=await service.preview(request,users.dispatcher);if(!preview.canConfirm)throw Error('Synthetic mixed preview blocked: '+JSON.stringify(preview.blockedReasons));return {...request,commandId:randomUUID(),confirmed:true,notImportedConfirmed:true,previewFingerprint:preview.previewFingerprint};}
 async function criticalState(){const state={};for(const name of ['marketplace_intakes','marketplace_intake_orders','marketplace_warehouse_flows','marketplace_intake_scope_orders','marketplace_draft_revisions','marketplace_draft_commands','orders','order_items','marketplace_work_order_links'])state[name]=(await pool.query('SELECT * FROM '+name+' ORDER BY 1')).rows;return state;}
 async function receipt(id){const record=(await pool.query('SELECT * FROM marketplace_intakes WHERE id=$1',[id])).rows[0],{prepareEcountFinancials}=await import('../../src/services/marketplaceIntake.mjs'),view=prepareEcountFinancials(record.snapshot),H=require('../../src/services/erpSalesReceipt').HEADERS;return [H,...view.rows.map(line=>['LOCAL-'+tag,record.batch_number,line[2],line[6],line[7],line[13],line[14],line[12],line[15],line[11],line[19],line[23],line[24],line[23]+line[24],sku,'',''])];}
 function setQuantity(letter,quantity){const record=row(numbers[letter],base+['A','B','C'].indexOf(letter),quantity);apiRows.set(record.Name,[record]);const index=records.findIndex(value=>value.Name===record.Name);if(index<0)throw Error('Synthetic uploaded fixture is not selected');records[index]=record;request.rows=table(records);}
 return {tag,store,owner,settings,numbers,records,service,request,body,criticalState,receipt,setQuantity,sku,get verificationCalls(){return verificationCalls;}};
}
module.exports={createMixedFixture};
