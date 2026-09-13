const {EventEmitter}=require('events');
const {createQueryAdmission}=require('../middleware/queryAdmission');
function response(){const r=new EventEmitter();r.set=jest.fn(()=>r);r.status=jest.fn(()=>r);r.json=jest.fn(()=>r.end());r.end=jest.fn();return r}
test('reads queue and release on handler completion, not premature client disconnect',()=>{
    const admit=createQueryAdmission(),first=response(),second=response(),a=jest.fn(),b=jest.fn();
    admit({method:'GET',path:'/api/tasks'},first,a);admit({method:'GET',path:'/api/analytics'},second,b);
    expect(a).toHaveBeenCalledTimes(1);expect(b).not.toHaveBeenCalled();
    first.emit('close');expect(b).not.toHaveBeenCalled();
    first.end();expect(b).toHaveBeenCalledTimes(1);second.end();
});
test('scan commands bypass the bounded read queue; overflow is explicit',()=>{
    const admit=createQueryAdmission({maxQueued:0}),first=response(),scan=jest.fn(),queued=response();
    admit({method:'GET',path:'/api/tasks'},first,()=>{});
    admit({method:'POST',path:'/api/orders/update_item'},response(),scan);expect(scan).toHaveBeenCalledTimes(1);
    admit({method:'GET',path:'/api/tasks'},queued,()=>{});expect(queued.status).toHaveBeenCalledWith(503);first.end();
});
