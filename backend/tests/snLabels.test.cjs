const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const xlsx = require('xlsx');
const { createCartonFixture } = require('./cartonFixture.cjs');

async function exercise(t, postgres) {
    const f = await createCartonFixture({ postgres });
    const server = await new Promise(done => { const s=f.app.listen(0,'127.0.0.1',() => done(s)); });
    t.after(async () => { await new Promise(done => server.close(done)); await f.close(); });
    f.attachLegacyRoutes();
    const call = (method,path,body,actor=1) => {
        const req = request(server)[method](path).set('x-fixture-user',String(actor));
        return body === undefined ? req : req.send(body);
    };
    function ok(resp,status=200) { assert.equal(resp.status,status,JSON.stringify(resp.body)); return resp.body; }
    const api='/api/sn-labels', policies=['SN','NO-SN'];
    for (const policy of policies) {
        const hasSN=policy==='SN', sku='QA-'+policy, code=hasSN?'0471000000001':'ITM-QA-NO-SN';
        const product=ok(await call('post',api+'/products',{sku,name:sku,barcode:code,modelNumber:sku}));
        const form={sku,name:sku,productName:sku,productId:product.id,barcode:code,model:sku,
            style:'',color:'',styleCode:'',colorCode:'W',modelCode:hasSN?'A08':'NSI',quantity:20,capacity:10,
            orderDate:'2026-11-18',manufactureDate:'2026-11-18',
            label:{width:28,height:7.5,target:'box',showQr:true,textX:8,textY:0.7,fontSize:1.45,qrX:0.25,qrY:0.25,qrSize:6}};
        const draft=randomUUID();
        assert.equal((await call('put',api+'/drafts/'+draft,{data:form,revision:0},2)).status,403);
        ok(await call('put',api+'/drafts/'+draft,{data:form,revision:0}));
        const preview=ok(await call('post',api+'/preview',{data:form}));
        assert.equal(preview.rows.length,2);
        const activate=async(key,token)=>ok(await call('post',api+'/drafts/'+key+'/activate',{revision:1,previewToken:token}));
        const {batchId}=await activate(draft,preview.token);
        assert.equal((await activate(draft,preview.token)).replayed,true);
        const path=api+'/batches/'+batchId;
        const detail=ok(await call('get',path));
        assert.equal(detail.receivingStatus,'not-received');assert.equal(detail.boxes[0].serials.length,hasSN?10:0);
        assert.match(detail.boxes[0].id,/^CTN-TRY-/);if(hasSN) assert.match(detail.boxes[0].serials[0],/^TRY-/);
        const binary = (res,cb) => {const a=[];res.on('data',v=>a.push(v));res.on('end',()=>cb(null,Buffer.concat(a)));};
        const pdf=await call('post',path+'/export',{kind:hasSN?'cartons':'cartons-no-sn',reason:'initial',from:1,to:2}).buffer(true).parse(binary);
        assert.equal(pdf.status,200,JSON.stringify(pdf.body));assert.equal(pdf.body.subarray(0,4).toString(),'%PDF');
        const output=await call('post',path+'/export',{kind:'warehouse-cartons',reason:'initial',from:1,to:2}).buffer(true).parse(binary);
        assert.equal(output.status,200);const book=xlsx.read(output.body,{type:'buffer'});
        const { parseCartonExcel }=await import('../../frontend/src/utils/cartonExcel.js');
        const manifest=parseCartonExcel(book,xlsx);
        assert.equal(manifest.cartons[0].lines[0][hasSN?'ean':'internalScanCode'],code);
        const imported=ok(await call('post','/api/cartons/import',{...manifest,expectedActorId:1}));
        const cartons=imported.items.map(i=>({cartonId:i.cartonId,expectedContentRevision:i.carton.contentRevision}));
        ok(await call('post','/api/cartons/seal-batch',{cartons,expectedActorId:1}));
        assert.equal(ok(await call('get',path)).receivingStatus,'not-received');
        const ret={batchRevision:detail.batchRevision,reason:'測試修改箱規'};
        assert.equal((await call('post',path+'/reversion',{...ret,reason:' '})).status,400);
        if(hasSN) {
            const result=ok(await call('post',path+'/reversion',ret));
            assert.equal(result.replacementDraftIds.length,1);
            assert.deepEqual(ok(await call('post',path+'/reversion',ret)).replacementDraftIds,result.replacementDraftIds);
            assert.equal(ok(await call('get',path)).status,'retired');
            ok(await call('put',api+'/drafts/'+result.replacementDraftIds[0],{data:{...form,quantity:6},revision:1}));
            assert.equal((await call('post',path+'/mark-received',{batchRevision:detail.batchRevision})).status,409);
            const order=await f.seedOrder({itemCode:sku,quantity:10,barcode:code,actualSN:detail.boxes[0].serials,serialMode:'exact'});
            const input={scanValue:cartons[0].cartonId,type:'pick',expectedActorId:2};
            const endpoint='/api/orders/'+order.order.id;
            const plan=await call('post',endpoint+'/carton-preview',input,2);
            if(plan.status===200) {
                const scan=await call('post',endpoint+'/carton-scan',{...input,commandId:randomUUID(),expectedState:plan.body.expectedState,expectedCartonRevision:plan.body.expectedCartonRevision},2);
                assert.ok(scan.status>=400);
            } else assert.equal(plan.status,409);
            assert.equal(ok(await call('get','/api/cartons/'+cartons[0].cartonId)).lines[0].remainingQuantity,10);
        } else {
            ok(await call('post',path+'/mark-received',{batchRevision:detail.batchRevision}));
            ok(await call('post',path+'/mark-received',{batchRevision:detail.batchRevision}));
            assert.equal(ok(await call('get',path)).receivingStatus,'received');
            assert.equal((await call('post',path+'/reversion',ret)).status,409);
            const events=ok(await call('get',path)).events.filter(e=>e.action==='INBOUND_STATUS_RECORDED'&&e.data.status==='received');
            assert.equal(events.length,1);
        }
    }
}
test('WMS trial label workflow uses real PDFs and an importable SN or non-SN workbook',t=>exercise(t,false));
test('WMS trial label workflow on loopback PostgreSQL', {skip:process.env.WMS_CARTON_PG!=='1'},t=>exercise(t,true));
