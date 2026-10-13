// backend/src/__tests__/user.test.js
// 用戶服務測試

const userService = require('../services/userService');

jest.mock('../config/database', () => ({
    pool: {
        query: jest.fn(), connect: jest.fn()
    }
}));

const { pool } = require('../config/database');
function deletionClient({exists=true,hasHistory=false}={}) {
    const db={query:jest.fn(async sql=>{
        if(sql.startsWith('SELECT id,username')) return {rows:exists?[{id:1,username:'deleteduser'}]:[]};
        if(sql.includes('AS has_history')) return {rows:[{has_history:hasHistory}]};
        if(sql.startsWith('DELETE FROM users')) return {rows:[{username:'deleteduser'}],rowCount:1};
        return {rows:[],rowCount:0};
    }),release:jest.fn()};
    pool.connect.mockResolvedValueOnce(db);
    return db;
}

describe('UserService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createUser', () => {
        it('應該成功創建新用戶', async () => {
            const mockUser = {
                id: 1,
                username: 'newuser',
                name: '新用戶',
                role: 'picker',
                created_at: new Date()
            };

            // Mock: 檢查用戶是否存在（不存在）
            pool.query.mockResolvedValueOnce({ rows: [] });
            // Mock: 插入新用戶
            pool.query.mockResolvedValueOnce({ rows: [mockUser] });

            const result = await userService.createUser({
                username: 'newuser',
                password: 'password123',
                name: '新用戶',
                role: 'picker'
            });

            expect(result).toEqual({ ...mockUser,management_scope:'all',can_pick:null,can_pack:null,work_types:['pick','pack'] });
            expect(pool.query).toHaveBeenCalledTimes(2);
        });

        it('用戶名已存在時應該拋出錯誤', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 1 }] // 用戶已存在
            });

            await expect(
                userService.createUser({
                    username: 'existing',
                    password: 'password',
                    name: '用戶',
                    role: 'picker'
                })
            ).rejects.toThrow('用戶名已存在');
        });
    });

    describe('getAllUsers', () => {
        it('應該返回所有用戶列表', async () => {
            const mockUsers = [
                { id: 1, username: 'user1', name: '用戶1', role: 'admin' },
                { id: 2, username: 'user2', name: '用戶2', role: 'picker' }
            ];

            pool.query.mockResolvedValueOnce({ rows: mockUsers });

            const result = await userService.getAllUsers();

            expect(result).toEqual(mockUsers.map(user => ({ ...user,management_scope:'all',can_pick:null,can_pack:null,work_types:['pick','pack'] })));
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT id, username, name, role')
            );
        });
    });

    describe('updateUser', () => {
        it('應該成功更新用戶資訊', async () => {
            const mockUser = {
                id: 1,
                username: 'testuser',
                name: '更新後的名字',
                role: 'packer'
            };

            pool.query.mockResolvedValueOnce({ rows: [mockUser] });

            const result = await userService.updateUser(1, {
                name: '更新後的名字',
                role: 'packer'
            });

            expect(result).toEqual({ ...mockUser,management_scope:'all',can_pick:null,can_pack:null,work_types:['pick','pack'] });
        });

        it('用戶不存在時應該拋出錯誤', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            await expect(
                userService.updateUser(999, { name: '測試' })
            ).rejects.toThrow('用戶不存在');
        });
    });

    describe('deleteUser', () => {
        it('應該成功刪除用戶', async () => {
            const db = deletionClient();

            const result = await userService.deleteUser(1);

            expect(result).toEqual({ username: 'deleteduser' });
            expect(db.query).toHaveBeenCalledWith('SELECT id,username FROM users WHERE id=$1 FOR UPDATE',[1]);
            expect(db.query).toHaveBeenCalledWith('COMMIT');
            expect(db.release).toHaveBeenCalledTimes(1);
        });

        it('用戶不存在時應該拋出錯誤', async () => {
            const db = deletionClient({exists:false});

            await expect(
                userService.deleteUser(999)
            ).rejects.toThrow('用戶不存在');
        });
    });
});


test('changing only warehouse capabilities leaves identity, password and management role untouched',async()=>{
    pool.query.mockResolvedValueOnce({rows:[{id:1,username:'same-account',name:'Same person',role:'picker',can_pick:true,can_pack:false}]});
    const user=await userService.updateUser(1,{can_pick:true,can_pack:false});
    const [sql,values]=pool.query.mock.calls[0];
    expect(sql.split(' RETURNING ')[0]).toBe('UPDATE users SET can_pick = $1, can_pack = $2 WHERE id = $3');
    expect(values).toEqual([true,false,1]);
    expect(user.work_types).toEqual(['pick']);
    expect(user.username).toBe('same-account');
});


test('a used warehouse account cannot be hard-deleted or lose its assignment/audit references',async()=>{
    const db=deletionClient({hasHistory:true});
    await expect(userService.deleteUser(1)).rejects.toMatchObject({status:409,message:'此帳號已有作業或交接紀錄，不能刪除，以保留責任追溯。'});
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM users'))).toBe(false);
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    const [guardSql]=db.query.mock.calls.find(([sql])=>sql.includes('AS has_history'));
    expect(guardSql).toContain('picker_id=$1 OR packer_id=$1');
    expect(guardSql).toContain('from_user_id=$1 OR to_user_id=$1 OR performed_by=$1');
    expect(guardSql).toContain('FROM operation_logs WHERE user_id=$1');
    expect(db.release).toHaveBeenCalledTimes(1);
});
