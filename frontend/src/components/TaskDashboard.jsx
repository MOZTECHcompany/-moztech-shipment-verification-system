// frontend/src/components/TaskDashboard-modern.jsx
// 現代化 Apple 風格任務儀表板

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { Package, Box, User, Loader2, ServerOff, LayoutDashboard, Trash2, Volume2, VolumeX, ArrowRight, Clock, CheckCircle2, ListChecks, MessageSquare, Bell } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { soundNotification } from '@/utils/soundNotification.js';
import { voiceNotification } from '@/utils/voiceNotification.js';
import { desktopNotification } from '@/utils/desktopNotification.js';

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
        dot: 'bg-blue-500 animate-pulse'
    },
    picked: { 
        text: '待裝箱', 
        color: 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-700 border border-indigo-200',
        icon: Box,
        dot: 'bg-indigo-500'
    },
    packing: { 
        text: '裝箱中', 
        color: 'bg-gradient-to-r from-cyan-50 to-teal-50 text-cyan-700 border border-cyan-200',
        icon: Box,
        dot: 'bg-cyan-500 animate-pulse'
    },
};

// 現代化任務卡片
const ModernTaskCard = ({ task, onClaim, user, onDelete, batchMode, selectedTasks, toggleTaskSelection }) => {
    const isMyTask = task.current_user;
    const statusInfo = statusConfig[task.status] || { 
        text: task.status, 
        color: 'bg-gray-100 text-gray-700',
        icon: Package,
        dot: 'bg-gray-500'
    };
    const StatusIcon = statusInfo.icon;

    return (
        <div className={`
            group relative overflow-hidden
            bg-white rounded-2xl 
            transition-all duration-300 ease-out
            hover:shadow-apple-lg hover:-translate-y-1
            ${isMyTask 
                ? 'ring-2 ring-green-500 shadow-apple-lg' 
                : 'shadow-apple-sm border border-gray-100'
            }
            ${selectedTasks.includes(task.id) ? 'ring-2 ring-blue-500' : ''}
            animate-scale-in
        `}>
            {/* 背景漸變裝飾 */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-50 to-purple-50 rounded-full blur-3xl opacity-30 -z-10" />
            
            <div className="p-6">
                {/* 標題列 */}
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        {batchMode && (
                            <input
                                type="checkbox"
                                checked={selectedTasks.includes(task.id)}
                                onChange={() => toggleTaskSelection(task.id)}
                                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                            />
                        )}
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-xl text-gray-900 truncate mb-1">
                                {task.voucher_number}
                            </h3>
                            <div className="flex items-center text-sm text-gray-500">
                                <User size={14} className="mr-1.5 flex-shrink-0" />
                                <span className="truncate">{task.customer_name}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                        {/* 狀態標籤 */}
                        <div className={`
                            px-3 py-1.5 rounded-xl text-xs font-semibold
                            flex items-center gap-1.5
                            ${statusInfo.color}
                        `}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                            <StatusIcon size={12} />
                            {statusInfo.text}
                        </div>
                        
                        {/* 刪除按鈕（僅管理員） */}
                        {user && user.role === 'admin' && (
                            <button
                                onClick={() => onDelete(task.id, task.voucher_number)}
                                className="
                                    p-2 text-red-500 hover:bg-red-50 rounded-xl 
                                    transition-all duration-200
                                    opacity-0 group-hover:opacity-100
                                "
                                title="永久刪除此訂單"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                </div>

                {/* 額外資訊 */}
                {task.task_type === 'pack' && task.picker_name && (
                    <div className="mb-4 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                        <p className="text-xs text-blue-700">
                            <CheckCircle2 size={12} className="inline mr-1" />
                            由 <span className="font-semibold">{task.picker_name}</span> 完成揀貨
                        </p>
                    </div>
                )}

                {/* 操作按鈕 */}
                {isMyTask ? (
                    <button
                        onClick={() => onClaim(task.id, true)}
                        className="
                            w-full px-4 py-3 
                            bg-gradient-to-r from-green-500 to-emerald-600
                            text-white font-semibold rounded-xl
                            hover:from-green-600 hover:to-emerald-700
                            active:scale-[0.98]
                            transition-all duration-200
                            shadow-lg shadow-green-500/30
                            flex items-center justify-center gap-2
                        "
                    >
                        繼續作業
                        <ArrowRight size={18} />
                    </button>
                ) : (
                    <button
                        onClick={() => onClaim(task.id, false)}
                        className="
                            w-full px-4 py-3
                            bg-gradient-to-r from-blue-500 to-indigo-600
                            text-white font-semibold rounded-xl
                            hover:from-blue-600 hover:to-indigo-700
                            active:scale-[0.98]
                            transition-all duration-200
                            shadow-lg shadow-blue-500/30
                            flex items-center justify-center gap-2
                            group/btn
                        "
                    >
                        {task.task_type === 'pick' ? '開始揀貨' : '開始裝箱'}
                        <ArrowRight size={18} className="group-hover/btn:translate-x-1 transition-transform" />
                    </button>
                )}
            </div>
        </div>
    );
};

export function TaskDashboard({ user }) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [soundEnabled, setSoundEnabled] = useState(soundNotification.isEnabled());
    const [voiceEnabled, setVoiceEnabled] = useState(voiceNotification.isEnabled());
    const [notificationEnabled, setNotificationEnabled] = useState(desktopNotification.isEnabled());
    const [selectedTasks, setSelectedTasks] = useState([]);
    const [batchMode, setBatchMode] = useState(false);
    const navigate = useNavigate();
    const MySwal = withReactContent(Swal);

    const toggleSound = () => {
        const newState = !soundEnabled;
        soundNotification.setEnabled(newState);
        setSoundEnabled(newState);
        
        // 測試音效
        if (newState) {
            setTimeout(() => {
                soundNotification.play('success');
            }, 100);
        }
        
        toast.success(newState ? '🔊 音效通知已開啟' : '🔇 音效通知已關閉');
    };

    const toggleVoice = () => {
        const newState = !voiceEnabled;
        voiceNotification.setEnabled(newState);
        setVoiceEnabled(newState);
        
        // 測試語音
        if (newState) {
            setTimeout(() => {
                voiceNotification.speak('語音播報已開啟');
            }, 100);
        }
        
        toast.success(newState ? '🗣️ 語音播報已開啟' : '🔇 語音播報已關閉');
    };

    const toggleNotification = async () => {
        const newState = !notificationEnabled;
        const success = await desktopNotification.setEnabled(newState);
        
        if (success) {
            setNotificationEnabled(newState);
            
            // 測試通知
            if (newState) {
                desktopNotification.notifySystemMessage('通知已開啟', '您將收到新任務的桌面通知');
            }
            
            toast.success(newState ? '🔔 桌面通知已開啟' : '🔕 桌面通知已關閉');
        } else {
            toast.error('無法開啟桌面通知，請檢查瀏覽器權限');
        }
    };

    const toggleBatchMode = () => {
        setBatchMode(!batchMode);
        setSelectedTasks([]);
        toast.info(batchMode ? '退出批次模式' : '進入批次模式');
    };

    const toggleTaskSelection = (taskId) => {
        setSelectedTasks(prev => 
            prev.includes(taskId) 
                ? prev.filter(id => id !== taskId)
                : [...prev, taskId]
        );
    };

    const handleBatchClaim = async () => {
        if (selectedTasks.length === 0) {
            toast.error('請至少選擇一個任務');
            return;
        }

        try {
            const response = await apiClient.post('/api/orders/batch-claim', {
                orderIds: selectedTasks
            });
            toast.success(response.data.message);
            setSelectedTasks([]);
            setBatchMode(false);
            fetchTasks();
        } catch (error) {
            toast.error('批次認領失敗', { 
                description: error.response?.data?.message 
            });
        }
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
        const handleNewTask = (newTask) => {
            toast.info(`📦 收到新任務: ${newTask.voucher_number}`);
            soundNotification.play('newTask');
            voiceNotification.speakNewTask(1);
            desktopNotification.notifyNewTask(newTask);
            setTasks(currentTasks => 
                currentTasks.some(task => task.id === newTask.id) ? currentTasks : [...currentTasks, newTask]
            );
        };
        
        const handleTaskUpdate = (updatedTask) => {
             setTasks(currentTasks => {
                const index = currentTasks.findIndex(t => t.id === updatedTask.id);
                if (index === -1) {
                    if ((user.role === 'picker' || user.role === 'admin') && updatedTask.task_type === 'pick') return [...currentTasks, updatedTask];
                    if ((user.role === 'packer' || user.role === 'admin') && updatedTask.task_type === 'pack') return [...currentTasks, updatedTask];
                    return currentTasks;
                }
                
                if (
                    (updatedTask.status === 'picked' && user.role === 'picker') ||
                    (updatedTask.status === 'completed') || 
                    (updatedTask.status === 'voided')
                ) {
                    if (updatedTask.status === 'completed') {
                        soundNotification.play('taskCompleted');
                    }
                    return currentTasks.filter(t => t.id !== updatedTask.id);
                }
                
                const newTasks = [...currentTasks];
                newTasks[index] = updatedTask;
                return newTasks;
            });
        };

        const handleTaskDeleted = ({ orderId }) => {
            toast.warning('⚠️ 訂單已被管理員刪除');
            soundNotification.play('error');
            setTasks(prevTasks => prevTasks.filter(task => task.id !== orderId));
        };

        socket.on('new_task', handleNewTask);
        socket.on('task_claimed', handleTaskUpdate);
        socket.on('task_status_changed', handleTaskUpdate);
        socket.on('task_deleted', handleTaskDeleted);
        
        return () => {
            socket.off('new_task', handleNewTask);
            socket.off('task_claimed', handleTaskUpdate);
            socket.off('task_status_changed', handleTaskUpdate);
            socket.off('task_deleted', handleTaskDeleted);
        };
    }, [user]);

    const handleClaimTask = async (orderId, isContinue) => {
        if (isContinue) {
            navigate(`/order/${orderId}`);
            return;
        }
        const promise = apiClient.post(`/api/orders/${orderId}/claim`);
        toast.promise(promise, {
            loading: '正在認領任務...',
            success: () => {
                soundNotification.play('taskClaimed');
                return '✅ 任務認領成功！';
            },
            error: (err) => {
                soundNotification.play('error');
                return err.response?.data?.message || '認領失敗';
            },
        });
    };

    const handleDeleteOrder = (orderId, voucherNumber) => {
        MySwal.fire({
            title: `確定要永久刪除訂單？`,
            html: `<p class="text-gray-600">訂單號: <strong>${voucherNumber}</strong></p>
                   <p class="text-sm text-red-600 mt-2">此操作將會刪除所有相關資料，且無法復原！</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#FF3B30',
            cancelButtonColor: '#8E8E93',
            confirmButtonText: '確認刪除',
            cancelButtonText: '取消',
            customClass: {
                popup: 'rounded-2xl',
                title: 'text-xl font-semibold',
                confirmButton: 'rounded-xl px-6 py-2.5',
                cancelButton: 'rounded-xl px-6 py-2.5'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                const promise = apiClient.delete(`/api/orders/${orderId}`);
                toast.promise(promise, {
                    loading: `正在刪除訂單 ${voucherNumber}...`,
                    success: (res) => {
                        setTasks(prevTasks => prevTasks.filter(task => task.id !== orderId));
                        return res.data.message;
                    },
                    error: (err) => err.response?.data?.message || '刪除失敗'
                });
            }
        });
    };

    const pickTasks = tasks.filter(t => t.task_type === 'pick');
    const packTasks = tasks.filter(t => t.task_type === 'pack');

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
                <div className="text-center">
                    <Loader2 className="animate-spin text-blue-500 mx-auto mb-4" size={56} />
                    <p className="text-gray-500 font-medium">載入中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50/50 via-white to-purple-50/50">
            <div className="p-6 md:p-8 lg:p-12 max-w-7xl mx-auto">
                {/* 現代化標題列 */}
                <header className="mb-10 animate-fade-in">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h1 className="text-5xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-700 bg-clip-text text-transparent mb-2">
                                我的任務
                            </h1>
                            <p className="text-gray-500 text-lg">選擇一項任務以開始作業</p>
                        </div>
                        
                        {/* 操作按鈕組 */}
                        <div className="flex items-center gap-3">
                            {/* 批次模式開關 */}
                            <button
                                onClick={toggleBatchMode}
                                className={`
                                    flex items-center gap-2 px-5 py-3 rounded-xl font-medium
                                    transition-all duration-200 shadow-apple-sm hover:shadow-apple
                                    active:scale-[0.98]
                                    ${batchMode 
                                        ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-blue-500/30' 
                                        : 'bg-white text-gray-700 border border-gray-200'
                                    }
                                `}
                                title={batchMode ? '退出批次模式' : '進入批次模式'}
                            >
                                <ListChecks size={20} />
                                <span className="hidden sm:inline">
                                    {batchMode ? '批次模式' : '批次操作'}
                                </span>
                            </button>

                            {/* 批次認領按鈕 */}
                            {batchMode && selectedTasks.length > 0 && (
                                <button
                                    onClick={handleBatchClaim}
                                    className="
                                        flex items-center gap-2 px-5 py-3 rounded-xl font-medium
                                        bg-gradient-to-r from-green-500 to-emerald-600 text-white
                                        hover:from-green-600 hover:to-emerald-700
                                        transition-all duration-200 shadow-apple-sm hover:shadow-apple
                                        shadow-green-500/30
                                        active:scale-[0.98]
                                        animate-scale-in
                                    "
                                >
                                    <CheckCircle2 size={20} />
                                    <span>認領 {selectedTasks.length} 個任務</span>
                                </button>
                            )}

                            {/* 音效開關 */}
                            <button
                                onClick={toggleSound}
                                className={`
                                    flex items-center gap-2 px-5 py-3 rounded-xl font-medium
                                    transition-all duration-200 shadow-apple-sm hover:shadow-apple
                                    active:scale-[0.98]
                                    ${soundEnabled 
                                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-green-500/30' 
                                        : 'bg-white text-gray-700 border border-gray-200'
                                    }
                                `}
                                title={soundEnabled ? '點擊關閉音效' : '點擊開啟音效'}
                            >
                                {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                                <span className="hidden sm:inline">
                                    {soundEnabled ? '音效開啟' : '音效關閉'}
                                </span>
                            </button>

                            {/* 語音播報開關 */}
                            <button
                                onClick={toggleVoice}
                                className={`
                                    flex items-center gap-2 px-5 py-3 rounded-xl font-medium
                                    transition-all duration-200 shadow-apple-sm hover:shadow-apple
                                    active:scale-[0.98]
                                    ${voiceEnabled 
                                        ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-blue-500/30' 
                                        : 'bg-white text-gray-700 border border-gray-200'
                                    }
                                `}
                                title={voiceEnabled ? '點擊關閉語音' : '點擊開啟語音'}
                            >
                                <MessageSquare size={20} />
                                <span className="hidden sm:inline">
                                    {voiceEnabled ? '語音開啟' : '語音關閉'}
                                </span>
                            </button>

                            {/* 桌面通知開關 */}
                            <button
                                onClick={toggleNotification}
                                className={`
                                    flex items-center gap-2 px-5 py-3 rounded-xl font-medium
                                    transition-all duration-200 shadow-apple-sm hover:shadow-apple
                                    active:scale-[0.98]
                                    ${notificationEnabled 
                                        ? 'bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-purple-500/30' 
                                        : 'bg-white text-gray-700 border border-gray-200'
                                    }
                                `}
                                title={notificationEnabled ? '點擊關閉通知' : '點擊開啟通知'}
                            >
                                <Bell size={20} />
                                <span className="hidden sm:inline">
                                    {notificationEnabled ? '通知開啟' : '通知關閉'}
                                </span>
                            </button>
                            
                            {/* 管理中心 */}
                            {user && user.role === 'admin' && (
                                <Link 
                                    to="/admin" 
                                    className="
                                        flex items-center gap-2 px-5 py-3 rounded-xl font-medium
                                        bg-gradient-to-r from-gray-800 to-gray-900 text-white
                                        hover:from-gray-900 hover:to-black
                                        transition-all duration-200 shadow-apple-sm hover:shadow-apple
                                        active:scale-[0.98]
                                    "
                                >
                                    <LayoutDashboard size={20} />
                                    <span className="hidden sm:inline">管理中心</span>
                                </Link>
                            )}
                        </div>
                    </div>

                    {/* 統計卡片 */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <div className="glass rounded-2xl p-4 border border-white/20">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">待揀貨</p>
                                    <p className="text-3xl font-bold text-gray-900">{pickTasks.length}</p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                                    <Package className="text-amber-600" size={24} />
                                </div>
                            </div>
                        </div>
                        <div className="glass rounded-2xl p-4 border border-white/20">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">待裝箱</p>
                                    <p className="text-3xl font-bold text-gray-900">{packTasks.length}</p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                                    <Box className="text-indigo-600" size={24} />
                                </div>
                            </div>
                        </div>
                        <div className="glass rounded-2xl p-4 border border-white/20">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">總任務</p>
                                    <p className="text-3xl font-bold text-gray-900">{tasks.length}</p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                                    <LayoutDashboard className="text-blue-600" size={24} />
                                </div>
                            </div>
                        </div>
                        <div className="glass rounded-2xl p-4 border border-white/20">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-600 mb-1">我的任務</p>
                                    <p className="text-3xl font-bold text-green-600">
                                        {tasks.filter(t => t.current_user).length}
                                    </p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                                    <User className="text-green-600" size={24} />
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                {/* 任務列表 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* 揀貨任務 */}
                    <section className="animate-slide-up">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                                <Package className="text-amber-600" size={20} />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900">
                                待揀貨任務
                            </h2>
                            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-semibold">
                                {pickTasks.length}
                            </span>
                        </div>
                        <div className="space-y-4">
                            {pickTasks.length > 0 ? (
                                pickTasks.map((task, index) => (
                                    <div 
                                        key={task.id} 
                                        style={{ animationDelay: `${index * 50}ms` }}
                                        className="animate-fade-in"
                                    >
                                        <ModernTaskCard 
                                            task={task} 
                                            onClaim={handleClaimTask} 
                                            user={user} 
                                            onDelete={handleDeleteOrder}
                                            batchMode={batchMode}
                                            selectedTasks={selectedTasks}
                                            toggleTaskSelection={toggleTaskSelection}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-16 glass rounded-2xl border-2 border-dashed border-gray-200">
                                    <Package className="mx-auto mb-4 text-gray-300" size={56} />
                                    <p className="text-gray-400 text-lg">目前沒有待處理的揀貨任務</p>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 裝箱任務 */}
                    <section className="animate-slide-up" style={{ animationDelay: '100ms' }}>
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                                <Box className="text-indigo-600" size={20} />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900">
                                待裝箱任務
                            </h2>
                            <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold">
                                {packTasks.length}
                            </span>
                        </div>
                        <div className="space-y-4">
                            {packTasks.length > 0 ? (
                                packTasks.map((task, index) => (
                                    <div 
                                        key={task.id} 
                                        style={{ animationDelay: `${index * 50}ms` }}
                                        className="animate-fade-in"
                                    >
                                        <ModernTaskCard 
                                            task={task} 
                                            onClaim={handleClaimTask} 
                                            user={user} 
                                            onDelete={handleDeleteOrder}
                                            batchMode={batchMode}
                                            selectedTasks={selectedTasks}
                                            toggleTaskSelection={toggleTaskSelection}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-16 glass rounded-2xl border-2 border-dashed border-gray-200">
                                    <Box className="mx-auto mb-4 text-gray-300" size={56} />
                                    <p className="text-gray-400 text-lg">目前沒有待處理的裝箱任務</p>
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* 全部完成狀態 */}
                {tasks.length === 0 && !loading && (
                    <div className="text-center py-24 animate-fade-in">
                        <div className="glass rounded-3xl p-12 max-w-md mx-auto">
                            <CheckCircle2 size={80} className="mx-auto mb-6 text-green-500" />
                            <h3 className="text-3xl font-bold text-gray-900 mb-2">太棒了！</h3>
                            <p className="text-gray-500 text-lg">所有任務都已完成</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
