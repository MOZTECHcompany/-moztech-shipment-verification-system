// Query strings may contain customer names, employee names or scanned serials.
// Keep operational HTTP timing/status without recording their search contents.
function accessLogFormat(tokens, req, res) {
    const url = String(req.originalUrl || req.url || '/');
    const path = url.split('?')[0];
    const loggedUrl = /^\/api\/operation-logs(?:\/stats)?\/?$/i.test(path) ? path : url;
    return `${tokens.method(req, res)} ${loggedUrl} ${tokens.status(req, res)} ${tokens['response-time'](req, res)} ms - ${tokens.res(req, res, 'content-length') || '-'}`;
}

module.exports = { accessLogFormat };
