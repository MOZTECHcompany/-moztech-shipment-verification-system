import test from 'node:test';
import assert from 'node:assert/strict';
import { workTypesForUser, canWork, taiwanWorkDate, workModeStorageKey, orderWorkUrl } from '../src/utils/workCapabilities.js';
import { taskPageUrl, taskQueryScope } from '../src/utils/taskPage.js';
import { batchStagesForRole, filterTasks, isActiveTaskForRole } from '../src/utils/taskFilters.js';

test('server capabilities allow one account and every manager scope to perform both stages without changing its role', () => {
    for (const role of ['picker','packer','admin','superadmin']) {
        const user = { id: 7, role, management_scope: 'orders', work_types: ['pick','pack'] };
        assert.deepEqual(workTypesForUser(user), ['pick','pack']);
        assert.deepEqual(batchStagesForRole(user), ['pick','pack']);
        assert.equal(canWork(user,'pick'),true);
        assert.equal(canWork(user,'pack'),true);
        assert.equal(user.role,role);
    }
    assert.deepEqual(workTypesForUser({role:'superadmin',work_types:[]}),[]);
    assert.deepEqual(workTypesForUser({role:'picker',work_types:['pack','unknown','pack']}),['pack']);
});

test('both personal stages remain attributable to the same identity and do not expose another worker’s task', () => {
    const user={id:7,role:'picker',work_types:['pick','pack']};
    const tasks=[{id:1,status:'picking',picker_id:7},{id:2,status:'packing',packer_id:7},{id:3,status:'packing',packer_id:8}];
    assert.deepEqual(filterTasks(tasks,{group:'mine',user}).map(item=>item.id),[1,2]);
    assert.equal(isActiveTaskForRole(tasks[1],user),true);
    assert.equal(isActiveTaskForRole(tasks[2],user),false);
});

test('task cursor scopes separate stages while completed history remains independent of today’s choice', () => {
    const query={view:'active',date:'2026-10-13',search:'',status:'all',urgent:false,group:'mine'};
    assert.notEqual(taskQueryScope({...query,stage:'pick'}),taskQueryScope({...query,stage:'pack'}));
    assert.match(taskPageUrl({...query,stage:'pack'}),/stage=pack/);
    assert.match(taskPageUrl({...query,stage:'pack'}),/group=mine/);
    assert.doesNotMatch(taskPageUrl({...query,view:'completed',stage:'pick'}),/stage=/);
    assert.equal(taskQueryScope({...query,view:'completed',stage:'pick'}),taskQueryScope({...query,view:'completed',stage:'pack'}));
});

test('mode cache is scoped to person and Taiwan work date, and order URLs explicitly freeze the requested stage', () => {
    assert.equal(taiwanWorkDate(new Date('2026-10-12T16:01:00Z')),'2026-10-13');
    assert.notEqual(workModeStorageKey(7,'2026-10-13'),workModeStorageKey(8,'2026-10-13'));
    assert.notEqual(workModeStorageKey(7,'2026-10-13'),workModeStorageKey(7,'2026-10-14'));
    assert.equal(orderWorkUrl(123,'pack'),'/order/123?stage=pack');
    assert.equal(orderWorkUrl(123,'pick'),'/order/123?stage=pick');
    assert.equal(orderWorkUrl(123,'invalid'),'/order/123');
});
