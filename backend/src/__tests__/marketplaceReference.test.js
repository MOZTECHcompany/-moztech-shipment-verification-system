const {resolveProducts,lookupProducts,verifyCatalogMappings,createReferenceReader}=require('../services/marketplaceProductCatalog');
const products=[
 {erp_sku:'4711299271342',product_name:'一般款',barcode:'',active:true},
 {erp_sku:'47112992713422',product_name:'秒貼款',barcode:'',active:false},
 {erp_sku:'NEW0012',product_name:'保留完整貨號',barcode:'0012',active:true},
];
const reader=async()=>({products,capturedAt:'2026-09-16T00:00:00Z',source:'Local reference fixture'});
test('full source string matches exact ERP code or barcode without stripping prefix, suffix or leading zero',()=>{
 const r=resolveProducts(['47112992713422','4711299271342','0012','NEW0012','12','new0012'],products);
 expect(r['47112992713422'].status).toBe('inactive');expect(r['47112992713422'].matches[0].erp_sku).toBe('47112992713422');
 expect(r['0012'].matches[0].erp_sku).toBe('NEW0012');expect(r.NEW0012.status).toBe('matched');expect(r['12'].status).toBe('missing');expect(r.new0012.status).toBe('missing');
});
test('code and barcode pointing to different products remain ambiguous even when one is active',()=>{
 expect(resolveProducts(['0012'],[...products,{erp_sku:'0012',barcode:'',active:false}])['0012'].status).toBe('ambiguous');
});
test('conversion validates only included SKUs and never silently rewrites an exact mapping',async()=>{
 const settings={skuMappings:{'0012':{erpSku:'NEW0012'},'47112992713422':{erpSku:'4711299271342'}}};
 await expect(verifyCatalogMappings(null,settings,['0012'],reader)).resolves.toBeUndefined();
 await expect(verifyCatalogMappings(null,settings,['47112992713422'],reader)).rejects.toThrow('中止使用');
 settings.skuMappings['0012'].erpSku='0012';await expect(verifyCatalogMappings(null,settings,['0012'],reader)).rejects.toThrow('NEW0012');
});
test('only requested matching product data and reference date are returned',async()=>{
 const r=await lookupProducts(['0012'],reader);expect(Object.keys(r.products)).toEqual(['0012']);expect(r.sync.product_count).toBe(3);expect(JSON.stringify(r)).not.toContain('一般款');
});
test('reference reader is read-only, cached and requires unique exact codes',async()=>{
 const download=jest.fn().mockResolvedValue([Buffer.from(JSON.stringify(await reader()))]);const file=jest.fn(()=>({download})),bucket=jest.fn(()=>({file}));
 const read=createReferenceReader({env:{GCS_BUCKET:'private-dev',ECOUNT_REFERENCE_OBJECT:'reference.json'},storage:{bucket}});
 await read();await read();expect(download).toHaveBeenCalledTimes(1);expect(file).toHaveBeenCalledWith('reference.json');
 const empty=createReferenceReader({env:{}});await expect(empty()).resolves.toBeNull();
});
