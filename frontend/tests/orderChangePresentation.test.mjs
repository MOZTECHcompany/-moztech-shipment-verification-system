import test from 'node:test';
import assert from 'node:assert/strict';
import {changeQuantityRange} from '../src/utils/orderChangePresentation.js';
import {isWarehouseAdmin,managementRoleLabel} from '../src/utils/managementScope.js';
const items=[{barcode:'SAME',quantityChange:-1},{barcode:'SAME',quantityChange:1}];
test('SN replacement previews sequential quantities, and approved history never replays deltas',()=>{
    const pending={status:'open',snapshot:{proposal:{items},baselineItems:[{barcode:'SAME',quantity:2}]}};
    assert.deepEqual(items.map((_,i)=>changeQuantityRange(pending,i)),[{before:2,after:1},{before:1,after:2}]);
    const ack={status:'ack',snapshot:{proposal:{items},applyResult:{changesApplied:[{barcode:'SAME',previousTotalQuantity:2,newTotalQuantity:1},{barcode:'SAME',previousTotalQuantity:1,newTotalQuantity:2}]}}};
    assert.deepEqual(items.map((_,i)=>changeQuantityRange(ack,i,[{barcode:'SAME',quantity:99}])),[{before:2,after:1},{before:1,after:2}]);
    assert.equal(changeQuantityRange({status:'ack',snapshot:{proposal:{items}}},0,[{barcode:'SAME',quantity:2}]),null);
});
test('order management is distinct from warehouse approval and system administration',()=>{
    assert.equal(isWarehouseAdmin({role:'admin',management_scope:'orders'}),false);
    assert.equal(isWarehouseAdmin({role:'admin',management_scope:'warehouse'}),true);
    assert.equal(isWarehouseAdmin({role:'superadmin',management_scope:'orders'}),true);
    assert.equal(managementRoleLabel({role:'admin',management_scope:'orders'}),'訂單管理員');
    assert.equal(managementRoleLabel({role:'admin',management_scope:'warehouse'}),'倉儲管理員');
});
