// frontend/src/components/admin/UserManagement.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { Users, PlusCircle, Edit, Trash2, ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const MySwal = withReactContent(Swal);

// 使用者表單的 Modal (彈出視窗)
const UserFormModal = ({ user, onClose, onSave }) => {
    const [formData, setFormData] = useState({
        username: user?.username || '',
        name: user?.name || '',
        password: '',
        role: user?.role || 'picker',
    });
    const [isSaving, setIsSaving] = useState(false);

    const isEditMode = !!user;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave(formData);
            onClose();
        } catch (error) {
            // 错误处理已在 onSave 中完成，这里只负责关闭 loading
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-center" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-semibold text-gray-800">{isEditMode ? '編輯使用者' : '新增使用者'}</h3>
                        <div className="mt-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">使用者名稱</label>
                                <input type="text" name="username" value={formData.username} onChange={handleChange} required disabled={isEditMode} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm disabled:bg-gray-100"/>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">姓名</label>
                                <input type="text" name="name" value={formData.name} onChange={handleChange} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">密碼</label>
                                <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder={isEditMode ? '留空表示不變更' : ''} required={!isEditMode} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"/>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">角色</label>
                                <select name="role" value={formData.role} onChange={handleChange} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm">
                                    <option value="picker">揀貨員</option>
                                    <option value="packer">裝箱員</option>
                                    <option value="admin">管理員</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                        <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 bg-white border rounded-md text-sm font-medium">取消</button>
                        <button type="submit" disabled={isSaving} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium flex items-center gap-2">
                            {isSaving && <Loader2 className="animate-spin h-4 w-4"/>}
                            {isEditMode ? '儲存變更' : '建立使用者'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);

    const fetchUsers = useCallback(async () => {
        try {
            setLoading(true);
            const response = await apiClient.get('/api/admin/users');
            setUsers(response.data);
        } catch (error) {
            toast.error('載入使用者列表失敗', { description: error.response?.data?.message });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleOpenModal = (user = null) => {
        setEditingUser(user);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingUser(null);
    };

    const handleSaveUser = async (formData) => {
        const isEdit = !!editingUser;
        const apiCall = isEdit
            ? apiClient.put(`/api/admin/users/${editingUser.id}`, formData)
            : apiClient.post('/api/admin/create-user', formData);

        const promise = toast.promise(apiCall, {
            loading: isEdit ? '正在更新使用者...' : '正在建立使用者...',
            success: (response) => {
                fetchUsers(); // 重新整理列表
                return response.data.message;
            },
            error: (err) => err.response?.data?.message || '操作失敗',
        });
        
        // 抛出错误以便 Modal 知道操作是否成功
        return promise;
    };
    
    const handleDeleteUser = (user) => {
        MySwal.fire({
            title: `確定要刪除 ${user.name} (${user.username}) 嗎？`,
            text: "此操作無法復原！",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '確認刪除',
            cancelButtonText: '取消',
        }).then((result) => {
            if (result.isConfirmed) {
                const promise = apiClient.delete(`/api/admin/users/${user.id}`);
                toast.promise(promise, {
                    loading: '正在刪除使用者...',
                    success: (response) => {
                        fetchUsers(); // 重新整理列表
                        return response.data.message;
                    },
                    error: (err) => err.response?.data?.message || '刪除失敗',
                });
            }
        });
    };

    const roleMap = { admin: '管理員', picker: '揀貨員', packer: '裝箱員' };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-background min-h-screen">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center">
                        <Users className="mr-3 text-primary" />
                        使用者管理
                    </h1>
                    <p className="text-secondary-foreground mt-1">新增、檢視、編輯或刪除系統操作員</p>
                </div>
                <div className="flex gap-4">
                    <Link to="/admin" className="flex-shrink-0 flex items-center px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        返回管理中心
                    </Link>
                    <button onClick={() => handleOpenModal()} className="flex-shrink-0 flex items-center px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        新增使用者
                    </button>
                </div>
            </header>
            
            {loading ? (
                <div className="flex justify-center items-center py-20"><Loader2 className="animate-spin text-primary" size={48} /></div>
            ) : (
                <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="bg-gray-50 text-xs text-gray-700 uppercase">
                            <tr>
                                <th scope="col" className="px-6 py-3">ID</th>
                                <th scope="col" className="px-6 py-3">使用者名稱</th>
                                <th scope="col" className="px-6 py-3">姓名</th>
                                <th scope="col" className="px-6 py-3">角色</th>
                                <th scope="col" className="px-6 py-3">建立時間</th>
                                <th scope="col" className="px-6 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="bg-white border-b hover:bg-gray-50">
                                    <td className="px-6 py-4">{user.id}</td>
                                    <td className="px-6 py-4 font-medium text-gray-900">{user.username}</td>
                                    <td className="px-6 py-4">{user.name}</td>
                                    <td className="px-6 py-4">{roleMap[user.role] || user.role}</td>
                                    <td className="px-6 py-4">{new Date(user.created_at).toLocaleDateString('zh-TW')}</td>
                                    <td className="px-6 py-4 text-right">
                                        <button onClick={() => handleOpenModal(user)} className="font-medium text-blue-600 hover:underline mr-4"><Edit size={16}/></button>
                                        <button onClick={() => handleDeleteUser(user)} className="font-medium text-red-600 hover:underline"><Trash2 size={16}/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {isModalOpen && <UserFormModal user={editingUser} onClose={handleCloseModal} onSave={handleSaveUser} />}
        </div>
    );
}