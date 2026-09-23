'use strict';
const { createPrivateKey, createHash, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const jwt = require('jsonwebtoken');
const PATH = '/api/v1/integration/wms/events';
function senderConfig(env = process.env) {
    if (env.WMS_HANDOVER_ENABLED !== 'true') return null;
    try {
        const url = new URL(env.WMS_HANDOVER_ERP_URL);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== PATH) throw Error();
        const key = createPrivateKey(env.WMS_HANDOVER_PRIVATE_KEY || readFileSync(env.WMS_HANDOVER_PRIVATE_KEY_FILE, 'utf8'));
        if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength < 2048 || !env.WMS_HANDOVER_JWT_ISSUER || !env.WMS_HANDOVER_JWT_AUDIENCE) throw Error();
        return { url: url.href, key, issuer: env.WMS_HANDOVER_JWT_ISSUER, audience: env.WMS_HANDOVER_JWT_AUDIENCE };
    } catch { throw Error('WMS_HANDOVER_CONFIG_INVALID'); }
}
async function deliverOne(pool, config, fetcher = fetch) {
    if (!config) return { status: 'disabled' };
    const lease = randomUUID();
    const row = (await pool.query(`WITH due AS (
        SELECT event_id FROM corely_handover_outbox WHERE
          (status IN ('pending','retry') AND next_attempt_at<=NOW()) OR (status='sending' AND locked_until<=NOW())
        ORDER BY next_attempt_at,event_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE corely_handover_outbox o SET status='sending',attempts=attempts+1,lease_token=$1,locked_until=NOW()+INTERVAL '60 seconds'
      FROM due WHERE o.event_id=due.event_id RETURNING o.*`, [lease])).rows[0];
    if (!row) return { status: 'idle' };
    let status = 'retry', code = 'ERP_TEMPORARILY_UNAVAILABLE', ack = null;
    try {
        const event = JSON.parse(row.body_text);
        if (event.eventId !== row.event_id || createHash('sha256').update(row.body_text).digest('hex') !== row.body_hash) {
            status = 'rejected'; code = 'OUTBOX_BODY_MISMATCH';
        } else {
            const token = jwt.sign({ scope: 'wms.shipment.handover', entityId: event.entityId, method: 'POST', path: PATH, bodyHash: row.body_hash }, config.key, { algorithm: 'RS256', issuer: config.issuer, audience: config.audience, expiresIn: 45, jwtid: randomUUID() });
            const response = await fetcher(config.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: row.body_text });
            if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) { status = 'rejected'; code = 'ERP_REJECTED_' + response.status; }
            else if (response.ok) {
                const raw = await response.text();
                if (raw.length > 8192) throw Error('ACK_TOO_LARGE');
                const value = JSON.parse(raw);
                if (value.accepted === true && value.eventId === row.event_id && typeof value.inboxId === 'string' && value.inboxId.length > 0 && value.inboxId.length <= 128 && typeof value.duplicate === 'boolean') {
                    status = 'acknowledged'; code = null;
                    ack = { accepted: true, eventId: value.eventId, inboxId: value.inboxId, duplicate: value.duplicate };
                } else code = 'ERP_ACK_INVALID';
            }
        }
    } catch { /* A timeout or lost response is retried with the exact persisted event. */ }
    const delay = Math.min(3600, 5 * (2 ** Math.min(row.attempts, 9)));
    await pool.query(`UPDATE corely_handover_outbox SET status=$3,last_error=$4,acknowledgement=$5,
        acknowledged_at=CASE WHEN $3='acknowledged' THEN NOW() ELSE NULL END,
        locked_until=NULL,lease_token=NULL,next_attempt_at=NOW()+($6::integer*INTERVAL '1 second')
        WHERE event_id=$1 AND lease_token=$2`, [row.event_id, lease, status, code, ack ? JSON.stringify(ack) : null, delay]);
    return { eventId: row.event_id, status };
}
function startHandoverWorker(pool, { env = process.env, fetcher = fetch, log = () => {} } = {}) {
    const config = senderConfig(env); let timer, stopped = false, running;
    if (!config) return { stop: async () => {} };
    const tick = async () => {
        try {
            for (let n = 0; !stopped && n < 20; n++) {
                const r = await deliverOne(pool, config, fetcher);
                if (r.status === 'idle') break;
            }
        } catch { log('Corely 交運回傳暫時失敗，待重試'); }
        finally { if (!stopped) { timer = setTimeout(() => { running = tick(); }, 15000); timer.unref(); } }
    };
    running = tick();
    return { stop: async () => { stopped = true; clearTimeout(timer); await running; } };
}
module.exports = { senderConfig, deliverOne, startHandoverWorker, PATH };
