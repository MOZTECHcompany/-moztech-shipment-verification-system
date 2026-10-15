const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createCartonFixture } = require('./cartonFixture.cjs');

async function createEcountReferenceFixture({ postgres = true } = {}) {
    const f = await createCartonFixture({ postgres });
    f.attachLegacyRoutes();
    let attached = false;
    const api = (actor, method, path, body) => {
        const call = request(f.app)[method.toLowerCase()](path);
        if (actor) call.set('x-fixture-user', String(actor));
        return body === undefined ? call : call.send({ ...body, expectedActorId: body.expectedActorId ?? actor });
    };
    const ok = (res, status = 200) => {
        assert.equal(res.status, status, JSON.stringify(res.body));
        return res.body;
    };
    const attachReferences = () => {
        if (!attached) {
            const { createEcountReferenceRouter } = require('../src/routes/ecountReferenceRoutes');
            f.app.use('/api/orders', createEcountReferenceRouter({ pool: f.pool }));
            f.app.use((error, req, res, next) => res.status(error.status ?? 500).json({ code: error.code, message: error.message }));
            attached = true;
        }
    };
    const businessSnapshot = async () => {
        const result = {};
        for (const table of ['users', 'orders', 'order_items', 'order_item_instances', 'wms_cartons', 'wms_carton_lines',
            'wms_carton_serials', 'wms_carton_allocations', 'wms_carton_history', 'wms_box_specs',
            'wms_box_spec_history', 'wms_box_spec_batch_commands', 'task_assignments']) {
            result[table] = (await f.db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(row => row.row);
        }
        return result;
    };
    const claim = (order, stage, actor = 2) => api(actor, 'post', `/api/orders/${order}/claim`, { stage }).then(ok);
    const carton = (id, quantity, { itemCode = 'SKU-25', barcode = '4710000000025', actualSN = [] } = {}) => api(1, 'post', '/api/cartons', {
        cartonId: id, seal: true, lines: [{ itemCode, productName: 'Synthetic verification goods', ean: barcode, quantity, actualSN }]
    }).then(res => ok(res, 201));
    const scan = async (order, cartonId, stage, options = {}, actor = 2) => {
        const current = (await f.db.query('SELECT status FROM orders WHERE id=$1', [order])).rows[0];
        if (stage === 'pack' && current.status === 'picked') await claim(order, stage, actor);
        const input = { scanValue: `CARTON:${cartonId}`, type: stage, serialPolicy: 'from-carton', ...options };
        const preview = ok(await api(actor, 'post', `/api/orders/${order}/carton-preview`, input));
        return ok(await api(actor, 'post', `/api/orders/${order}/carton-scan`, {
            ...input, commandId: randomUUID(), expectedState: preview.expectedState,
            expectedCartonRevision: preview.expectedCartonRevision
        }));
    };
    const release = async (order, allocation, actor = 1) => {
        const state = ok(await api(actor, 'get', `/api/orders/${order}/work-snapshot`));
        const box = ok(await api(actor, 'get', '/api/cartons/' + allocation.cartonId));
        return ok(await api(actor, 'post', `/api/cartons/allocations/${allocation.allocationId}/release`, {
            commandId: randomUUID(), expectedState: state.stateToken, expectedCartonRevision: box.stateRevision,
            reason: 'Synthetic selection corrected before packing'
        }));
    };
    const seed = async (quantity, extra = {}) => f.seedOrder({ quantity, itemCode: 'SKU-25', barcode: '4710000000025', packerId: null, ...extra });
    async function complete25WithReleased() {
        const boxes = [];
        for (let n = 1; n <= 3; n++) boxes.push(await carton('N' + n, 10));
        const first = await seed(5, { voucherNumber: 'REFERENCE-N1-FIRST5' });
        await scan(first.order.id, 'N1', 'pick', { mode: 'split', selections: [{ lineId: boxes[0].lines[0].lineId, quantity: 5 }] });
        await scan(first.order.id, 'N1', 'pack');
        const target = await seed(25, { voucherNumber: 'REFERENCE-N1-N3-25' });
        await carton('N-RELEASED', 5);
        const wrong = await scan(target.order.id, 'N-RELEASED', 'pick');
        await release(target.order.id, wrong.allocation);
        for (const id of ['N1', 'N2', 'N3']) await scan(target.order.id, id, 'pick');
        for (const id of ['N1', 'N2', 'N3']) await scan(target.order.id, id, 'pack');
        assert.equal((await f.db.query('SELECT status FROM orders WHERE id=$1', [target.order.id])).rows[0].status, 'completed');
        return { ...target, first, boxes };
    }
    let sequence = 0;
    async function completeOrdinary(quantity = 1) {
        const box = await carton('REF-ORDINARY-' + ++sequence, quantity);
        const target = await seed(quantity);
        await scan(target.order.id, box.cartonId, 'pick');
        await scan(target.order.id, box.cartonId, 'pack');
        return { ...target, box };
    }
    async function completeMixed() {
        const sns=['000Case/01','000case+02'],looseSN='000Loose/01';
        const box=await carton('REFERENCE-UI-EXACT-SNS',2,{itemCode:'SN-EXACT',barcode:'4710000000091',actualSN:sns});
        const target=await seed(2,{itemCode:'SN-EXACT',barcode:'4710000000091',actualSN:sns,serialMode:'exact'});
        await f.db.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,'LOOSE-UNITS','LOOSE-QTY-CODE','Synthetic loose units',3)",[target.order.id]);
        const serialItem=(await f.db.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity,serial_identity_mode) VALUES($1,'LOOSE-SERIAL','LOOSE-SN-CODE','Synthetic loose serial',1,'exact') RETURNING id",[target.order.id])).rows[0].id;
        await f.db.query('INSERT INTO order_item_instances(order_item_id,serial_number) VALUES($1,$2)',[serialItem,looseSN]);
        const unit=(stage,value)=>api(2,'post','/api/orders/update_item',{orderId:target.order.id,type:stage,scanValue:value,amount:1}).then(ok);
        await scan(target.order.id,box.cartonId,'pick');for(let n=0;n<3;n++)await unit('pick','LOOSE-QTY-CODE');await unit('pick',looseSN);
        await claim(target.order.id,'pack');await scan(target.order.id,box.cartonId,'pack');for(let n=0;n<3;n++)await unit('pack','LOOSE-QTY-CODE');await unit('pack',looseSN);
        return {...target,box,sns,looseSN};
    }
    return { ...f, api, ok, attachReferences, businessSnapshot, claim, carton, scan, release, seed,
        complete25WithReleased, completeOrdinary, completeMixed };
}
module.exports = { createEcountReferenceFixture };
