// frontend/src/components/admin/UserManagement.jsx
// 使用者管理頁面 - Apple 風格現代化版本

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { Users, PlusCircle, Edit, Trash2, ArrowLeft, Loader2, Shield, User as UserIcon } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { PageHeader, Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Table, THead, TH, TBody, TR, TD, Modal, Input, Badge, EmptyState, Skeleton, SkeletonText } from '../../ui';

const MySwal = withReactContent(Swal);

// 使用者表單 Modal (使用設計系統 Modal + Input + Button)
const UserFormModal = ({ user, open, onClose, onSave }) => {
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
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave(formData);
            onClose();
        } catch (error) {
            // 錯誤已在 onSave 中處理
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={isEditMode ? '編輯使用者' : '新增使用者'}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={isSaving}>取消</Button>
                    <Button onClick={handleSubmit} disabled={isSaving} className="gap-2">
                        {isSaving && <Loader2 className="animate-spin h-4 w-4" />}
                        {isEditMode ? '儲存變更' : '建立使用者'}
                    </Button>
                </>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                <Input
                    label="使用者名稱"
                    name="username"
                    value={formData.username}
                    onChange={handleChange}
                    placeholder="輸入使用者名稱"
                    autoComplete="username"
                    disabled={isEditMode}
                />
                <Input
                    label="姓名"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="輸入姓名"
                    autoComplete="name"
                />
                <Input
                    label="密碼"
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder={isEditMode ? '留空表示不變更' : '設定密碼'}
                    autoComplete="new-password"
                />
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">角色</label>
                    <select
                        name="role"
                        value={formData.role}
                        onChange={handleChange}
                        className="w-full py-3 px-4 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10 outline-none transition-all text-gray-900 font-medium"
                    >
                        <option value="picker">揀貨員</option>
                        <option value="packer">裝箱員</option>
                            <option value="dispatcher">拋單員</option>
                        <option value="admin">管理員</option>
                    </select>
                </div>
            </form>
        </Modal>
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
        packer: { label: '裝箱員', color: 'bg-gradient-to-br from-green-50 to-green-100 text-green-800 border-green-200', icon: UserIcon },
        dispatcher: { label: '拋單員', color: 'bg-gradient-to-br from-purple-50 to-purple-100 text-purple-800 border-purple-200', icon: UserIcon }
    };

        return (
            <div className="p-6 md:p-8 max-w-7xl mx-auto min-h-screen">
                <PageHeader
                    title="使用者管理"
                    description="新增、檢視、編輯或刪除系統操作員"
                    actions={
                        <div className="flex gap-3">
                            <Link to="/admin">
                                <Button variant="secondary" size="sm" className="gap-1">
                                    <ArrowLeft className="h-4 w-4" /> 返回
                                </Button>
                            </Link>
                            <Button variant="primary" size="sm" className="gap-1" onClick={() => handleOpenModal()}>
                                <PlusCircle className="h-4 w-4" /> 新增使用者
                            </Button>
                        </div>
                    }
                />

                {loading ? (
                    <Card className="mt-8">
                        <CardHeader>
                            <CardTitle>載入使用者列表中...</CardTitle>
                            <CardDescription>請稍候，正在取得資料</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-10 w-full" />
                            ))}
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="mt-8">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-apple-purple" /> 使用者列表 ({users.length})
                            </CardTitle>
                            <CardDescription>系統中所有操作員帳號</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {users.length === 0 ? (
                                <EmptyState
                                    title="目前沒有使用者"
                                    description="開始建立第一個操作員以使用系統。"
                                    action={<Button onClick={() => handleOpenModal()}>建立使用者</Button>}
                                />
                            ) : (
                                <Table>
                                    <THead>
                                        <TH>ID</TH>
                                        <TH>使用者名稱</TH>
                                        <TH>姓名</TH>
                                        <TH>角色</TH>
                                        <TH>建立時間</TH>
                                        <TH className="text-right">操作</TH>
                                    </THead>
                                    <TBody>
                                        {users.map((user) => (
                                            <TR key={user.id}>
                                                <TD className="font-mono text-xs text-gray-600">{user.id}</TD>
                                                <TD>
                                                    <div className="flex items-center gap-2">
                                                        <div className="p-2 bg-gradient-to-br from-blue-100 to-blue-200 rounded-lg">
                                                            <UserIcon className="w-4 h-4 text-blue-600" />
                                                        </div>
                                                        <span className="font-semibold text-gray-900">{user.username}</span>
                                                    </div>
                                                </TD>
                                                <TD>{user.name}</TD>
                                                <TD>
                                                    <Badge variant={user.role === 'admin' ? 'danger' : (user.role === 'picker' || user.role === 'dispatcher') ? 'info' : 'success'} className="inline-flex items-center gap-1">
                                                        {user.role === 'admin' && <Shield className="h-3 w-3" />}
                                                        {user.role === 'picker' && <UserIcon className="h-3 w-3" />}
                                                        {user.role === 'packer' && <UserIcon className="h-3 w-3" />}
                                                        {user.role === 'dispatcher' && <UserIcon className="h-3 w-3" />}
                                                        {user.role === 'admin' ? '管理員' : user.role === 'picker' ? '揀貨員' : user.role === 'dispatcher' ? '拋單員' : '裝箱員'}
                                                    </Badge>
                                                </TD>
                                                <TD className="text-xs text-gray-600">{new Date(user.created_at).toLocaleDateString('zh-TW')}</TD>
                                                <TD className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="secondary" size="xs" className="gap-1" onClick={() => handleOpenModal(user)}>
                                                            <Edit className="h-3 w-3" /> 編輯
                                                        </Button>
                                                        <Button
                                                            variant="danger"
                                                            size="xs"
                                                            className="gap-1"
                                                            onClick={() => handleDeleteUser(user)}
                                                        >
                                                            <Trash2 className="h-3 w-3" /> 刪除
                                                        </Button>
                                                    </div>
                                                </TD>
                                            </TR>
                                        ))}
                                    </TBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                )}

                <UserFormModal user={editingUser} open={isModalOpen} onClose={handleCloseModal} onSave={handleSaveUser} />
            </div>
        );
}
