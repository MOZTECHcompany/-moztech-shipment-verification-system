const { parseBatchPage,summarizeChildren,createImportBatchSnapshot } = require('../services/importBatchSnapshot');

test('batch pagination validates identifiers, bounded page size and batch-scoped cursors', () => {
    expect(parseBatchPage({batchId:'1'},{})).toEqual({batchId:1,limit:30,afterId:0});
    const cursor=Buffer.from(JSON.stringify({v:1,batchId:1,afterId:40})).toString('base64url');
    expect(parseBatchPage({batchId:'1'},{limit:'10',cursor})).toEqual({batchId:1,limit:10,afterId:40});
    expect(()=>parseBatchPage({batchId:'2'},{cursor})).toThrow(/分頁/);
});

test.each([
    ['0',{}],['-1',{}],['2147483648',{}],['abc',{}],['1',{limit:'101'}],['1',{limit:'0'}],
    ['1',{limit:['10']}],['1',{cursor:'bad'}],['1',{sourceOrderNumber:'ignored-filter'}]
])('invalid batch request %j / %j never becomes a database query', async (batchId,query) => {
    const pool={connect:jest.fn()},res={status:jest.fn().mockReturnThis(),json:jest.fn()};
    await createImportBatchSnapshot(pool)({params:{batchId},query},res,jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);expect(pool.connect).not.toHaveBeenCalled();
});

test('voided children remain traceable while active totals and status counts stay separate', () => {
    const children=[{status:'completed',item_count:2,total_quantity:5,picked_quantity:5,packed_quantity:5,serial_count:2},
        {status:'voided',item_count:1,total_quantity:3,picked_quantity:1,packed_quantity:0,serial_count:0}];
    expect(summarizeChildren(children)).toMatchObject({workOrderCount:2,activeWorkOrderCount:1,totalQuantity:5,pickedQuantity:5,packedQuantity:5,
        statusCounts:{completed:1,voided:1},voidedTotals:{workOrderCount:1,totalQuantity:3,pickedQuantity:1}});
});

function fakeDatabase({missing=false,fail=false}={}) {
    const children=[{id:10,status:'pending',total_quantity:2},{id:11,status:'voided',total_quantity:1}];
    const db={query:jest.fn(async sql=>{
        if(sql.includes('SELECT b.id,b.voucher_number'))return{rows:missing?[]:[{id:1,batch_number:'SYNTHETIC-BATCH'}]};
        if(sql.includes('order_stats AS')){if(fail)throw new Error('synthetic query failure');return{rows:children};}
        if(sql.includes('ARRAY_AGG'))return{rows:[{product_code:'SKU',barcode:'0001',total_quantity:2}]};
        return{rows:[]};
    }),release:jest.fn()};
    return{db,pool:{connect:jest.fn(async()=>db)}};
}

test('batch detail is a repeatable read-only snapshot, with all IDs and only printable active IDs', async () => {
    const {db,pool}=fakeDatabase(),next=jest.fn();
    const res={set:jest.fn().mockReturnThis(),json:jest.fn(),status:jest.fn().mockReturnThis()};
    await createImportBatchSnapshot(pool)({params:{batchId:'1'},query:{limit:'1'}},res,next);
    expect(next).not.toHaveBeenCalled();
    const response=res.json.mock.calls[0][0];
    expect(response.children.map(o=>o.id)).toEqual([10]);expect(response.workOrderIds).toEqual([10,11]);expect(response.printableWorkOrderIds).toEqual([10]);
    expect(response.pagination).toMatchObject({limit:1,totalWorkOrders:2,nextCursor:expect.any(String)});
    expect(db.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(db.query.mock.calls.some(([sql])=>/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|FOR UPDATE/i.test(sql))).toBe(false);
    expect(db.query.mock.calls.at(-1)[0]).toBe('COMMIT');expect(db.release).toHaveBeenCalledTimes(1);
});

test.each([{missing:true},{fail:true}])('missing or failed batch read rolls back without a mutation: %j', async options => {
    const {db,pool}=fakeDatabase(options),next=jest.fn();
    const res={set:jest.fn().mockReturnThis(),json:jest.fn(),status:jest.fn().mockReturnThis()};
    await createImportBatchSnapshot(pool)({params:{batchId:'1'},query:{}},res,next);
    expect(db.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');expect(db.release).toHaveBeenCalledTimes(1);
    if(options.missing){expect(res.status).toHaveBeenCalledWith(404);expect(next).not.toHaveBeenCalled();}
    else expect(next).toHaveBeenCalledWith(expect.any(Error));
});
