const {createMarketplacePreparation}=require('../services/marketplacePreparation');
const {resolveProducts,verifyCatalogMappings,previewCatalogMappingIssues}=require('../services/marketplaceProductCatalog');

const sku='4711299274572',wrongTarget='47111299274572',activeTarget='ERP-PLUS-BLACK';
const row={Name:'#CATALOG',Id:'7630000000001','Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',
 Subtotal:'890',Shipping:'0',Taxes:'0',Total:'890','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0',
 'Payment Method':'credit_card','Lineitem quantity':'1','Lineitem name':'萬能充Plus 極簡黑','Lineitem price':'890',
 'Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':'gid://shopify/LineItem/1'};
const rows=[Object.keys(row),Object.values(row)];
const profile={id:1,platform:'Shopify',store:'墨子科技 官網',settings:{store:'墨子科技 官網',customerCode:'00063',customerName:'墨子科技 官網',
 warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true}};
const product={erp_sku:activeTarget,product_name:'ECOUNT 萬能充Plus 黑',barcode:'',spec:'Plus 黑',active:true};
const sync={created_at:'2026-09-15T18:55:50.843Z',source_note:'ECOUNT reference',product_count:1};
const manual=erpSku=>({[sku]:{erpSku,erpName:'人員填寫的品名',confirmed:true,barcode:'',barcodeConfirmed:false}});
function harness(products=[product],configured=true,{sourceSku=sku,profileMappings}={}){
 const sourceRows=[rows[0],rows[0].map(key=>key==='Lineitem sku'?sourceSku:key==='Lineitem name'&&sourceSku!==sku?'萬能充Plus 極簡白':row[key])];
 const selectedProfile=profileMappings?{...profile,settings:{...profile.settings,skuMappings:profileMappings}}:profile;
 const pool={query:jest.fn(async sql=>({rows:sql.includes('marketplace_store_profiles')?[selectedProfile]:[]})),connect:jest.fn()};
 const lookup=jest.fn(async skus=>({sync:configured?sync:null,products:resolveProducts(skus,products)}));
 const verifyShopify=jest.fn(async()=>({rows:sourceRows,verification:{shop:'www-omfuture.myshopify.com',fingerprint:'current-order',orders:[{
  number:'#CATALOG',currentQuantity:1,items:[{id:'gid://shopify/LineItem/1',sku:sourceSku,barcode:sourceSku,variantId:'gid://shopify/ProductVariant/1'}],
 }]}}));
 const prepare=createMarketplacePreparation({pool,verifyShopify,resolveProducts:lookup,
  classifyReimports:async()=>({reimports:[],identities:[],fingerprint:'no-existing-orders'})});
 return {pool,lookup,prepare:settings=>prepare({rows:sourceRows,settings})};
}

test.each([sku,'4711299274589'])('missing source %s is blocked in preview with the reference date before confirmation can imply readiness',async sourceSku=>{
 const h=harness([product],true,{sourceSku}),result=await h.prepare({});
 expect(result.catalog.sync.created_at).toBe(sync.created_at);
 expect(result.catalog.mappingIssues).toEqual([expect.objectContaining({code:'ECOUNT_SOURCE_MISSING',sku:sourceSku,erpSku:sourceSku})]);
 expect(result.output).toMatchObject({ok:false,rows:[]});expect(result.prepick).toMatchObject({ok:false,rows:[]});
 expect(result.catalog.mappingIssues[0].message).toContain('更新主檔');
 expect(result.parsed.summary.totalQuantity).toBe(1);expect(result.raw.orders[0].financial.totalMinor).toBe(89000);
 expect(h.pool.connect).not.toHaveBeenCalled();
});

test('checking confirmation cannot make a nonexistent 14-digit ERP target downloadable',async()=>{
 const h=harness(),result=await h.prepare({skuMappings:manual(wrongTarget)});
 expect(h.lookup).toHaveBeenCalledWith([sku,wrongTarget]);
 expect(result.settings.skuMappings[sku].erpSku).toBe(wrongTarget);
 expect(result.output).toMatchObject({ok:false,rows:[]});
 expect(result.output.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'ECOUNT_TARGET_MISSING',sku,erpSku:wrongTarget})]));
 expect(result.catalog.mappingIssues[0].message).toContain(wrongTarget);
});

