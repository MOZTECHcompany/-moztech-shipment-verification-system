const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {safeSettings}=require('../src/services/marketplaceSettings');
const {createMarketplacePreparation}=require('../src/services/marketplacePreparation');
const {resolveProducts,verifyCatalogMappings}=require('../src/services/marketplaceProductCatalog');
const {confirmBarcodeReview,verifySavedBarcodeReviews,revokeBarcodeReview}=require('../src/services/marketplaceBarcodeReviews');
const {reconcileSales}=require('../src/services/erpSalesReceipt');
const {parseOrderRows}=require('../src/services/orderImportParser');
const sku='AUDIT-NO-EAN',scan='ITM-AUDIT-NO-EAN',actor={id:1,role:'dispatcher'};
const product=()=>({erp_sku:sku,barcode:'',product_name:'AUDIT ERP no EAN',spec:'AUDIT specification',active:true});
const settings={store:'AUDIT store',customerCode:'AUDIT-CUSTOMER',customerName:'AUDIT store',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}};
const records=()=>[0,1].map(i=>({Name:`#AUDIT-INT-${i+1}`,Id:`910${i+1}`,'Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'100',Shipping:'0',Taxes:'0',Total:'100','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Lineitem quantity':'1','Lineitem name':`AUDIT no EAN ${i+1}`,'Lineitem price':'100','Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':`gid://shopify/LineItem/${i+1}`}));
const table=rs=>{const headers=Object.keys(rs[0]);return [headers,...rs.map(r=>headers.map(h=>r[h]??''))];};
const proposal=(code=scan,erpSku=sku)=>({skuMappings:{[sku]:{erpSku,scanCodeType:'internal',internalScanCode:code,barcode:'',barcodeConfirmed:false}}});

describe('explicit internal scan identity',()=>{
 test.each(['4711299270086','SN0000000001','CT-0001','ITM-','ITM-X\nY','ITM-'+'A'.repeat(97)])('refuses non-internal identity %s',code=>expect(()=>safeSettings(proposal(code))).toThrow());
 test('native import requires explicit code and preserves full SKU/source line',()=>{
  const header=['理貨單號','商城訂單編號','平台','店鋪','來源明細號','品項編碼','品項名稱','國際條碼','數量','內部掃描碼','來源SKU'];
  const row=['AUDIT-PICK','AUDIT-ORDER','1Shop','AUDIT-STORE','AUDIT-LINE',sku,'AUDIT Product','',10,scan,'0012345678905-團主-第01團'];
  expect(parseOrderRows([header,row]).items[0]).toMatchObject({productCode:sku,barcode:scan,internationalBarcode:null,internalScanCode:scan,codeType:'internal',sourceSku:row[10],sourceOrderNumber:'AUDIT-ORDER',sourceLineId:'AUDIT-LINE',quantity:10});
  row[9]='';expect(()=>parseOrderRows([header,row])).toThrow(/國際條碼必填/);
  expect(()=>safeSettings({skuMappings:{[sku]:{...proposal().skuMappings[sku],barcode:scan}}})).toThrow();
 });
});

describe('EC persisted internal proof and saved-sales return',()=>{
 let db,pool,h;
 beforeAll(async()=>{
  db=new PGlite();await db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE marketplace_store_profiles(id INTEGER PRIMARY KEY,platform TEXT,store TEXT,settings JSONB,updated_at TIMESTAMPTZ); CREATE TABLE order_items(barcode TEXT);');
  await db.query('INSERT INTO marketplace_store_profiles VALUES(1,$1,$2,$3,NOW())',['Shopify',settings.store,settings]);
  for(const name of ['038_marketplace_product_mapping_reviews.sql','039_order_item_scan_identity.sql'])await db.exec(readFileSync(require.resolve('../migrations/'+name),'utf8'));
 });
 beforeEach(async()=>{
  await db.exec('TRUNCATE marketplace_product_mapping_reviews,marketplace_internal_scan_codes RESTART IDENTITY');
  h={products:[product()],records:records(),variants:['gid://shopify/ProductVariant/101','gid://shopify/ProductVariant/102'],barcodes:['',''],writes:[]};
  pool={query:async(...args)=>{if(!args[0].startsWith('SELECT'))h.writes.push(args);return db.query(...args);},connect:jest.fn(()=>{throw Error('operational DB forbidden');})};
  h.prepare=createMarketplacePreparation({pool,verifyShopify:async()=>({rows:table(h.records),verification:{shop:'audit.myshopify.com',fingerprint:'AUDIT live version',orders:h.records.map((r,i)=>({number:r.Name,id:r.Id,currentQuantity:1,items:[{id:r['Lineitem id'],sku:r['Lineitem sku'],variantId:h.variants[i],barcode:h.barcodes[i]}]}))}}),resolveProducts:async keys=>({products:resolveProducts(keys,h.products)}),classifyReimports:async()=>({reimports:[],fingerprint:'AUDIT reimports'})});
 });
 afterAll(async()=>{await db?.close();});
 const input=extra=>({rows:table(h.records),profileId:'1',settings:extra||{}}),reader=async()=>({products:h.products});
 async function approve(){
  const fresh=await h.prepare(input(proposal()),{refresh:true}),record=await confirmBarcodeReview(pool,fresh.barcodeConflicts[0],actor);
  const approved=await h.prepare(input(proposal()),{refresh:true});
  const saved={...approved.output,items:approved.parsed.items,orders:approved.parsed.orders,settings:approved.settings,sourceEvidence:approved.sourceEvidence,barcodeReviews:approved.barcodeReviews};
  return {record,approved,saved};
 }
 test('client confirmation cannot bypass persisted proof, EAN stays blank',async()=>{
  const fresh=await h.prepare(input(proposal()));expect(fresh.output.ok).toBe(false);expect(fresh.prepick.ok).toBe(false);
  expect(fresh.barcodeConflicts[0]).toMatchObject({canConfirm:true,barcodeProof:'internal-scan-v1',codeType:'internal',internalScanCode:scan,requiresInternalScanCode:true});
  expect(fresh.settings.skuMappings[sku]).toMatchObject({barcode:'',internalScanConfirmed:false});expect(h.writes).toEqual([]);
  const {approved,saved}=await approve();expect(approved.output.ok).toBe(true);expect(approved.prepick.ok).toBe(true);
  expect(approved.settings.skuMappings[sku]).toMatchObject({barcode:'',barcodeConfirmed:false,internalScanCode:scan,internalScanConfirmed:true});
  expect(approved.sourceEvidence.verification.orders.every(o=>o.items.every(i=>i.barcode===''))).toBe(true);
  const context=await verifySavedBarcodeReviews(pool,saved,reader,{returnContext:true});
  await expect(verifyCatalogMappings(pool,saved.settings,[sku],reader,context,saved)).resolves.toBeUndefined();
  await expect(verifyCatalogMappings(pool,saved.settings,[sku],reader,undefined,saved)).rejects.toThrow(/核對紀錄/);expect(pool.connect).not.toHaveBeenCalled();
 });
 test('altered or revoked codes cannot reuse old review',async()=>{
  const {record,saved}=await approve();for(const code of ['', 'ITM-AUDIT-OTHER'])expect((await h.prepare(input(proposal(code)),{refresh:true})).output.ok).toBe(false);
  saved.settings.skuMappings[sku].internalScanCode='ITM-AUDIT-OTHER';await expect(verifySavedBarcodeReviews(pool,saved,reader)).rejects.toThrow(/內碼對照/);
  await revokeBarcodeReview(pool,record.id,actor);expect((await h.prepare(input(proposal()),{refresh:true})).output.ok).toBe(false);
 });
 test.each(['sourceBarcode','erpBarcode','missingVariant','inactive','codeCollision'])('refuses unsafe %s without writes',async change=>{
  if(change==='sourceBarcode')h.barcodes[0]='4710000000013';if(change==='erpBarcode')h.products[0].barcode='4710000000013';if(change==='missingVariant')h.variants[1]='';if(change==='inactive')h.products[0].active=false;if(change==='codeCollision')h.products.push({...product(),erp_sku:'AUDIT-OTHER',barcode:scan});
  const preview=await h.prepare(input(proposal()),{refresh:true});expect(preview.output.ok).toBe(false);expect(preview.barcodeReviews).toEqual([]);expect(preview.barcodeConflicts.every(c=>!c.canConfirm)).toBe(true);expect(h.writes).toEqual([]);
 });
 test('internal label cannot be borrowed by another item',async()=>{
  await approve();await db.query('UPDATE marketplace_internal_scan_codes SET product_code=$1 WHERE internal_scan_code=$2',['AUDIT-OTHER',scan]);expect((await h.prepare(input(proposal()),{refresh:true})).output.ok).toBe(false);
 });
 test.each(['SHOPLINE','1Shop'])('verified %s order quantities support an explicit internal label',async platform=>{
  await db.query('UPDATE marketplace_store_profiles SET platform=$1 WHERE id=1',[platform]);
  const rows=platform==='1Shop'?[['訂單編號','名稱','產品SKU','產品','產品數量','單價','小計','訂單金額(不含金/物流手續費)','訂單金流手續費','訂單運費','總計金額','金流狀態','物流狀態'],['AUDIT-EC-ORDER','一般品',sku,'AUDIT product',1,100,100,100,0,0,100,'已付款','未出貨']]:[['訂單編號','商品貨號','商品名稱','數量','單價','付款狀態','送貨狀態','付款方式','訂單狀態','訂單小計','運費','優惠折扣','訂單合計'],['AUDIT-EC-ORDER',sku,'AUDIT product',1,100,'已付款','備貨中','信用卡','已確認',100,0,0,100]];
  const verify=async()=>({rows,verification:{platform,shop:'AUDIT merchant',fingerprint:'AUDIT source checked',orders:[{number:'AUDIT-EC-ORDER',items:[{sku,quantity:1,netMinor:10000}]}]}});
  const prepare=createMarketplacePreparation({pool,verifyShopline:verify,verifyOneShop:verify,resolveProducts:async keys=>({products:resolveProducts(keys,h.products)}),classifyReimports:async()=>({reimports:[],fingerprint:'AUDIT new'})});
  const request={rows,profileId:'1',settings:proposal()},fresh=await prepare(request,{refresh:true});
  expect(fresh.output.ok).toBe(false);expect(fresh.barcodeConflicts[0]).toMatchObject({canConfirm:true,requiresInternalScanCode:true});
  await confirmBarcodeReview(pool,fresh.barcodeConflicts[0],actor);
  const approved=await prepare(request,{refresh:true});expect(approved.output.ok).toBe(true);expect(approved.prepick.ok).toBe(true);
  await expect(verifySavedBarcodeReviews(pool,{items:approved.parsed.items,settings:approved.settings,sourceEvidence:approved.sourceEvidence,barcodeReviews:approved.barcodeReviews},reader)).resolves.toBeUndefined();
  await db.query('UPDATE marketplace_store_profiles SET platform=$1 WHERE id=1',['Shopify']);
 });
 test('a missing source SKU may use a manually entered exact active ERP item only after persisted review',async()=>{
  const source='AUDIT-SOURCE-UNMAPPED';h.records.forEach(r=>r['Lineitem sku']=source);
  const request=input({skuMappings:{[source]:{erpSku:sku,scanCodeType:'internal',internalScanCode:scan,barcode:'',barcodeConfirmed:false}}});
  const fresh=await h.prepare(request,{refresh:true});expect(fresh.output.ok).toBe(false);expect(fresh.barcodeConflicts[0]).toMatchObject({sourceSku:source,erpSku:sku,canConfirm:true});
  await confirmBarcodeReview(pool,fresh.barcodeConflicts[0],actor);
  const approved=await h.prepare(request,{refresh:true});expect(approved.output.ok).toBe(true);
  const saved={items:approved.parsed.items,settings:approved.settings,sourceEvidence:approved.sourceEvidence,barcodeReviews:approved.barcodeReviews};
  const context=await verifySavedBarcodeReviews(pool,saved,reader,{returnContext:true});
  await expect(verifyCatalogMappings(pool,saved.settings,[source],reader,context,saved)).resolves.toBeUndefined();
 });
 test('saved-sales receipt prepares WMS scan identity and full source SKU without an ECOUNT write',async()=>{
  const {approved}=await approve(),{mappingScanIdentity}=await import('../src/services/marketplaceIntake.mjs');
  const orders=approved.parsed.orders.map(o=>({source_platform:o.sourcePlatform,source_store:settings.store,source_order_number:o.sourceOrderNumber,expected_items:approved.parsed.items.filter(i=>i.sourceOrderNumber===o.sourceOrderNumber).map(i=>({sourceLineId:i.sourceLineId,sourceSku:i.sku,productCode:sku,productName:i.productName,quantity:i.quantity,...mappingScanIdentity(approved.settings.skuMappings[sku])}))}));
  const savedSnapshot={...approved.output,items:approved.parsed.items,orders:approved.parsed.orders,settings:approved.settings};
  const {prepareEcountFinancials}=await import('../src/services/marketplaceIntake.mjs');
  const {HEADERS}=require('../src/services/erpSalesReceipt'),receipt=[HEADERS,...prepareEcountFinancials(savedSnapshot).rows.map(r=>['AUDIT-ERP-SAVED',approved.settings.batchNumber,r[2],r[6],r[7],r[13],r[14],r[12],r[15],r[11],r[19],r[23],r[24],r[23]+r[24],'','','',scan,sku])];
  const result=await reconcileSales(receipt,{batch_number:approved.settings.batchNumber,snapshot:savedSnapshot,orders});
  expect(result.parsed.workOrders.flatMap(o=>o.items).every(i=>i.barcode===scan&&i.internationalBarcode===null&&i.internalScanCode===scan&&i.sourceSku===sku)).toBe(true);expect(result.receipt.vouchers).toEqual(['AUDIT-ERP-SAVED']);
  expect(h.writes.every(([sql])=>sql.includes('marketplace_product_mapping_reviews')||sql.includes('marketplace_internal_scan_codes'))).toBe(true);
 });
});
