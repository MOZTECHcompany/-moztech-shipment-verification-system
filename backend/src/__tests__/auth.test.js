// backend/src/__tests__/auth.test.js
// 認證功能測試

const authService = require('../services/authService');

// Mock database
jest.mock('../config/database', () => ({
    pool: {
        query: jest.fn()
    }
}));

const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

describe('AuthService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('login', () => {
        it('應該成功登入並返回 accessToken 和用戶資訊', async () => {
            // 準備測試數據
            const mockUser = {
                id: 1,
                username: 'testuser',
                password: await bcrypt.hash('password123', 10),
                name: '測試用戶',
                role: 'admin',
                created_at: new Date()
            };

            // Mock 資料庫查詢
            pool.query.mockResolvedValueOnce({
                rows: [mockUser]
            });

            // 執行登入
            const result = await authService.login('testuser', 'password123');

            // 驗證結果
            expect(result).toHaveProperty('accessToken');
            expect(result).toHaveProperty('user');
            expect(result.user.username).toBe('testuser');
            expect(result.user.role).toBe('admin');
            expect(result.user).not.toHaveProperty('password');

            // 驗證資料庫查詢被調用
            expect(pool.query).toHaveBeenCalledWith(
                'SELECT id, username, password, name, role FROM users WHERE LOWER(username) = LOWER($1)',
                ['testuser']
            );
        });

        it('用戶不存在時應該拋出錯誤', async () => {
            pool.query.mockResolvedValueOnce({
                rows: []
            });

            await expect(
                authService.login('nonexistent', 'password')
            ).rejects.toThrow('用戶名或密碼錯誤');
        });

        it('密碼錯誤時應該拋出錯誤', async () => {
            const mockUser = {
                id: 1,
                username: 'testuser',
                password: await bcrypt.hash('correctpassword', 10),
                role: 'admin'
            };

            pool.query.mockResolvedValueOnce({
                rows: [mockUser]
            });

            await expect(
                authService.login('testuser', 'wrongpassword')
            ).rejects.toThrow('用戶名或密碼錯誤');
        });
    });

    describe('verifyToken', () => {
        it('應該成功驗證有效的 token', async () => {
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
                { userId: 1, username: 'testuser', role: 'admin' },
                process.env.JWT_SECRET || 'test-secret',
                { expiresIn: '1h' }
            );

            const result = await authService.verifyToken(token);

            expect(result).toHaveProperty('userId', 1);
            expect(result).toHaveProperty('username', 'testuser');
            expect(result).toHaveProperty('role', 'admin');
        });

        it('無效的 token 應該拋出錯誤', async () => {
            await expect(
                authService.verifyToken('invalid-token')
            ).rejects.toThrow('Token 無效或已過期');
        });
    });
});