test('a missing source may be explicitly mapped to an exact active ERP item without inventing a physical barcode',async()=>{
 const h=harness(),result=await h.prepare({skuMappings:manual(activeTarget)});
 expect(result.catalog.products[sku].status).toBe('missing');
 expect(result.catalog.products[activeTarget]).toMatchObject({status:'matched',matches:[product]});
 expect(result.catalog.mappingIssues).toEqual([]);expect(result.output.ok).toBe(true);
 expect(result.output.summary).toMatchObject({physicalQuantity:1,ecountTotalMinor:89000});
 expect(result.settings.skuMappings[sku]).toMatchObject({erpSku:activeTarget,barcode:'',barcodeConfirmed:false});
 expect(result.sourceEvidence.verification.orders[0].items[0].barcode).toBe(sku);
 await expect(verifyCatalogMappings(null,result.settings,[sku],async()=>({products:[product]}))).resolves.toBeUndefined();
});

test('a source barcode is not accepted as an ERP item code when only another item owns that barcode',async()=>{
 const barcode='4799999999999',h=harness([{...product,barcode}]);
 const result=await h.prepare({skuMappings:manual(barcode)});
 expect(result.catalog.products[barcode].status).toBe('matched');
 expect(result.catalog.mappingIssues).toEqual([expect.objectContaining({code:'ECOUNT_TARGET_MISSING',sku,erpSku:barcode})]);
 expect(result.output.ok).toBe(false);
});

test('a legacy profile mapping may retain an explicit exact active ERP target',async()=>{
 const h=harness([product],true,{profileMappings:manual(activeTarget)}),result=await h.prepare({});
 expect(h.lookup).toHaveBeenCalledWith([sku,activeTarget]);
 expect(result.catalog.mappingIssues).toEqual([]);expect(result.output.ok).toBe(true);
});

test('an exact current source match replaces a stale manual target without altering the source or fabricating a barcode',async()=>{
 const h=harness([{...product,erp_sku:sku}]),result=await h.prepare({skuMappings:manual(wrongTarget)});
 expect(result.settings.skuMappings[sku].erpSku).toBe(sku);expect(result.parsed.items[0].sku).toBe(sku);
 expect(result.catalog.mappingIssues).toEqual([]);expect(result.output.ok).toBe(true);
});

test('an ambiguous source cannot use an active alternate target to bypass catalog review',async()=>{
 const products=[{...product,erp_sku:sku},{...product,erp_sku:'OTHER',barcode:sku},product];
 const result=await harness(products).prepare({skuMappings:manual(activeTarget)});
 expect(result.catalog.mappingIssues).toEqual([expect.objectContaining({code:'ECOUNT_SOURCE_AMBIGUOUS',sku})]);
 expect(result.output).toMatchObject({ok:false,rows:[]});
});

test('an already resolved alternate review target remains visible to preview validation without changing barcode evidence',()=>{
 const settings={skuMappings:manual(activeTarget)};
 const catalog={sync,products:resolveProducts([sku],[product])};
 const barcodeCatalog={products:resolveProducts([activeTarget],[product])};
 expect(previewCatalogMappingIssues(settings,[sku],catalog,[barcodeCatalog])).toEqual([]);
 expect(settings.skuMappings[sku]).toMatchObject({erpSku:activeTarget,barcode:'',barcodeConfirmed:false});
});

test.each([
 ['target',[{...product,active:false}],activeTarget,'ECOUNT_TARGET_INACTIVE'],
 ['source',[{...product,erp_sku:sku,active:false},product],activeTarget,'ECOUNT_SOURCE_INACTIVE'],
])('inactive %s remains blocked even with an explicit confirmed mapping',async(label,products,target,code)=>{
 const result=await harness(products).prepare({skuMappings:manual(target)});
 expect(result.output).toMatchObject({ok:false,rows:[]});
 expect(result.catalog.mappingIssues).toEqual([expect.objectContaining({code,sku})]);
});

test('an unconfigured reference preserves the existing manual mapping workflow',async()=>{
 const result=await harness([],false).prepare({skuMappings:manual(wrongTarget)});
 expect(result.catalog.sync).toBeNull();expect(result.catalog.mappingIssues).toEqual([]);
 expect(result.output.ok).toBe(true);expect(result.settings.skuMappings[sku].erpSku).toBe(wrongTarget);
});

test('a failed configured reference lookup never downgrades to a manual-only preview',async()=>{
 const h=harness();h.lookup.mockRejectedValueOnce(new Error('reference unavailable'));
 await expect(h.prepare({skuMappings:manual(wrongTarget)})).rejects.toThrow('reference unavailable');
 expect(h.pool.connect).not.toHaveBeenCalled();
});
