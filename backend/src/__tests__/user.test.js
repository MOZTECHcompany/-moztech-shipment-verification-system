// backend/src/__tests__/user.test.js
// 用戶服務測試

const userService = require('../services/userService');

jest.mock('../config/database', () => ({
    pool: {
        query: jest.fn()
    }
}));

const { pool } = require('../config/database');

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

            expect(result).toEqual(mockUser);
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

            expect(result).toEqual(mockUsers);
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

            expect(result).toEqual(mockUser);
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
            pool.query.mockResolvedValueOnce({ 
                rows: [{ username: 'deleteduser' }] 
            });

            const result = await userService.deleteUser(1);

            expect(result).toEqual({ username: 'deleteduser' });
        });

        it('用戶不存在時應該拋出錯誤', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            await expect(
                userService.deleteUser(999)
            ).rejects.toThrow('用戶不存在');
        });
    });
});
