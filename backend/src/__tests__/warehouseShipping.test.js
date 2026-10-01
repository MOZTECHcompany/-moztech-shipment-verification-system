const {publicWarehouseData}=require('../routes/warehouseReleaseRoutes');

function fixture(){
 return {batch:{id:6,batch_number:'WMS-TEST',source_platform:'Shopify',snapshot:{handler:{userId:7,name:'承辦'},settings:{projectOwner:'專案',salesOwner:'業務',customerCode:'PRIVATE_CODE'},orders:[{sourcePlatform:'Shopify',sourceOrderNumber:'ORDER-1',financial:{totalMinor:12300},shipping:{recipient:' 收件人 ',phone:'0900000000',address:'測試\u0000地址',postalCode:'00100',method:'宅配',storeName:'',storeCode:'00012',trackingNumber:'00034',note:'請保留外盒',paymentCard:'PRIVATE_CARD'}},{sourcePlatform:'SHOPLINE',sourceOrderNumber:'ORDER-1',shipping:{recipient:'不同平台的收件人'}}]}},orders:[{id:1,source_platform:'Shopify',source_order_number:'ORDER-1',expected_items:[{productCode:'SKU',quantity:1}],financial:{totalMinor:12300},nonstock_items:[{productCode:'SHIP'}]},{id:2,source_platform:'Shopify',source_order_number:'LEGACY',expected_items:[]}],flow:{erp_receipt:{vouchers:['ERP-1'],financials:{grossMinor:12300}}},events:[{action:'confirm-sales',actor_name:'承辦',details:{grossMinor:12300}}]};
}

test('warehouse shipping matches the exact source order and excludes accounting data for staff',()=>{
 const data=fixture(),before=structuredClone(data),view=publicWarehouseData(data,{id:8,role:'picker'});
 expect(view.orders[0].shipping).toEqual({recipient:'收件人',phone:'0900000000',address:'測試地址',postalCode:'00100',method:'宅配',storeCode:'00012',trackingNumber:'00034',note:'請保留外盒'});
 expect(view.orders[1].shipping).toEqual({});
 expect(view.batch.snapshot).toBeUndefined();
 expect(view.orders[0].financial).toBeUndefined();
 expect(view.orders[0].nonstock_items).toBeUndefined();
 expect(view.flow.erp_receipt).toEqual({vouchers:['ERP-1']});
 expect(view.events[0].details).toBeUndefined();
 expect(view.batch.handler.name).toBe('承辦');
 expect(JSON.stringify(view)).not.toMatch(/PRIVATE_CARD|PRIVATE_CODE|不同平台/);
 expect(data).toEqual(before);
});

test('warehouse delivery accepts bounded strings only and remains compatible with old snapshots',()=>{
 const data=fixture();
 data.batch.snapshot.orders[0].shipping={recipient:{name:'malformed'},phone:900000000,address:'甲'.repeat(1200),note:['private']};
 const view=publicWarehouseData(data,{id:7,role:'admin'});
 expect(view.orders[0].shipping).toEqual({address:'甲'.repeat(1000)});
 expect(view.flow.erp_receipt.financials).toEqual({grossMinor:12300});
 expect(view.events[0].details).toEqual({grossMinor:12300});
 delete data.batch.snapshot;
 expect(publicWarehouseData(data,{id:8,role:'packer'}).orders.map(o=>o.shipping)).toEqual([{},{}]);
});
