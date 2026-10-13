// frontend/src/components/TaskDashboard-with-batch.jsx
// 帶批次操作的任務儀表板 (保留原有功能 + 新增批次選擇)

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { 
    Package, Box, User, Loader2, ServerOff, LayoutDashboard, Trash2, 
    Volume2, VolumeX, ArrowRight, Clock, CheckCircle2, CheckSquare, 
    Square, Trash, HandMetal, BarChart3
} from 'lucide-react';
import Swal from '@/workspace/nativeSwal';
import withReactContent from 'sweetalert2-react-content';
import { soundNotification } from '@/utils/soundNotification.js';

const statusConfig = {
    pending: { 
        text: '待揀貨', 
        color: 'bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-700 border border-amber-200',
        icon: Clock,
        dot: 'bg-amber-500'
    },
    picking: { 
        text: '揀貨中', 
        color: 'bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-700 border border-blue-200',
        icon: Package,
        dot: 'bg-blue-500'
    },
    packing: { 
        text: '裝箱中', 
        color: 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 border border-green-200',
        icon: Box,
        dot: 'bg-green-500'
    },
    completed: { 
        text: '已完成', 
        color: 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 border border-purple-200',
        icon: CheckCircle2,
        dot: 'bg-purple-500'
    },
    voided: { 
        text: '已作廢', 
        color: 'bg-gradient-to-r from-gray-50 to-slate-50 text-gray-600 border border-gray-200',
        icon: null,
        dot: 'bg-gray-400'
    }
};

