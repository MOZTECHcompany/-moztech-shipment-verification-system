const {warehouseOrderProductDetails,marketplaceWorkItemName,products}=require('../services/warehouseRelease');

test('warehouse print data refreshes only exact saved source lines and preserves operational identifiers',async()=>{
 const orders=[{source_order_number:'ORDER-A',expected_items:[{sourceLineId:'LINE-1',sourceSku:'NEW0001',productCode:'ERP0001',productName:'ERP 簡稱',barcode:'0001',quantity:2,snCount:2},{sourceLineId:'LINE-2',sourceSku:'0002',productCode:'ERP0002',productName:'另一品項',barcode:'0002',quantity:1}]},{source_order_number:'ORDER-B',expected_items:[{sourceLineId:'LINE-1',sourceSku:'NEW0001',productCode:'ERP0001',productName:'ERP 簡稱',barcode:'0001',quantity:3}]}];
 const snapshot={items:[{sourceOrderNumber:'ORDER-A',sourceLineId:'LINE-1',sku:'NEW0001',productName:'有效商城品名 Pro（附配件）'},{sourceOrderNumber:'ORDER-A',sourceLineId:'LINE-2',sku:'DIFFERENT',productName:'不可套入的品名'},{sourceOrderNumber:'ORDER-B',sourceLineId:'LINE-1',sku:'NEW0001',productName:'有效商城品名 Pro'}],settings:{skuMappings:{NEW0001:{erpSku:'ERP0001',erpName:'ERP 簡稱',spec:'iPhone Pro'}}}};
 const before=structuredClone({orders,snapshot}),projected=await warehouseOrderProductDetails(orders,snapshot);
 expect(projected[0].expected_items[0]).toEqual({...orders[0].expected_items[0],productName:'有效商城品名 Pro（附配件）',erpName:'ERP 簡稱',spec:'iPhone Pro'});
 expect(projected[0].expected_items[1]).toEqual(orders[0].expected_items[1]);
 expect(projected[1].expected_items[0].productName).toBe('有效商城品名 Pro');
 const aggregated=products(projected).find(p=>p.productCode==='ERP0001');
 expect(aggregated).toEqual({key:JSON.stringify(['ERP0001','0001']),productCode:'ERP0001',barcode:'0001',quantity:5,productName:'有效商城品名 Pro（附配件）\n有效商城品名 Pro',spec:'iPhone Pro'});
 expect({orders,snapshot}).toEqual(before);
});

test('old warehouse records with absent or mismatched snapshot mappings retain their saved names',async()=>{
 const orders=[{source_order_number:'ORDER-A',expected_items:[{sourceLineId:'LINE-1',productCode:'ERP0001',productName:'原保存品名',barcode:'0001',quantity:1}]}];
 expect(await warehouseOrderProductDetails(orders)).toEqual(orders);
 const snapshot={items:[{sourceOrderNumber:'ORDER-A',sourceLineId:'LINE-1',sku:'0001',productName:'不符對照'}],settings:{skuMappings:{'0001':{erpSku:'ERP0002',erpName:'另一品項',spec:'另一規格'}}}};
 expect(await warehouseOrderProductDetails(orders,snapshot)).toEqual(orders);
});

test('marketplace work items keep exact source variants and specifications without affecting the return evidence',()=>{
 const item={sourceLineId:'LINE-1',productCode:'ERP0001',productName:'ERP 過短品名',quantity:3,barcode:'0001',serials:['SN1','SN2','SN3']};
 const expected=[{sourceLineId:'LINE-OTHER',productCode:'ERP0001',productName:'錯誤訂單版本'},{sourceLineId:'LINE-1',productCode:'ERP0002',productName:'錯誤產品版本'},{sourceLineId:'LINE-1',productCode:'ERP0001',productName:'商城保護貼（無貼膜神器）',spec:'iPhone Pro',erpName:'ERP 過短品名'}];
 const before=structuredClone({item,expected});
 expect(marketplaceWorkItemName(item,expected)).toBe('商城保護貼（無貼膜神器） · iPhone Pro');
 expect(marketplaceWorkItemName(item,expected.slice(0,2))).toBe('ERP 過短品名');
 expect(marketplaceWorkItemName(item,[{...expected[2],productName:'商城保護貼 iPhone Pro'}])).toBe('商城保護貼 iPhone Pro');
 expect({item,expected}).toEqual(before);
});
