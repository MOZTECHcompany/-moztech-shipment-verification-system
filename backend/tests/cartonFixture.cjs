// Disposable in-memory PostgreSQL only. No connection env or production app.
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { randomBytes } = require('node:crypto');
const { runMigrations } = require('../src/maintenance/migrationRunner');
const { createCartonService } = require('../src/services/cartonService');
const { createCartonRouter, createOrderCartonRouter } = require('../src/routes/cartonRoutes');
const { staffUser } = require('../src/utils/warehouseWork');

async function createCartonFixture({ postgres = false } = {}) {
    let db, nativePool, control, database;
    if (postgres) {
        const { Pool, Client } = require('pg');
        const config = { host: '127.0.0.1', port: 55441, user: 'wms_replay', password: 'wms_replay_local_only', database: 'postgres' };
        control = new Client(config); await control.connect();
        database = `wms_carton_${randomBytes(8).toString('hex')}`;
        await control.query(`CREATE DATABASE "${database}"`);
        nativePool = new Pool({ ...config, database, max: 4 });
        db = { query: (...args) => nativePool.query(...args), exec: sql => nativePool.query(sql), close: async () => {
            await nativePool.end(); await control.query(`DROP DATABASE "${database}"`); await control.end();
        } };
    } else db = new PGlite({ extensions: { pg_trgm: require('@electric-sql/pglite/contrib/pg_trgm').pg_trgm } });
    // PGlite has one connection. Serialize whole transactions, not individual
    // SQL statements; Promise.all tests are contention/replay tests, not proof
    // of real multi-session PostgreSQL row/advisory locking.
    let tail = Promise.resolve(), failQuery, failAfterQuery;
    const pool = {
        query: (sql, values) => db.query(sql, values),
        async connect() {
            if (nativePool) {
                const client = await nativePool.connect();
                return { query: async (sql, values) => {
                    if (failQuery?.(sql)) { failQuery = undefined; throw new Error('Synthetic SQL transport failure'); }
                    const result = await client.query(sql, values);
                    if (failAfterQuery?.(sql)) { failAfterQuery = undefined; throw new Error('Synthetic response loss after SQL execution'); }
                    return result;
                }, release: error => client.release(error) };
            }
            const previous = tail;
            let done;
            tail = new Promise(resolve => { done = resolve; });
            await previous;
            return { query: async (sql, values) => {
                if (failQuery?.(sql)) { failQuery = undefined; throw new Error('Synthetic SQL transport failure'); }
                if (values === undefined && sql.includes(';')) {
                    const results = await db.exec(sql);
                    return results.at(-1) ?? { rows: [], rowCount: 0 };
                }
                const result = await db.query(sql, values);
                if (failAfterQuery?.(sql)) { failAfterQuery = undefined; throw new Error('Synthetic response loss after SQL execution'); }
                return result;
            }, release: () => done() };
        }
    };
    database ??= (await db.query('SELECT current_database() AS name')).rows[0].name;
    await runMigrations({ pool, targetDatabase: database });
    await db.exec(`INSERT INTO users(id,username,password,name,role,management_scope) VALUES
        (1,'fixture-admin','unused','Fixture Admin','admin','warehouse'),
        (2,'fixture-picker','unused','Fixture Picker','picker','all'),
        (3,'fixture-packer','unused','Fixture Packer','packer','all'),
        (4,'fixture-dispatcher','unused','Fixture Dispatcher','dispatcher','all'),
        (5,'fixture-order-manager','unused','Fixture Order Manager','admin','orders'),
        (6,'fixture-other-picker','unused','Fixture Other Picker','picker','all')`);
    const service = createCartonService({ pool });
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.post('/api/auth/login', async (req, res) => {
        if (req.body.password !== 'fixture-only') return res.status(401).json({ message: 'Fixture credentials only' });
        const user = (await db.query('SELECT id,username,name,role,management_scope,can_pick,can_pack FROM users WHERE username=$1', [req.body.username])).rows[0];
        if (!user) return res.status(401).json({ message: 'Fixture user not found' });
        res.json({ accessToken: `fixture-${user.id}`, refreshToken: `fixture-refresh-${user.id}`, user: staffUser(user) });
    });
    app.use(async (req, res, next) => {
        const id = Number(req.headers['x-fixture-user'] || /^Bearer fixture-(\d+)$/.exec(req.headers.authorization || '')?.[1]);
        if (id) {
            const user = (await db.query('SELECT id,username,name,role,management_scope,can_pick,can_pack FROM users WHERE id=$1', [id])).rows[0];
            if (user) req.user = staffUser(user);
        }
        next();
    });
    app.get('/api/auth/me', async (req, res) => {
        const user = (await db.query('SELECT id,username,name,role,management_scope,can_pick,can_pack FROM users WHERE id=$1', [req.user?.id ?? null])).rows[0];
        if (!user) return res.status(401).json({ message: 'Fixture login required' });
        res.json({ user: staffUser(user) });
    });
    app.use('/api/cartons', createCartonRouter({ pool }));
    app.use('/api/orders', createOrderCartonRouter({ pool }));
    async function seedOrder({ quantity = 10, itemCode = 'ITEM', barcode = '4710000000010', actualSN = [], sign = 1, serialMode = 'legacy',
        status = 'picking', pickerId = 2, packerId = 3, voucherNumber = `FIXTURE-${Math.random().toString(36).slice(2)}` } = {}) {
        const order = (await db.query(`INSERT INTO orders(voucher_number,customer_name,status,picker_id,packer_id,document_type)
            VALUES($1,'Synthetic customer',$2,$3,$4,$5) RETURNING *`, [voucherNumber, status, pickerId, packerId, sign === -1 ? 'reversal' : 'shipment'])).rows[0];
        const item = (await db.query(`INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity,quantity_sign,serial_identity_mode)
            VALUES($1,$2,'Synthetic item',$3,$4,$5,$6) RETURNING *`, [order.id, itemCode, barcode, quantity, sign, serialMode])).rows[0];
        if (actualSN.length) await db.query('INSERT INTO order_item_instances(order_item_id,serial_number) SELECT $1,unnest($2::text[])', [item.id, actualSN]);
        return { order, item };
    }
    let legacyAttached = false;
    function attachLegacyRoutes() {
        if (legacyAttached) return;
        // Only this synthetic process: inject the disposable pool before loading
        // the unchanged production router/auth/audit logic. Never read DB env.
        const databasePath = require.resolve('../src/config/database'), prior = require.cache[databasePath];
        require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { pool } };
        for (const path of ['../src/routes/orderRoutes','../src/routes/warehouseWorkRoutes','../src/services/operationLogService','../src/services/orderReviewService','../src/services/reconcilePicking']) delete require.cache[require.resolve(path)];
        try {
            app.use('/api', require('../src/routes/orderRoutes'));
            app.use('/api', require('../src/routes/warehouseWorkRoutes'));
            app.use((error, req, res, next) => res.status(error.status ?? 500).json({ code: error.code, message: error.message }));
            legacyAttached = true;
        } finally { if (prior) require.cache[databasePath] = prior; else delete require.cache[databasePath]; }
    }
    return { db, pool, app, service, seedOrder, attachLegacyRoutes, failNext: predicate => { failQuery = predicate; },
        failAfterNext: predicate => { failAfterQuery = predicate; }, close: () => db.close() };
}
module.exports = { createCartonFixture };
