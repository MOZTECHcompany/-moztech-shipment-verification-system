const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

function unavailable() { return Object.assign(new Error('暫時無法確認營運系統權限，請回工作台重試'), { status: 503 }); }
function invalid() { return Object.assign(new Error('作業身分已失效，請回營運系統工作台重新選擇'), { status: 401 }); }
function config() {
    const api = process.env.ERP_PORTAL_API_URL;
    const origin = process.env.ERP_PORTAL_ORIGIN;
    if (process.env.ERP_PORTAL_SSO_ENABLED !== 'true' || !api || !origin || (process.env.ERP_PORTAL_SHARED_SECRET || '').length < 32 || !process.env.ERP_PORTAL_ENTITY_ID) throw unavailable();
    const u = new URL(api); const web = new URL(origin);
    if (u.protocol !== 'https:' || web.protocol !== 'https:' || web.origin !== origin || u.username || u.password || u.search || u.hash) throw unavailable();
    return { api: api.replace(/\/$/, ''), origin };
}
async function callErp(action, body) {
    const { api } = config();
    let response;
    try {
        response = await fetch(`${api}/wms/portal/${action}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
            headers: { 'Content-Type': 'application/json', 'x-wms-service-key': process.env.ERP_PORTAL_SHARED_SECRET }, body: JSON.stringify(body),
        });
    } catch { throw unavailable(); }
    if (!response.ok) throw [400,401,403].includes(response.status) ? invalid() : unavailable();
    return response.json();
}
function validateIdentity(identity) {
    if (!identity || typeof identity.userId !== 'string' || !identity.userId || identity.entityId !== process.env.ERP_PORTAL_ENTITY_ID || !['picker','packer','dispatcher','admin','viewer'].includes(identity.role) || new Date(identity.expiresAt).getTime() <= Date.now() || !Number.isFinite(new Date(identity.expiresAt).getTime())) throw invalid();
    if (identity.role === 'admin' && !identity.permissions?.includes('wms_admin')) throw invalid();
    if (identity.role === 'viewer' && (!Array.isArray(identity.permissions) || !identity.permissions.includes('wms_tasks:read'))) throw invalid();
    if (identity.destination && !new Set(['/tasks','/tasks?group=pick','/tasks?group=pack','/tasks?view=completed','/admin','/admin/marketplace-converter','/warehouse-intakes','/admin/analytics','/admin/operation-logs','/admin/exceptions','/admin/scan-errors','/admin/defects','/settings/logistics','/team','/admin/users','/settings']).has(identity.destination)) throw invalid();
    return identity;
}
function signSession(user, session, expiresAt) {
    const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
    return jwt.sign({ id: user.id, erpSession: session, erpSubject: user.erpSubject, exp }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}
async function exchange(pool, ticket, nonce) {
    if (![ticket,nonce].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) throw invalid();
    const identity = validateIdentity(await callErp('consume', { ticket, nonce }));
    if (typeof identity.session !== 'string' || !/^[a-f0-9]{64}$/.test(identity.session)) throw invalid();
    const client = await pool.connect(); let user;
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['erp-staff:'+identity.userId]);
        const mapping = (await client.query('SELECT * FROM erp_staff_identities WHERE erp_user_id=$1', [identity.userId])).rows[0];
        if (mapping && mapping.entity_id !== identity.entityId) throw invalid();
        if (mapping) {
            user = (await client.query('UPDATE users SET name=$1, role=$2 WHERE id=$3 RETURNING id,username,name,role', [identity.name, identity.role, mapping.wms_user_id])).rows[0];
        } else {
            // Non-password account with an immutable ERP identity; never bind by display name.
            user = (await client.query('INSERT INTO users(username,password,name,role) VALUES($1,$2,$3,$4) RETURNING id,username,name,role', ['erp:'+identity.userId, '!erp-'+crypto.randomBytes(32).toString('hex'), identity.name, identity.role])).rows[0];
            await client.query('INSERT INTO erp_staff_identities(erp_user_id,entity_id,wms_user_id) VALUES($1,$2,$3)', [identity.userId,identity.entityId,user.id]);
        }
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if (!user) throw invalid();
    user = { ...user, erpSubject: identity.userId, erpOrigin: config().origin, personalPaths: identity.personalPaths || [], permissions: identity.permissions || [], entityId:identity.entityId };
    return { user, destination:identity.destination || (identity.role === 'dispatcher' ? '/admin' : '/tasks'), accessToken: signSession(user, identity.session, identity.expiresAt) };
}
async function resolveUser(pool, claims) {
    if (typeof claims.erpSession !== 'string' || !/^[a-f0-9]{64}$/.test(claims.erpSession)) throw invalid();
    const identity = validateIdentity(await callErp('inspect', { session: claims.erpSession }));
    if (identity.userId !== claims.erpSubject) throw invalid();
    const row = (await pool.query('SELECT u.id,u.username,u.name,u.role FROM erp_staff_identities e JOIN users u ON u.id=e.wms_user_id WHERE e.erp_user_id=$1 AND e.entity_id=$2 AND u.id=$3', [identity.userId,identity.entityId,claims.id])).rows[0];
    if (!row || row.role !== identity.role) throw invalid();
    return { ...row, erpSubject: identity.userId, erpOrigin: config().origin, personalPaths: identity.personalPaths || [], permissions: identity.permissions || [], entityId:identity.entityId };
}
function authenticateService(value) {
    config();
    const provided=Buffer.from(typeof value==='string'?value:'');const expected=Buffer.from(process.env.ERP_PORTAL_SHARED_SECRET);
    if(provided.length!==expected.length || !crypto.timingSafeEqual(provided,expected)) throw invalid();
}
async function isManaged(pool,id) {
    if(process.env.ERP_PORTAL_SSO_ENABLED!=='true') return false;
    return (await pool.query('SELECT 1 FROM erp_staff_identities WHERE wms_user_id=$1',[id])).rows.length>0;
}
async function staff(pool) {
    return {items:(await pool.query("SELECT u.id,u.username,u.name,u.role,e.erp_user_id FROM users u LEFT JOIN erp_staff_identities e ON e.wms_user_id=u.id WHERE u.role IN ('picker','packer','dispatcher') ORDER BY u.name,u.id")).rows};
}
async function bind(pool,body) {
    if(typeof body.userId!=='string' || !body.userId || !Number.isSafeInteger(body.wmsUserId) || body.wmsUserId<1 || body.entityId!==process.env.ERP_PORTAL_ENTITY_ID) throw invalid();
    const client=await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['erp-staff:'+body.userId]);
        const user=(await client.query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE',[body.wmsUserId])).rows[0];
        if(!user || !['picker','packer','dispatcher'].includes(user.role)) throw Object.assign(new Error('只能連結既有揀貨、裝箱或出貨人員帳號'),{status:400});
        const linked=(await client.query('SELECT * FROM erp_staff_identities WHERE erp_user_id=$1 OR wms_user_id=$2',[body.userId,body.wmsUserId])).rows;
        if(linked.some(row=>row.erp_user_id!==body.userId || row.wms_user_id!==body.wmsUserId || row.entity_id!==body.entityId)) throw Object.assign(new Error('帳號已有連結，請先核對既有任務，不能直接覆寫'),{status:409});
        await client.query('INSERT INTO erp_staff_identities(erp_user_id,entity_id,wms_user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[body.userId,body.entityId,body.wmsUserId]);
        await client.query('COMMIT');return {ok:true};
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
module.exports = { config, callErp, exchange, resolveUser, signSession, validateIdentity, authenticateService, isManaged, staff, bind };
