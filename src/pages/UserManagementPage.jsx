// 檔案路徑: src/pages/UserManagementPage.jsx
// 這是全新的檔案，請直接貼上

import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/api';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { UserPlus, Users, Loader } from 'lucide-react';

const MySwal = withReactContent(Swal);

function UserManagementPage() {
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        username: '',
        password: '',
        role: 'operator' // 預設角色為操作員
    });

    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await apiClient.get('/api/users');
            setUsers(response.data);
        } catch (error) {
            console.error("無法獲取使用者", error);
            MySwal.fire({
                icon: 'error',
                title: '載入失敗',
                text: '無法載入使用者列表，請檢查您的權限或網路連線。',
            });
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (formData.password.length < 6) {
             MySwal.fire({
                icon: 'warning',
                title: '密碼太短',
                text: '為安全起見，密碼長度至少需要6位',
             });
             return;
        }
        
        setIsSubmitting(true);
        try {
            const response = await apiClient.post('/api/auth/register', formData);
            MySwal.fire('成功', response.data.message, 'success');
            fetchUsers(); // 成功後刷新使用者列表
            setFormData({ name: '', username: '', password: '', role: 'operator' }); // 清空表單
        } catch (error) {
            MySwal.fire('錯誤', error.response?.data?.message || '註冊失敗，請稍後再試', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">使用者管理</h1>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* 左側：新增使用者表單 */}
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center gap-2">
                                <UserPlus /> 新增使用者
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="text-sm font-medium text-gray-700">姓名</label>
                                    <input name="name" value={formData.name} onChange={handleChange} placeholder="例如：王大明" required className="w-full mt-1 p-2 border rounded-md" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700">登入帳號</label>
                                    <input name="username" value={formData.username} onChange={handleChange} placeholder="例如：davidwang" required className="w-full mt-1 p-2 border rounded-md" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700">密碼</label>
                                    <input name="password" type="password" value={formData.password} onChange={handleChange} placeholder="至少6位" required className="w-full mt-1 p-2 border rounded-md" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700">角色</label>
                                    <select name="role" value={formData.role} onChange={handleChange} className="w-full mt-1 p-2 border rounded-md bg-white">
                                        <option value="operator">操作員 (Operator)</option>
                                        <option value="admin">管理員 (Admin)</option>
                                    </select>
                                </div>
                                <button type="submit" disabled={isSubmitting} className="w-full flex justify-center items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                                    {isSubmitting && <Loader className="animate-spin" size={16}/>}
                                    {isSubmitting ? '建立中...' : '建立帳號'}
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* 右側：使用者列表 */}
                    <div className="lg:col-span-2">
                         <div className="bg-white p-6 rounded-lg shadow-md">
                            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center gap-2">
                                <Users /> 現有使用者列表
                            </h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left table-auto">
                                    <thead className="bg-gray-100 text-sm text-gray-600">
                                        <tr>
                                            <th className="p-3 font-semibold">姓名</th>
                                            <th className="p-3 font-semibold">帳號</th>
                                            <th className="p-3 font-semibold">角色</th>
                                            <th className="p-3 font-semibold">建立時間</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-sm">
                                        {isLoading ? (
                                            <tr><td colSpan="4" className="text-center p-8 text-gray-500">
                                                <div className="flex justify-center items-center gap-2">
                                                    <Loader className="animate-spin" /> 載入使用者資料中...
                                                </div>
                                            </td></tr>
                                        ) : (
                                            users.map(user => (
                                                <tr key={user.id} className="border-b hover:bg-gray-50">
                                                    <td className="p-3 font-medium text-gray-900">{user.name}</td>
                                                    <td className="p-3 text-gray-700">{user.username}</td>
                                                    <td className="p-3">
                                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                                            {user.role === 'admin' ? '管理員' : '操作員'}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-gray-500">{user.created_at}</td>
                                                </tr>
                                            ))
                                        )}
                                        {!isLoading && users.length === 0 && (
                                            <tr><td colSpan="4" className="text-center p-8 text-gray-500">尚無使用者資料。</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default UserManagementPage;