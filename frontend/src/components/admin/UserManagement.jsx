// frontend/src/components/admin/UserManagement.jsx
// 使用者管理頁面 - Apple 風格現代化版本

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { Users, PlusCircle, Edit, Trash2, ArrowLeft, Loader2, Shield, User as UserIcon } from 'lucide-react';
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center animate-fade-in" onClick={onClose}>
            <div className="glass-card w-full max-w-md shadow-apple-xl animate-scale-in" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b border-gray-200">
                        <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                            {isEditMode ? '編輯使用者' : '新增使用者'}
                        </h3>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">使用者名稱</label>
                            <input 
                                type="text" 
                                name="username" 
                                value={formData.username} 
                                onChange={handleChange} 
                                required 
                                disabled={isEditMode} 
                                className="input-apple w-full disabled:bg-gray-100 disabled:cursor-not-allowed"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">姓名</label>
                            <input 
                                type="text" 
                                name="name" 
                                value={formData.name} 
                                onChange={handleChange} 
                                required 
                                className="input-apple w-full"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">密碼</label>
                            <input 
                                type="password" 
                                name="password" 
                                value={formData.password} 
                                onChange={handleChange} 
                                placeholder={isEditMode ? '留空表示不變更' : ''} 
                                required={!isEditMode} 
                                className="input-apple w-full"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">角色</label>
                            <select 
                                name="role" 
                                value={formData.role} 
                                onChange={handleChange} 
                                required 
                                className="input-apple w-full"
                            >
                                <option value="picker">揀貨員</option>
                                <option value="packer">裝箱員</option>
                                <option value="admin">管理員</option>
                            </select>
                        </div>
                    </div>
                    <div className="bg-gradient-to-r from-gray-50 to-blue-50 px-6 py-4 flex justify-end gap-3 rounded-b-2xl border-t border-gray-200">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            disabled={isSaving} 
                            className="btn-apple bg-gradient-to-r from-gray-400 to-gray-500 hover:from-gray-500 hover:to-gray-600 text-white shadow-apple-lg"
                        >
                            取消
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSaving} 
                            className="btn-apple bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-apple-lg flex items-center gap-2 disabled:opacity-50"
                        >
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
            confirmButtonColor: '#EF4444',
            cancelButtonColor: '#6B7280',
            confirmButtonText: '確認刪除',
            cancelButtonText: '取消',
            customClass: {
                popup: 'glass card-apple',
                confirmButton: 'btn-apple',
                cancelButton: 'btn-apple'
            }
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

    const roleMap = { 
        admin: { label: '管理員', color: 'bg-gradient-to-br from-red-50 to-red-100 text-red-800 border-red-200', icon: Shield },
        picker: { label: '揀貨員', color: 'bg-gradient-to-br from-blue-50 to-blue-100 text-blue-800 border-blue-200', icon: UserIcon },
        packer: { label: '裝箱員', color: 'bg-gradient-to-br from-green-50 to-green-100 text-green-800 border-green-200', icon: UserIcon }
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gradient-to-br from-gray-50 to-purple-50/30 min-h-screen">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4 animate-fade-in">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-purple/10 to-apple-pink/10 flex items-center justify-center">
                        <Users className="w-7 h-7 text-apple-purple" />
                    </div>
                    <div>
                        <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
                            👤 使用者管理
                        </h1>
                        <p className="text-gray-500 mt-1 font-medium">新增、檢視、編輯或刪除系統操作員</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <Link to="/admin" 
                        className="btn-apple bg-white/90 backdrop-blur-xl border-2 border-gray-200 hover:border-gray-300 text-gray-700 hover:bg-white flex items-center gap-2 shadow-apple">
                        <ArrowLeft className="h-4 w-4" />
                        返回管理中心
                    </Link>
                    <button 
                        onClick={() => handleOpenModal()} 
                        className="btn-apple bg-apple-purple/90 backdrop-blur-xl hover:bg-apple-purple text-white flex items-center gap-2 shadow-apple-lg">
                        <PlusCircle className="h-4 w-4" />
                        新增使用者
                    </button>
                </div>
            </header>
            
            {loading ? (
                <div className="flex flex-col justify-center items-center py-20">
                    <Loader2 className="animate-spin text-purple-500 mb-4" size={48} />
                    <p className="text-gray-600 font-medium">載入使用者列表中...</p>
                </div>
            ) : (
                <div className="glass-card overflow-hidden animate-scale-in shadow-apple-lg">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gradient-to-r from-gray-50 to-purple-50 border-b border-gray-200">
                                <tr>
                                    <th scope="col" className="px-6 py-4 text-xs font-bold text-gray-700 uppercase">ID</th>
                                    <th scope="col" className="px-6 py-4 text-xs font-bold text-gray-700 uppercase">使用者名稱</th>
                                    <th scope="col" className="px-6 py-4 text-xs font-bold text-gray-700 uppercase">姓名</th>
                                    <th scope="col" className="px-6 py-4 text-xs font-bold text-gray-700 uppercase">角色</th>
                                    <th scope="col" className="px-6 py-4 text-xs font-bold text-gray-700 uppercase">建立時間</th>
                                    <th scope="col" className="px-6 py-4 text-xs font-bold text-gray-700 uppercase text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {users.map((user, index) => {
                                    const RoleIcon = roleMap[user.role]?.icon || UserIcon;
                                    return (
                                        <tr key={user.id} className="hover:bg-purple-50/50 transition-all duration-200 animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                                            <td className="px-6 py-4">
                                                <span className="font-mono text-sm text-gray-600">{user.id}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-2 bg-gradient-to-br from-blue-100 to-blue-200 rounded-lg">
                                                        <UserIcon className="w-4 h-4 text-blue-600" />
                                                    </div>
                                                    <span className="font-semibold text-gray-900">{user.username}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-gray-700">{user.name}</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-3 py-1.5 inline-flex items-center gap-2 text-xs font-semibold rounded-xl border ${roleMap[user.role]?.color || 'bg-gray-100 text-gray-800 border-gray-200'} shadow-sm`}>
                                                    <RoleIcon className="w-3 h-3" />
                                                    {roleMap[user.role]?.label || user.role}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-gray-600">{new Date(user.created_at).toLocaleDateString('zh-TW')}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button 
                                                    onClick={() => handleOpenModal(user)} 
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-xs font-medium rounded-lg shadow-md hover:shadow-lg transition-all duration-200 mr-2">
                                                    <Edit size={14}/>
                                                    編輯
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteUser(user)} 
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white text-xs font-medium rounded-lg shadow-md hover:shadow-lg transition-all duration-200">
                                                    <Trash2 size={14}/>
                                                    刪除
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    {users.length === 0 && (
                        <div className="text-center py-12">
                            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <p className="text-gray-500 text-lg">目前沒有使用者</p>
                        </div>
                    )}
                </div>
            )}

            {isModalOpen && <UserFormModal user={editingUser} onClose={handleCloseModal} onSave={handleSaveUser} />}
        </div>
    );
}
