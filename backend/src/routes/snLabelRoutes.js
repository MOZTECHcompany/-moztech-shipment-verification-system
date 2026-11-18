const express = require('express');
const { assertCartonManager } = require('../utils/cartonAccess');
const { SnLabelsService } = require('../sn-labels/sn-labels.service');
const { SnLabelBatchReviewService } = require('../sn-labels/sn-label-batch-review');
const { EXPORT_KINDS, SnLabelsExport } = require('../sn-labels/sn-labels.export');
const { labelDatabase, saveProduct, productFields, resolveProducts } = require('../sn-labels/database');
const { BadRequestException, NotFoundException } = require('../sn-labels/errors');

const entity = 'wms-trial';
function createSnLabelRouter({ pool }) {
    const router = express.Router(), db = labelDatabase(pool), reviews = new SnLabelBatchReviewService(db);
    const exporter = new SnLabelsExport(), labels = new SnLabelsService(db, exporter, reviews);
    const route = (write, action) => async (req, res, next) => {
        try {
            if (write) assertCartonManager(req.user);
            res.set('Cache-Control','private, no-store');
            const result = await action(req, res, String(req.user.id));
            if (!res.headersSent) res.json(result);
        } catch (error) { next(error); }
    };
    router.get('/products', route(false, async () => (await pool.query('SELECT ' + productFields + ' FROM wms_sn_products ORDER BY sku')).rows));
    router.post('/products', route(true, req => saveProduct(pool, null, req.body)));
    router.post('/products/resolve', route(true, req => resolveProducts(pool, req.body.skus)));
    router.get('/products/:id', route(false, async req => {
        const product = await db.productById(req.params.id);
        if (!product) throw new NotFoundException('找不到品項');
        return product;
    }));
    router.put('/products/:id', route(true, req => saveProduct(pool, req.params.id, req.body)));
    router.get('/', route(false, req => labels.list(entity, req.query)));
    router.put('/drafts/:id', route(true, (req, res, actor) => labels.save(entity, actor, req.params.id, req.body)));
    router.delete('/drafts/:id', route(true, (req, res, actor) => labels.remove(entity, actor, req.params.id, req.body.revision)));
    router.post('/preview', route(false, req => labels.preview(entity, req.body.data, Number(req.body.page) || 1)));
    router.post('/drafts/:id/activate', route(true, (req, res, actor) => labels.activate(entity, actor, req.params.id, req.body.revision, req.body.previewToken)));
    router.get('/batches/:id', route(false, req => labels.detail(entity, req.params.id, Number(req.query.page) || 1)));
    router.post('/batches/:id/mark-received', route(true, (req, res, actor) => reviews.markReceived(entity, actor, req.params.id, req.body)));
    router.post('/batches/:id/reversion', route(true, (req, res, actor) => reviews.returnToDraft(entity, actor, req.params.id, req.body)));
    router.post('/batches/:id/export', route(true, async (req, res, actor) => {
        const { kind, reason, from, to, columns } = req.body, id = req.params.id;
        if (!EXPORT_KINDS.includes(kind) || !['initial','missed','damaged','copy'].includes(reason)) throw new BadRequestException('請選擇輸出類型與列印原因');
        const { data, items, boxes } = await labels.exportData(entity,id,from,to,kind);
        const excel = ['warehouse-cartons','warehouse','warranty'].includes(kind);
        const buffer = kind === 'warehouse-cartons' ? exporter.warehouseCartons(data,boxes,id) :
            excel ? exporter.workbook(kind,data,items,columns) : await exporter.pdf(kind,data,items,boxes);
        await reviews.recordOutput(entity,actor,id,{ kind,reason,from,to,cartons:boxes.map(box=>box.id),serialCount:kind==='warehouse-cartons'?boxes.reduce((n,b)=>n+b.serials.length,0):items.length });
        res.type(excel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
        res.attachment('SN-' + kind + '-' + id + (excel ? '.xlsx' : '.pdf')).send(buffer);
    }));
    return router;
}
module.exports = { createSnLabelRouter };
