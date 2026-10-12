const clean=value=>String(value??'').trim();
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value||{},k)).map(k=>[k,value[k]]));
function safeSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('轉檔設定格式無效'),{status:400});
 const value=pick(input,['apiConnectionId','shopifyShop','salesExportMode','projectOwner','salesOwner','erpStaffCode','erpProjectCode','erpResponsibilityConfirmed','store','customerCode','customerName','warehouseCode','date','batchSequence','batchNumber','currency','taxMode','taxType','taxConfirmed','erpCurrencyCode','erpCurrencyConfirmed','includeTestOrders','bundleZeroConfirmed','discountAllocationConfirmed','summaryNote']);
 const booleans=new Set(['erpResponsibilityConfirmed','taxConfirmed','erpCurrencyConfirmed','includeTestOrders','bundleZeroConfirmed','discountAllocationConfirmed','barcodeConfirmed','confirmed','erpConfirmed','nonStock','internalScanConfirmed']);
 function validate(record){
  for(const [name,v] of Object.entries(record)){
   if(booleans.has(name)?typeof v!=='boolean':typeof v!=='string'||v.length>255||/[\u0000-\u001f\u007f]/.test(v))throw Object.assign(new Error('轉檔設定欄位格式或長度無效：'+name),{status:400});
  }
  return record;
 }
 validate(value);
 if(!input.skuMappings||typeof input.skuMappings!=='object'||Array.isArray(input.skuMappings)||Object.keys(input.skuMappings).length>1000)throw Object.assign(new Error('商品對照格式無效'),{status:400});
 value.skuMappings=Object.fromEntries(Object.entries(input.skuMappings).map(([sku,m])=>[sku,pick(m,['erpSku','erpName','spec','barcode','physicalBarcode','scanCodeType','internalScanCode','internalScanConfirmed','barcodeConfirmed','confirmed','erpConfirmed','category'])]));
 value.shippingSku=pick(input.shippingSku,['erpSku','name','confirmed','nonStock','internalScanConfirmed']);
 for(const [sku,m] of Object.entries(value.skuMappings)){
  if(!sku||sku.length>100||!Object.keys(m).length)throw Object.assign(new Error('來源貨號或商品對照無效'),{status:400});
  validate(m);
  if(Object.hasOwn(m,'scanCodeType')&&!['international','internal'].includes(m.scanCodeType))throw Object.assign(new Error('掃描碼類型無效'),{status:400});
  if(m.scanCodeType==='internal'&&(clean(m.barcode)||m.barcodeConfirmed===true||m.internalScanCode&&!/^ITM-[A-Za-z0-9._-]{1,96}$/.test(m.internalScanCode)))throw Object.assign(new Error('內部掃描碼請使用 ITM- 開頭，國際條碼須保持空白'),{status:400});
  if(clean(m.erpSku).length>100||clean(m.barcode).length>100)throw Object.assign(new Error('商品編碼或條碼最多 100 字'),{status:400});
  if(Object.hasOwn(m,'physicalBarcode')&&(m.physicalBarcode.length>100||m.physicalBarcode&&(!clean(m.physicalBarcode)||/^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(clean(m.physicalBarcode)))))throw Object.assign(new Error('實物條碼格式無效，請掃描完整條碼'),{status:400});
 }
 validate(value.shippingSku);
 return value;
}
module.exports={safeSettings};
