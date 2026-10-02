const {stateToken,readLines}=require('../services/scanSnapshot');
const {applyOrderChangeProposal}=require('../services/orderChangeService');

const order={id:1,status:'picking',voucher_number:'SIGNED-1',document_type:'shipment'};
const item={id:1,order_id:1,product_code:'MODEL',product_name:'商品',barcode:'CODE',quantity:2,picked_quantity:1,packed_quantity:0,quantity_sign:1};

test('scan state protects the ERP document direction as well as positive work quantities',()=>{
    const initial=stateToken(order,[item],[]);
    expect(stateToken({...order,document_type:'reversal'},[item],[])).not.toBe(initial);
    expect(stateToken(order,[{...item,quantity_sign:-1}],[])).not.toBe(initial);
    expect(stateToken(order,[{...item,signed_quantity:2}],[])).toBe(initial);
    const legacyOrder={...order};delete legacyOrder.document_type;
    const legacyItem={...item};delete legacyItem.quantity_sign;
    expect(stateToken(legacyOrder,[legacyItem],[])).toBe(initial);
});

test('warehouse snapshots preserve signed ERP quantity while exposing an absolute scan target',async()=>{
    const db={query:jest.fn().mockResolvedValueOnce({rows:[{...item,quantity_sign:-1}, {...item,id:2,quantity:3}]})
        .mockResolvedValueOnce({rows:[{id:1,order_item_id:1,status:'pending'}]})};
    const snapshot=await readLines(db,1);
    expect(snapshot.items.map(row=>[row.quantity,row.signed_quantity])).toEqual([[2,-2],[3,3]]);
    expect(snapshot.instances).toEqual([{id:1,order_item_id:1,status:'pending'}]);
});

test.each(['reversal','adjustment'])('ordinary quantity edits cannot convert a %s document to outbound quantities',async document_type=>{
    const client={query:jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{...order,document_type}]})};
    const proposal={note:'Fixture quantity edit',items:[{barcode:'CODE',productName:'商品',quantityChange:1,noSn:true}]};
    await expect(applyOrderChangeProposal({client,orderId:1,proposal,actorUserId:2})).rejects.toMatchObject({status:409,message:expect.stringContaining('ERP 修正')});
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
});
