const { validateIdentity, resolveUser, exchange } = require('../services/erpSession');
describe('ERP work sessions', () => {
  const valid={userId:'staff',name:'Staff',entityId:'warehouse',role:'picker',expiresAt:new Date(Date.now()+600000).toISOString()};
  beforeEach(()=>{
    process.env.ERP_PORTAL_SSO_ENABLED='true';process.env.ERP_PORTAL_API_URL='https://erp.test/api/v1';process.env.ERP_PORTAL_ORIGIN='https://erp.test';
    process.env.ERP_PORTAL_SHARED_SECRET='s'.repeat(40);process.env.ERP_PORTAL_ENTITY_ID='warehouse';
    global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>valid});
  });
  afterEach(()=>jest.restoreAllMocks());
  test('does not accept admin, other companies or expired identities',()=>{
    expect(validateIdentity(valid)).toEqual(valid);
    expect(validateIdentity({...valid,role:'dispatcher'}).role).toBe('dispatcher');
    for(const changes of [{role:'admin'},{role:'superadmin'},{entityId:'other'},{expiresAt:'invalid'},{expiresAt:'2000-01-01'}]) expect(()=>validateIdentity({...valid,...changes})).toThrow();
  });
  test('requires stable ERP identity and its explicit numeric WMS mapping',async()=>{
    const pool={query:jest.fn().mockResolvedValue({rows:[{id:7,role:'picker'}]})};
    const claims={id:7,erpSubject:'staff',erpSession:'s'.repeat(64).replaceAll('s','a')};
    expect((await resolveUser(pool,claims)).id).toBe(7);
    await expect(resolveUser(pool,{...claims,erpSubject:'someone-else'})).rejects.toThrow();
    pool.query.mockResolvedValue({rows:[]});await expect(resolveUser(pool,claims)).rejects.toThrow();
  });
  test('native intake destinations remain narrow and reject external or query-bearing targets',()=>{
    for(const destination of ['/corely-intakes','/corely-intakes/123']) expect(validateIdentity({...valid,role:'dispatcher',destination}).destination).toBe(destination);
    for(const destination of ['/corely-intakes/0','/corely-intakes/123?redirect=evil','https://evil.example/corely-intakes','/corely-intakes/1234567890']) expect(()=>validateIdentity({...valid,destination})).toThrow();
  });
  test('failed ERP permission recheck closes access instead of trusting old JWT role',async()=>{
    global.fetch.mockResolvedValue({ok:false,status:403});
    await expect(resolveUser({}, {id:7,erpSubject:'staff',erpSession:'a'.repeat(64)})).rejects.toMatchObject({status:401});
    global.fetch.mockRejectedValue(new Error('network failure'));
    await expect(resolveUser({}, {id:7,erpSubject:'staff',erpSession:'a'.repeat(64)})).rejects.toMatchObject({status:503});
  });
  test('rejects malformed tickets before contacting ERP or database',async()=>{
    await expect(exchange({},'bad','bad')).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
