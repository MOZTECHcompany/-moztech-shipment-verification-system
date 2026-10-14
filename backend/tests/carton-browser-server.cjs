// Explicit local DEV fixture. Every record is synthetic; the database is disposable.
const { createCartonFixture } = require('./cartonFixture.cjs');
const bcrypt = require('bcryptjs');

(async () => {
    if (process.env.WMS_CARTON_LOCAL_DEV !== '1') throw new Error('Set WMS_CARTON_LOCAL_DEV=1 for synthetic loopback DEV');
    const fixture = await createCartonFixture({ postgres: true });
    const local = require('./local-pg-config.cjs')();
    const database = (await fixture.db.query('SELECT current_database() AS name')).rows[0].name;
    const password = 'carton-dev-fixture-only';
    await fixture.db.query('UPDATE users SET password=$1', [await bcrypt.hash(password, 4)]);
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: '', PGHOST: local.host, PGPORT: String(local.port),
        PGUSER: 'wms_replay', PGPASSWORD: 'wms_replay_local_only', PGDATABASE: database,
        JWT_SECRET: 'local-carton-fixture-not-a-production-secret', DB_POOL_MAX: '4', DB_SSL_MODE: 'disable',
        STORAGE_BACKEND: 'local', CORS_ORIGINS: `http://127.0.0.1:${process.env.WMS_CARTON_WEB_PORT || 55771}`,
        WMS_ECPAY_ACCOUNTS_JSON: '[]', WMS_ECPAY_CALLBACKS_ENABLED: 'false' });
    const cases = [
        { cartonId: 'CTN-261012-M1-001', itemCode: 'SN-ITEM', barcode: '4710000000010', quantity: 10,
            actualSN: Array.from({ length: 10 }, (_,i)=>`SNDEMO${String(i+1).padStart(6,'0')}`), voucherNumber: 'DEV-SN-10' },
        { cartonId: 'CTN-261012-M1-002', itemCode: 'LOCAL-ITEM', barcode: 'ITM-LOCAL-ITEM', quantity: 10,
            actualSN: [], voucherNumber: 'DEV-NOSN-10', internalScanCode: 'ITM-LOCAL-ITEM' },
        { cartonId: 'CTN-261012-M1-003', itemCode: 'VENDOR-ITEM', barcode: '4710000000012', quantity: 2,
            actualSN: ['W'.repeat(100), 'Vendor-A02'], voucherNumber: 'DEV-VENDOR-SN-2' },
        { cartonId: 'CTN-261012-SPLIT-001', itemCode: 'SPLIT-ITEM', barcode: '4710000000013', quantity: 10,
            actualSN: [], voucherNumber: 'DEV-SPLIT-6', orderQuantity: 6 }
    ];
    const seeded = [];
    for (const c of cases) {
        const order = await fixture.seedOrder({ quantity: c.orderQuantity || c.quantity, itemCode: c.itemCode,
            barcode: c.barcode, actualSN: [], voucherNumber: c.voucherNumber });
        await fixture.service.create({ cartonId: c.cartonId, sourceSystem: 'synthetic-dev', seal: true,
            lines: [{ itemCode: c.itemCode, productName: 'DEV 測試商品', ean: c.internalScanCode ? null : c.barcode,
                internalScanCode: c.internalScanCode || null, quantity: c.quantity, actualSN: c.actualSN }] }, { id: 1 });
        seeded.push({ orderId: order.order.id, cartonId: c.cartonId, voucher: c.voucherNumber });
    }
    const { app, server, io } = require('../src/app');
    app.locals.cartonFixture = true;
    const apiPort = Number(process.env.WMS_CARTON_API_PORT || 55452);
    if (!Number.isSafeInteger(apiPort) || apiPort < 55000 || apiPort > 55999) throw Error('Dedicated local API port required');
    await new Promise(resolve => server.listen(apiPort, '127.0.0.1', resolve));
    process.stdout.write(JSON.stringify({ status: 'local-dev-ready', api: `http://127.0.0.1:${apiPort}`, cases: seeded })+'\n');
    let stopped = false;
    const stop = async () => {
        if (stopped) return; stopped = true;
        await new Promise(resolve => io.close(resolve));
        await require('../src/config/database').closePool();
        await fixture.close(); process.exit(0);
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
})().catch(error => { console.error(error.message); process.exitCode=1; });
