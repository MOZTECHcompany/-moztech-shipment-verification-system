const readPaths = [
  [/^\/api\/operation-logs(?:\/stats)?$/, 'wms_logs:read'],
  [/^\/api\/(?:analytics|reports\/export)$/, 'wms_overview:read'],
  [/^\/api\/scan-errors$/, 'wms_scan_errors:read'],
  [/^\/api\/admin\/defects\/stats$/, 'wms_defects:read'],
  [/^\/api\/admin\/exceptions$/, 'wms_exceptions:read'],
  [/^\/api\/orders\/\d+\/exceptions\/\d+\/(?:attachments(?:\/\d+\/download)?|history)$/, 'wms_exceptions:read'],
  [/^\/api\/(?:tasks(?:\/(?:completed|pins|summary))?|users\/basic|team\/(?:channels|posts(?:\/\d+(?:\/attachments(?:\/\d+\/download)?)?)?))$/, 'wms_tasks:read'],
];
function allowsPortalRead(req) {
  if (!req.user?.erpSubject || req.user.role !== 'viewer' || req.method !== 'GET') return false;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return readPaths.some(([pattern, permission]) => pattern.test(path) && req.user.permissions?.includes(permission));
}
function portalScope(req, res, next) {
  if (req.user?.role !== 'viewer' || allowsPortalRead(req) || (req.method === 'POST' && req.originalUrl === '/api/auth/erp/logout')) return next();
  return res.status(403).json({message:'沒有此儲運操作權限'});
}
module.exports = { allowsPortalRead, portalScope };