const TaskCard = ({ task, user, onClaim, onDelete, isMyTask, isSelected, onToggleSelect, batchMode }) => {
    const config = statusConfig[task.status] || statusConfig.pending;
    const Icon = config.icon;
    const navigate = useNavigate();
    
    const canClaim = (
        ((task.status === 'pending' || (task.status === 'picking' && !task.picker_name)) && (user.role === 'picker' || user.role === 'admin' || user.role === 'superadmin')) ||
        (task.status === 'picking' && (user.role === 'packer' || user.role === 'admin' || user.role === 'superadmin'))
    );

    return (
        <div className={`
            glass rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-apple-lg
            ${isMyTask ? 'ring-2 ring-green-500 shadow-apple-lg' : ''}
            ${isSelected ? 'ring-2 ring-blue-500 shadow-apple-lg scale-[0.98]' : ''}
            ${batchMode ? 'cursor-pointer' : ''}
        `}
        onClick={() => batchMode && onToggleSelect(task.id)}
        >
            <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            {batchMode && (
                                <div onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id); }}>
                                    {isSelected ? 
                                        <CheckSquare className="text-blue-600 cursor-pointer" size={24} /> : 
                                        <Square className="text-gray-400 cursor-pointer hover:text-blue-600" size={24} />
                                    }
                                </div>
                            )}
                            <h3 className="text-xl font-bold text-gray-900">{task.voucher_number}</h3>
                        </div>
                        <p className="text-gray-600 flex items-center gap-2">
                            <User size={16} />
                            {task.customer_name}
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <span className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${config.color} shadow-sm`}>
                            <span className={`w-2 h-2 rounded-full ${config.dot} animate-pulse`}></span>
                            {config.text}
                        </span>
                        {isMyTask && (
                            <span className="px-3 py-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xs font-semibold rounded-full shadow-md">
                                我的任務
                            </span>
                        )}
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 border border-blue-200">
                        <p className="text-xs text-blue-700 font-medium">SKU</p>
                        <p className="text-2xl font-bold text-blue-900">{task.total_skus}</p>
                    </div>
                    <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 border border-purple-200">
                        <p className="text-xs text-purple-700 font-medium">總數</p>
                        <p className="text-2xl font-bold text-purple-900">{task.total_quantity}</p>
                    </div>
                    <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 border border-green-200">
                        <p className="text-xs text-green-700 font-medium">完成</p>
                        <p className="text-2xl font-bold text-green-900">{task.packed_quantity}</p>
                    </div>
                </div>

                {/* Actions */}
                {!batchMode && (
                    <div className="flex gap-2">
                        {isMyTask && (
                            <button
                                onClick={() => navigate(`/order/${task.id}`)}
                                className="flex-1 btn-apple bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white flex items-center justify-center gap-2 shadow-apple-lg"
                            >
                                開始作業
                                <ArrowRight size={18} />
                            </button>
                        )}
                        {canClaim && !isMyTask && (
                            <button
                                onClick={() => onClaim(task.id)}
                                className="flex-1 btn-apple bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white flex items-center justify-center gap-2 shadow-apple-lg"
                            >
                                <HandMetal size={18} />
                                認領任務
                            </button>
                        )}
                        {(user.role === 'admin' || user.role === 'superadmin') && (
                            <button
                                onClick={() => onDelete(task.id, task.voucher_number)}
                                className="btn-apple bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-apple-lg"
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export function TaskDashboard({ user }) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [soundEnabled, setSoundEnabled] = useState(soundNotification.isEnabled());
    const [batchMode, setBatchMode] = useState(false);
    const [selectedTasks, setSelectedTasks] = useState(new Set());
    const navigate = useNavigate();
    const MySwal = withReactContent(Swal);

    // 初始化音效 (用戶交互後啟動 AudioContext)
    useEffect(() => {
        const initSound = () => {
            soundNotification.play('success');
            document.removeEventListener('click', initSound);
        };
        document.addEventListener('click', initSound, { once: true });
        return () => document.removeEventListener('click', initSound);
    }, []);

    const toggleSound = () => {
        const newState = !soundEnabled;
        soundNotification.setEnabled(newState);
        setSoundEnabled(newState);
        toast.success(newState ? '🔊 音效通知已開啟' : '🔇 音效通知已關閉');
        if (newState) soundNotification.play('success');
    };

    const fetchTasks = useCallback(async () => {
        if (user) { 
            try {
                setLoading(true);
                const response = await apiClient.get('/api/tasks');
                setTasks(response.data);
            } catch (error) {
                if (error.response?.status !== 401) {
                    toast.error('載入任務失敗', { description: error.response?.data?.message || '請稍後再試' });
                }
            } finally {
                setLoading(false);
            }
        }
    }, [user]);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    useEffect(() => {
        const handleTaskUpdate = () => {
            fetchTasks();
            soundNotification.play('newTask');
        };
        const handleTaskClaimed = () => {
            fetchTasks();
            soundNotification.play('taskClaimed');
        };
        const handleTaskDeleted = () => {
            fetchTasks();
        };

        socket.on('task_status_changed', handleTaskUpdate);
        socket.on('new_task_added', handleTaskUpdate);
        socket.on('task_claimed', handleTaskClaimed);
        socket.on('task_deleted', handleTaskDeleted);

        return () => {
            socket.off('task_status_changed', handleTaskUpdate);
            socket.off('new_task_added', handleTaskUpdate);
            socket.off('task_claimed', handleTaskClaimed);
            socket.off('task_deleted', handleTaskDeleted);
        };
    }, [fetchTasks]);

    const handleClaimTask = async (orderId) => {
        try {
            await apiClient.post(`/api/orders/${orderId}/claim`);
            toast.success('任務已成功認領');
            soundNotification.play('taskClaimed');
        } catch (error) {
            toast.error('認領失敗', { description: error.response?.data?.message });
            soundNotification.play('error');
        }
    };

    const handleDeleteTask = async (orderId, voucherNumber) => {
        const result = await MySwal.fire({
            title: `確定要刪除訂單 ${voucherNumber} 嗎？`,
            text: "此操作無法復原！",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EF4444',
            cancelButtonColor: '#6B7280',
            confirmButtonText: '確認刪除',
            cancelButtonText: '取消'
        });

        if (result.isConfirmed) {
            const promise = apiClient.delete(`/api/orders/${orderId}`);
            toast.promise(promise, {
                loading: '正在刪除訂單...',
                success: (res) => res.data.message,
                error: (err) => err.response?.data?.message || '刪除失敗'
            });
        }
    };

    // 批次操作
    const toggleBatchMode = () => {
        setBatchMode(!batchMode);
        setSelectedTasks(new Set());
    };

    const toggleSelectTask = (taskId) => {
        const newSelected = new Set(selectedTasks);
        if (newSelected.has(taskId)) {
            newSelected.delete(taskId);
        } else {
            newSelected.add(taskId);
        }
        setSelectedTasks(newSelected);
    };

    const selectAll = () => {
        const allTaskIds = new Set(tasks.map(t => t.id));
        setSelectedTasks(allTaskIds);
    };

    const deselectAll = () => {
        setSelectedTasks(new Set());
    };

    const handleBatchClaim = async () => {
        if (selectedTasks.size === 0) {
            toast.error('請先選擇要認領的任務');
            return;
        }

        const promise = apiClient.post('/api/orders/batch/claim', {
            orderIds: Array.from(selectedTasks)
        });

        toast.promise(promise, {
            loading: '批次認領中...',
            success: (res) => {
                setSelectedTasks(new Set());
                setBatchMode(false);
                soundNotification.play('taskClaimed');
                return res.data.message;
            },
            error: (err) => {
                soundNotification.play('error');
                return err.response?.data?.message || '批次認領失敗';
            }
        });
    };

    const handleBatchDelete = async () => {
        if (selectedTasks.size === 0) {
            toast.error('請先選擇要刪除的任務');
            return;
        }

        const result = await MySwal.fire({
            title: `確定要刪除 ${selectedTasks.size} 筆訂單嗎？`,
            text: "此操作無法復原！",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EF4444',
            cancelButtonColor: '#6B7280',
            confirmButtonText: '確認刪除',
            cancelButtonText: '取消'
        });

        if (result.isConfirmed) {
            const promise = apiClient.post('/api/orders/batch/delete', {
                orderIds: Array.from(selectedTasks)
            });

            toast.promise(promise, {
                loading: '批次刪除中...',
                success: (res) => {
                    setSelectedTasks(new Set());
                    setBatchMode(false);
                    return res.data.message;
                },
                error: (err) => err.response?.data?.message || '批次刪除失敗'
            });
        }
    };

    const stats = {
        pending: tasks.filter(t => t.status === 'pending').length,
        picking: tasks.filter(t => t.status === 'picking').length,
        packing: tasks.filter(t => t.status === 'packing').length,
        myTasks: tasks.filter(t => 
            (t.status === 'picking' && t.picker_id === user.id) ||
            (t.status === 'packing' && t.packer_id === user.id)
        ).length
    };

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-screen bg-gradient-to-br from-gray-50 to-blue-50">
                <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
                <p className="text-gray-600 font-medium">載入任務列表中...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50/30 p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 animate-fade-in">
                    <div>
                        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                            我的任務
                        </h1>
                        <p className="text-gray-600">
                            歡迎回來, <span className="font-semibold text-gray-800">{user.name || user.username}</span>
                        </p>
                    </div>
                    
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={toggleSound}
                            className={`btn-apple flex items-center gap-2 shadow-apple-lg ${
                                soundEnabled 
                                    ? 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white'
                                    : 'bg-gradient-to-r from-gray-400 to-gray-500 hover:from-gray-500 hover:to-gray-600 text-white'
                            }`}
                        >
                            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                            <span className="hidden sm:inline">
                                {soundEnabled ? '音效開啟' : '音效關閉'}
                            </span>
                        </button>

                        <button
                            onClick={toggleBatchMode}
                            className={`btn-apple flex items-center gap-2 shadow-apple-lg ${
                                batchMode 
                                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                                    : 'bg-gradient-to-r from-gray-200 to-gray-300 text-gray-700 hover:from-gray-300 hover:to-gray-400'
                            }`}
                        >
                            <CheckSquare size={20} />
                            <span className="hidden sm:inline">批次模式</span>
                        </button>

                        {user && (user.role === 'admin' || user.role === 'superadmin') && (
                            <>
                                <Link 
                                    to="/admin/analytics" 
                                    className="btn-apple bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white flex items-center gap-2 shadow-apple-lg"
                                >
                                    <BarChart3 size={20} />
                                    <span className="hidden sm:inline">數據分析</span>
                                </Link>
                                <Link 
                                    to="/admin" 
                                    className="btn-apple bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-900 hover:to-black text-white flex items-center gap-2 shadow-apple-lg"
                                >
                                    <LayoutDashboard size={20} />
                                    <span className="hidden sm:inline">管理中心</span>
                                </Link>
                            </>
                        )}
                    </div>
                </div>

                {/* Batch Actions Bar */}
                {batchMode && (
                    <div className="glass card-apple p-4 mb-6 animate-slide-up">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <span className="text-gray-700 font-medium">
                                    已選擇 <span className="text-blue-600 font-bold">{selectedTasks.size}</span> 筆任務
                                </span>
                                <button
                                    onClick={selectAll}
                                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                                >
                                    全選
                                </button>
                                <button
                                    onClick={deselectAll}
                                    className="text-sm text-gray-600 hover:text-gray-700 font-medium"
                                >
                                    取消全選
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleBatchClaim}
                                    disabled={selectedTasks.size === 0}
                                    className="btn-apple bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white flex items-center gap-2 shadow-apple-lg disabled:opacity-50"
                                >
                                    <HandMetal size={18} />
                                    批次認領
                                </button>
                                {(user.role === 'admin' || user.role === 'superadmin') && (
                                    <button
                                        onClick={handleBatchDelete}
                                        disabled={selectedTasks.size === 0}
                                        className="btn-apple bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white flex items-center gap-2 shadow-apple-lg disabled:opacity-50"
                                    >
                                        <Trash size={18} />
                                        批次刪除
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="glass card-apple p-5 animate-scale-in">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600 font-medium">待揀貨</p>
                            <Clock className="text-amber-500" size={20} />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{stats.pending}</p>
                    </div>
                    <div className="glass card-apple p-5 animate-scale-in" style={{ animationDelay: '100ms' }}>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600 font-medium">揀貨中</p>
                            <Package className="text-blue-500" size={20} />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{stats.picking}</p>
                    </div>
                    <div className="glass card-apple p-5 animate-scale-in" style={{ animationDelay: '200ms' }}>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-600 font-medium">裝箱中</p>
                            <Box className="text-green-500" size={20} />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{stats.packing}</p>
                    </div>
                    <div className="glass card-apple p-5 bg-gradient-to-br from-green-50 to-emerald-50 border-green-200 animate-scale-in" style={{ animationDelay: '300ms' }}>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-green-700 font-medium">我的任務</p>
                            <User className="text-green-600" size={20} />
                        </div>
                        <p className="text-3xl font-bold text-green-900">{stats.myTasks}</p>
                    </div>
                </div>

                {/* Task Grid */}
                {tasks.length === 0 ? (
                    <div className="glass card-apple p-12 text-center animate-fade-in">
                        <ServerOff className="mx-auto text-gray-400 mb-4" size={64} />
                        <p className="text-gray-600 text-lg">目前沒有待處理的任務</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {tasks.map((task, index) => {
                            const isMyTask = (task.status === 'picking' && task.picker_id === user.id) ||
                                           (task.status === 'packing' && task.packer_id === user.id);
                            return (
                                <div key={task.id} className="animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                                    <TaskCard
                                        task={task}
                                        user={user}
                                        onClaim={handleClaimTask}
                                        onDelete={handleDeleteTask}
                                        isMyTask={isMyTask}
                                        isSelected={selectedTasks.has(task.id)}
                                        onToggleSelect={toggleSelectTask}
                                        batchMode={batchMode}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
