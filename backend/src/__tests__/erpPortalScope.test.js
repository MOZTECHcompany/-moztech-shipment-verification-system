jest.mock('../config/database',()=>({pool:{query:jest.fn()}}));
const {allowsPortalRead,portalScope}=require('../middleware/erpPortalScope');
const {validateIdentity}=require('../services/erpSession');
const {deferredEvents}=require('../utils/transactionEvents');
const {logOperation}=require('../services/operationLogService');
const actor={role:'viewer',erpSubject:'staff',permissions:['wms_tasks:read','wms_logs:read']};
test('report scope permits only its exact GET paths, never mutations or adjacent admin APIs',()=>{
 for(const path of ['/api/operation-logs','/api/operation-logs/stats?startDate=2026-09-01']) expect(allowsPortalRead({user:actor,method:'GET',originalUrl:path})).toBe(true);
 for(const [method,path] of [['POST','/api/operation-logs'],['GET','/api/admin/users'],['GET','/api/analytics'],['GET','/api/operation-logs/../admin/users']]) expect(allowsPortalRead({user:actor,method,originalUrl:path})).toBe(false);
 const res={status:jest.fn().mockReturnThis(),json:jest.fn()},next=jest.fn();
 portalScope({user:actor,method:'PATCH',originalUrl:'/api/orders/1'},res,next);expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
});
test('a management identity needs the ERP admin capability and a fixed internal destination',()=>{
 process.env.ERP_PORTAL_ENTITY_ID='warehouse';
 const identity={userId:'staff',entityId:'warehouse',role:'admin',expiresAt:new Date(Date.now()+60000).toISOString(),permissions:['wms_admin'],destination:'/settings'};
 expect(validateIdentity(identity)).toBe(identity);
 for(const change of [{permissions:['wms_logs:read']},{destination:'https://evil.test'},{entityId:'other'}])expect(()=>validateIdentity({...identity,...change})).toThrow();
});
test('audit details never enter the broadcast even through a legacy transactional emitter',async()=>{
 const io={emit:jest.fn()},db={query:jest.fn().mockResolvedValue({rows:[{id:1,created_at:new Date()}]})};
 await logOperation({userId:1,orderId:2,operationType:'pick',details:{private:'sensitive'},db,io});
 expect(io.emit).toHaveBeenCalledWith('operation_logs_changed',{});
 const events=deferredEvents(io);events.emit('new_operation_log',{private:'sensitive'});events.publish();
 expect(JSON.stringify(io.emit.mock.calls)).not.toContain('sensitive');
});
test('ERP-only mode rejects old passwords, token refresh and socket sessions',async()=>{
 process.env.ERP_PORTAL_ONLY='true';
 try {
  const auth=require('../services/authService');
  await expect(auth.login('legacy','password')).rejects.toMatchObject({status:401});
  jest.spyOn(auth,'verifyToken').mockResolvedValue({id:1});
  await expect(auth.refreshToken('old')).rejects.toMatchObject({status:401});
  auth.verifyToken.mockRestore();
  const jwt=require('jsonwebtoken'),secret='isolated-test-key';
  const authenticate=require('../middleware/socketAuth').createSocketAuthenticator({pool:{query:jest.fn()},secret});
  const next=jest.fn();
  await authenticate({handshake:{auth:{token:jwt.sign({id:1},secret,{expiresIn:'1h'})}},data:{}},next);
  expect(next.mock.calls[0][0].data.code).toBe('SOCKET_AUTH_REQUIRED');
 } finally {delete process.env.ERP_PORTAL_ONLY;}
});
