// frontend/src/components/TaskDashboard-modern.jsx
// 現代化 Apple 風格任務儀表板

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { Package, Box, User, Loader2, ServerOff, LayoutDashboard, Trash2, Volume2, VolumeX, ArrowRight, Clock, CheckCircle2, ListChecks, MessageSquare, Bell, Flame, AlertTriangle } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { soundNotification } from '@/utils/soundNotification.js';
import { voiceNotification } from '@/utils/voiceNotification.js';
import { desktopNotification } from '@/utils/desktopNotification.js';
import FloatingChatPanel from './FloatingChatPanel';
import NotificationCenter from './NotificationCenter';
import { PageHeader, FilterBar, Button } from '@/ui';

const statusConfig = {
    pending: { 
        text: '待揀貨', 
        color: 'bg-gradient-to-r from-amber-50/80 to-yellow-50/80 text-amber-700 border border-amber-200/50',
        icon: Clock,
        dot: 'bg-amber-500/80'
    },
    picking: { 
        text: '揀貨中', 
        color: 'bg-gradient-to-r from-apple-blue/10 to-cyan-50/80 text-apple-blue border border-apple-blue/30',
        icon: Package,
        dot: 'bg-apple-blue animate-pulse'
    },
    picked: { 
        text: '待裝箱', 
        color: 'bg-gradient-to-r from-apple-purple/10 to-purple-50/80 text-apple-purple border border-apple-purple/30',
        icon: Box,
        dot: 'bg-apple-purple'
    },
    packing: { 
        text: '裝箱中', 
        color: 'bg-gradient-to-r from-apple-green/10 to-teal-50/80 text-apple-green border border-apple-green/30',
        icon: Box,
        dot: 'bg-apple-green animate-pulse'
    },
};

// 現代化任務卡片
const ModernTaskCard = ({ task, onClaim, user, onDelete, batchMode, selectedTasks, toggleTaskSelection, onOpenChat }) => {
    const isMyTask = task.current_user;
    const isUrgent = task.is_urgent || false;
    const hasComments = task.total_comments > 0;
    const hasUnread = task.unread_comments > 0;
    const hasUrgentComments = task.urgent_comments > 0;
    const latestComment = task.latest_comment;
    
    const statusInfo = statusConfig[task.status] || { 
        text: task.status, 
        color: 'bg-gray-100 text-gray-700',
        icon: Package,
        dot: 'bg-gray-500'
    };
    const StatusIcon = statusInfo.icon;

    const handleSetUrgent = async (e) => {
        e.stopPropagation();
        try {
            await apiClient.patch(`/api/orders/${task.id}/urgent`, {
                isUrgent: !isUrgent
            });
            toast.success(isUrgent ? '已取消緊急標記' : '已標記為緊急任務');
        } catch (error) {
            toast.error('操作失敗', { 
                description: error.response?.data?.message 
            });
        }
    };

    const handleOpenChat = (e) => {
        e.stopPropagation();
        onOpenChat(task.id, task.voucher_number);
    };

    return (
        <div className={`
            group relative overflow-hidden
            bg-white/90 dark:bg-card backdrop-blur-sm rounded-xl sm:rounded-2xl 
            transition-all duration-500 ease-out
            hover:shadow-2xl hover:-translate-y-2 hover:scale-[1.01]
            ${isMyTask 
                ? 'ring-1 ring-green-400/80 shadow-xl shadow-green-200/40 border-l-4 border-l-green-400' 
                : isUrgent
                ? 'ring-1 ring-red-400/80 shadow-xl shadow-red-200/40 border-l-4 border-l-red-400'
                : 'shadow-lg border border-gray-100 hover:border-blue-200'
            }
            ${selectedTasks.includes(task.id) ? 'ring-2 ring-blue-500 scale-[0.99]' : ''}
            animate-scale-in
        `}>
            {/* 背景裝飾元素 */}
            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700"></div>
            
            {/* 緊急任務頂部標記 */}
            {isUrgent && (
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-500 via-orange-500 to-red-500 animate-pulse">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer"></div>
                </div>
            )}

            
            <div className="relative z-10 p-4 sm:p-5 md:p-6">
                {/* 標題列 - 優化 */}
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        {batchMode && (
                            <input
                                type="checkbox"
                                checked={selectedTasks.includes(task.id)}
                                onChange={() => toggleTaskSelection(task.id)}
                                className="w-5 h-5 sm:w-6 sm:h-6 rounded-lg border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer transition-all flex-shrink-0"
                            />
                        )}
                        <div className="flex-1 min-w-0">
                            <h3 className="font-black text-lg sm:text-xl text-gray-900 truncate mb-1.5 group-hover:text-blue-600 transition-colors">
                                {task.voucher_number}
                            </h3>
                            <div className="flex items-center text-xs sm:text-sm text-gray-500">
                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-lg">
                                    <User size={12} className="flex-shrink-0 sm:w-3.5 sm:h-3.5" />
                                    <span className="truncate font-medium">{task.customer_name}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-2 ml-2 sm:ml-3 flex-shrink-0">
                        {/* 緊急標記 - 優化 */}
                        {isUrgent && (
                            <div className="relative group/badge">
                                <div className="absolute inset-0 bg-gradient-to-r from-red-500 to-orange-500 rounded-xl blur-md opacity-60 animate-pulse"></div>
                                <div className="relative px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-black
                                    bg-gradient-to-r from-red-500 via-orange-500 to-red-500 text-white
                                    flex items-center gap-1.5 shadow-lg">
                                    <Flame size={14} className="sm:w-4 sm:h-4 animate-bounce" />
                                    <span className="hidden xs:inline">緊急</span>
                                </div>
                            </div>
                        )}
                        
                        {/* 狀態標籤 - 優化 */}
                        <div className={`
                            relative px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold
                            flex items-center gap-1.5 shadow-md
                            ${statusInfo.color}
                            group-hover:scale-105 transition-transform
                        `}>
                            <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${statusInfo.dot}`} />
                            <StatusIcon size={12} className="sm:w-3.5 sm:h-3.5" />
                            <span className="hidden xs:inline">{statusInfo.text}</span>
                        </div>
                        
                        {/* 管理員按鈕組 */}
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            {user && user.role === 'admin' && (
                                <>
                                    <button
                                        onClick={handleSetUrgent}
                                        className={`
                                            p-2 rounded-lg transition-all duration-200
                                            ${isUrgent 
                                                ? 'text-orange-600 bg-orange-100 hover:bg-orange-200' 
                                                : 'text-gray-400 hover:text-orange-500 hover:bg-orange-50'
                                            }
                                            hover:scale-110
                                        `}
                                        title={isUrgent ? '取消緊急標記' : '標記為緊急'}
                                    >
                                        <AlertTriangle size={16} className="sm:w-[18px] sm:h-[18px]" />
                                    </button>
                                    
                                    <button
                                        onClick={() => onDelete(task.id, task.voucher_number)}
                                        className="
                                            p-2 text-red-500 hover:bg-red-50 rounded-lg 
                                            transition-all duration-200
                                            hover:scale-110 hover:rotate-12
                                        "
                                        title="永久刪除此訂單"
                                    >
                                        <Trash2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* 額外資訊 - 優化 */}
                {task.task_type === 'pack' && task.picker_name && (
                    <div className="mb-3 sm:mb-4 px-3 sm:px-4 py-2.5 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl border border-blue-200/50 shadow-sm">
                        <p className="text-xs sm:text-sm text-blue-700 font-medium flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-blue-600 flex-shrink-0" />
                            由 <span className="font-bold">{task.picker_name}</span> 完成揀貨
                        </p>
                    </div>
                )}

                {/* 評論預覽區域 - 全新設計 */}
                {hasComments && (
                    <div className="mb-4">
                        <button
                            onClick={handleOpenChat}
                            className="w-full group/comment relative px-3 sm:px-4 py-3 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 hover:from-blue-100 hover:via-indigo-100 hover:to-purple-100 border-2 border-blue-200/50 hover:border-blue-400/50 rounded-xl sm:rounded-2xl transition-all duration-300 overflow-hidden shadow-md hover:shadow-xl"
                        >
                            {/* 閃光效果 */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover/comment:translate-x-full transition-transform duration-1000"></div>
                            
                            <div className="relative flex items-start gap-2 sm:gap-3">
                                <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg group-hover/comment:scale-110 transition-transform">
                                    <MessageSquare size={16} className="text-white sm:w-5 sm:h-5" />
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                    {latestComment && (
                                        <p className="text-xs sm:text-sm text-gray-700 truncate mb-2 font-medium">
                                            <span className="font-bold text-blue-700">{latestComment.user_name}:</span> {latestComment.content}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                        {hasUnread && (
                                            <span className="relative inline-flex items-center bg-red-500 text-white px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-black shadow-lg">
                                                <span className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-75"></span>
                                                <span className="relative">{task.unread_comments} 未讀</span>
                                            </span>
                                        )}
                                        {hasUrgentComments && (
                                            <span className="bg-gradient-to-r from-red-500 to-orange-500 text-white px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-black flex items-center gap-1 shadow-lg">
                                                <AlertTriangle size={10} className="animate-pulse" />
                                                {task.urgent_comments} 緊急
                                            </span>
                                        )}
                                        <span className="text-gray-500 text-[10px] sm:text-xs font-semibold flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                                            {task.total_comments} 則對話
                                        </span>
                                    </div>
                                </div>
                                <ArrowRight size={16} className="text-blue-600 flex-shrink-0 opacity-0 group-hover/comment:opacity-100 group-hover/comment:translate-x-1 transition-all sm:w-5 sm:h-5" />
                            </div>
                        </button>
                    </div>
                )}

                {/* 操作按鈕 - 全新設計 */}
                {isMyTask ? (
                    <button
                        onClick={() => onClaim(task.id, true)}
                        className="
                            group/btn relative w-full px-4 py-3.5 sm:py-4
                            bg-gradient-to-r from-green-500 via-emerald-500 to-green-600
                            text-white text-sm sm:text-base font-black rounded-xl sm:rounded-2xl
                            hover:from-green-600 hover:via-emerald-600 hover:to-green-700
                            active:scale-[0.97]
                            transition-all duration-300
                            shadow-2xl shadow-green-500/50 hover:shadow-green-500/60
                            flex items-center justify-center gap-2
                            overflow-hidden
                        "
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/25 to-white/0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700"></div>
                        <span className="relative z-10">繼續作業</span>
                        <ArrowRight size={18} className="relative z-10 group-hover/btn:translate-x-1 transition-transform sm:w-5 sm:h-5" />
                    </button>
                ) : (
                    <button
                        onClick={() => onClaim(task.id, false)}
                        className="
                            group/btn relative w-full px-4 py-3.5 sm:py-4
                            bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600
                            text-white text-sm sm:text-base font-black rounded-xl sm:rounded-2xl
                            hover:from-blue-600 hover:via-indigo-600 hover:to-purple-700
                            active:scale-[0.97]
                            transition-all duration-300
                            shadow-2xl shadow-blue-500/50 hover:shadow-indigo-500/60
                            flex items-center justify-center gap-2
                            overflow-hidden
                        "
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/25 to-white/0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700"></div>
                        <span className="relative z-10">{task.task_type === 'pick' ? '開始揀貨' : '開始裝箱'}</span>
                        <ArrowRight size={18} className="relative z-10 group-hover/btn:translate-x-2 transition-transform sm:w-5 sm:h-5" />
                    </button>
                )}
            </div>
        </div>
    );
};

export function TaskDashboard({ user }) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentView, setCurrentView] = useState('tasks'); // 'tasks' 或 'my-tasks'
    const [soundEnabled, setSoundEnabled] = useState(soundNotification.isEnabled());
    const [voiceEnabled, setVoiceEnabled] = useState(voiceNotification.isEnabled());
    const [notificationEnabled, setNotificationEnabled] = useState(desktopNotification.isEnabled());
    const [selectedTasks, setSelectedTasks] = useState([]);
    const [batchMode, setBatchMode] = useState(false);
    const [search, setSearch] = useState('');
    
    // 浮動聊天面板狀態
    const [openChats, setOpenChats] = useState([]);
    
    const navigate = useNavigate();
    const MySwal = withReactContent(Swal);

    // 打開聊天面板
    const handleOpenChat = (orderId, voucherNumber) => {
        // 檢查是否已經打開
        if (openChats.some(chat => chat.orderId === orderId)) {
            toast.info('該對話已經開啟');
            return;
        }
        
        // 最多同時打開3個
        if (openChats.length >= 3) {
            toast.warning('最多只能同時開啟 3 個對話窗');
            return;
        }
        
        setOpenChats(prev => [...prev, { orderId, voucherNumber }]);
    };

    // 關閉聊天面板
    const handleCloseChat = (orderId) => {
        setOpenChats(prev => prev.filter(chat => chat.orderId !== orderId));
    };

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

        const handleUrgentChanged = ({ orderId, isUrgent, voucherNumber }) => {
            setTasks(prevTasks => {
                const updatedTasks = prevTasks.map(task => 
                    task.id === orderId 
                        ? { ...task, is_urgent: isUrgent }
                        : task
                );
                // 重新排序：緊急任務優先
                return updatedTasks.sort((a, b) => {
                    if (a.is_urgent === b.is_urgent) return 0;
                    return a.is_urgent ? -1 : 1;
                });
            });
            
            if (isUrgent) {
                toast.warning(`🔥 ${voucherNumber} 已被標記為緊急任務！`, {
                    description: '請優先處理此訂單'
                });
                soundNotification.play('newTask');
            }
        };

        socket.on('new_task', handleNewTask);
        socket.on('task_claimed', handleTaskUpdate);
        socket.on('task_status_changed', handleTaskUpdate);
        socket.on('task_deleted', handleTaskDeleted);
        socket.on('task_urgent_changed', handleUrgentChanged);
        
        return () => {
            socket.off('new_task', handleNewTask);
            socket.off('task_claimed', handleTaskUpdate);
            socket.off('task_status_changed', handleTaskUpdate);
            socket.off('task_deleted', handleTaskDeleted);
            socket.off('task_urgent_changed', handleUrgentChanged);
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

    const normalizedSearch = search.trim().toLowerCase();
    const visibleTasks = useMemo(() => {
        if (!normalizedSearch) return tasks;
        return tasks.filter((t) => {
            const hay = `${t.voucher_number || ''} ${t.customer_name || ''}`.toLowerCase();
            return hay.includes(normalizedSearch);
        });
    }, [tasks, normalizedSearch]);

    const pickTasks = visibleTasks.filter(t => t.task_type === 'pick');
    const packTasks = visibleTasks.filter(t => t.task_type === 'pack');

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen bg-secondary">
                <div className="text-center">
                    <Loader2 className="animate-spin text-apple-blue mx-auto mb-4" size={56} />
                    <p className="text-gray-600 font-semibold text-lg">載入中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-secondary dark:bg-background/95">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
                {/* 頁面標題 + 動作 */}
                <PageHeader
                  title="📋 任務看板"
                  description={`${user?.name || user?.username}，您好`}
                  actions={(
                    <div className="flex items-center gap-2">
                      <NotificationCenter onOpenChat={handleOpenChat} />
                      {user && user.role === 'admin' && (
                        <Button variant={batchMode ? 'primary' : 'secondary'} size="sm" onClick={toggleBatchMode} leadingIcon={ListChecks}>
                          {batchMode ? '✓ 批次模式' : '批次操作'}
                        </Button>
                      )}
                      {batchMode && selectedTasks.length > 0 && (
                        <Button variant="primary" size="sm" onClick={handleBatchClaim} leadingIcon={CheckCircle2}>
                          認領 {selectedTasks.length} 個
                        </Button>
                      )}
                      <Button variant={soundEnabled ? 'primary' : 'secondary'} size="sm" onClick={toggleSound} leadingIcon={soundEnabled ? Volume2 : VolumeX}>
                        音效
                      </Button>
                      <Button variant={voiceEnabled ? 'primary' : 'secondary'} size="sm" onClick={toggleVoice} leadingIcon={MessageSquare}>
                        語音
                      </Button>
                      <Button variant={notificationEnabled ? 'primary' : 'secondary'} size="sm" onClick={toggleNotification} leadingIcon={Bell}>
                        通知
                      </Button>
                      {user && user.role === 'admin' && (
                        <Button as={Link} to="/admin" variant="secondary" size="sm" leadingIcon={LayoutDashboard}>
                          管理中心
                        </Button>
                      )}
                    </div>
                  )}
                />

                {/* 篩選／搜尋列 */}
                <FilterBar value={search} onChange={setSearch} placeholder="搜尋單號或客戶..." />

                {/* 統計卡片 */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                        {/* 待揀貨卡片 - 橙色（需要關注） */}
                        <div className="group relative bg-white/60 backdrop-blur-2xl rounded-2xl p-6 border border-orange-200/40 hover:border-orange-300/60 transition-all duration-500 hover:shadow-2xl hover:shadow-orange-500/10">
                            <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-transparent to-orange-100/30 opacity-60 rounded-2xl"></div>
                            <div className="relative z-10 flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-orange-600 font-semibold uppercase tracking-wide mb-2">
                                        待揀貨
                                    </p>
                                    <p className="text-3xl font-bold text-orange-600">
                                        {pickTasks.length}
                                    </p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
                                    <Package className="text-white" size={22} />
                                </div>
                            </div>
                        </div>

                        {/* 待裝箱卡片 - 綠色（進行中） */}
                        <div className="group relative bg-white/60 backdrop-blur-2xl rounded-2xl p-6 border border-green-200/40 hover:border-green-300/60 transition-all duration-500 hover:shadow-2xl hover:shadow-green-500/10">
                            <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 via-transparent to-green-100/30 opacity-60 rounded-2xl"></div>
                            <div className="relative z-10 flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-green-600 font-semibold uppercase tracking-wide mb-2">
                                        待裝箱
                                    </p>
                                    <p className="text-3xl font-bold text-green-600">
                                        {packTasks.length}
                                    </p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/30">
                                    <Box className="text-white" size={22} />
                                </div>
                            </div>
                        </div>

                        {/* 總任務卡片 - 藍色（總覽） */}
                        <div className="group relative bg-white/60 backdrop-blur-2xl rounded-2xl p-6 border border-blue-200/40 hover:border-blue-300/60 transition-all duration-500 hover:shadow-2xl hover:shadow-blue-500/10">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-transparent to-blue-100/30 opacity-60 rounded-2xl"></div>
                            <div className="relative z-10 flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide mb-2">
                                        總任務
                                    </p>
                                    <p className="text-3xl font-bold text-blue-600">
                                        {visibleTasks.length}
                                    </p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                                    <LayoutDashboard className="text-white" size={22} />
                                </div>
                            </div>
                        </div>

                        {/* 我的任務卡片 - 灰色（個人） */}
                        <div className="group relative bg-white/60 backdrop-blur-2xl rounded-2xl p-6 border border-gray-200/40 hover:border-gray-300/60 transition-all duration-500 hover:shadow-2xl">
                            <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 via-transparent to-gray-100/30 opacity-60 rounded-2xl"></div>
                            <div className="relative z-10 flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-gray-600 font-semibold uppercase tracking-wide mb-2">
                                        我的任務
                                    </p>
                                    <p className="text-3xl font-bold text-gray-800">
                                        {visibleTasks.filter(t => t.current_user).length}
                                    </p>
                                </div>
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center shadow-lg shadow-gray-500/20">
                                    <User className="text-white" size={22} />
                                </div>
                            </div>
                        </div>
                    </div>
                

                {/* 任務列表 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                    {/* 揀貨任務區 */}
                    <section className="animate-slide-up">
                        <div className="relative mb-4">
                            {/* 背景光暈 */}
                            <div className="absolute inset-0 bg-gradient-to-r from-orange-500/10 via-orange-500/5 to-transparent rounded-2xl blur-xl"></div>
                            <div className="relative bg-white/60 backdrop-blur-xl rounded-2xl p-4 border border-orange-200/40">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
                                            <Package className="text-white" size={20} />
                                        </div>
                                        <h2 className="text-lg font-semibold text-gray-900">
                                            待揀貨任務
                                        </h2>
                                    </div>
                                    <span className="px-2.5 py-0.5 rounded-lg bg-orange-100 text-orange-700 text-sm font-bold">
                                        {pickTasks.length}
                                    </span>
                                </div>
                            </div>
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
                                            onOpenChat={handleOpenChat}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="relative group text-center py-16 sm:py-20 glass rounded-xl sm:rounded-2xl border-2 border-dashed border-gray-200 hover:border-amber-300 transition-all duration-300 overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-br from-amber-50/0 to-amber-100/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                    <div className="relative z-10">
                                        <div className="inline-block p-4 bg-gradient-to-br from-amber-100 to-orange-100 rounded-2xl mb-4 group-hover:scale-110 transition-transform duration-300">
                                            <Package className="text-amber-600" size={48} />
                                        </div>
                                        <p className="text-gray-400 text-base sm:text-lg font-medium">目前沒有待處理的揀貨任務</p>
                                        <p className="text-gray-300 text-xs sm:text-sm mt-2">太棒了！保持這個節奏 🎉</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 裝箱任務區 */}
                    <section className="animate-slide-up" style={{ animationDelay: '100ms' }}>
                        <div className="relative mb-4">
                            {/* 背景光暈 */}
                            <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 via-green-500/5 to-transparent rounded-2xl blur-xl"></div>
                            <div className="relative bg-white/60 backdrop-blur-xl rounded-2xl p-4 border border-green-200/40">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/30">
                                            <Box className="text-white" size={20} />
                                        </div>
                                        <h2 className="text-lg font-semibold text-gray-900">
                                            待裝箱任務
                                        </h2>
                                    </div>
                                    <span className="px-2.5 py-0.5 rounded-lg bg-green-100 text-green-700 text-sm font-bold">
                                        {packTasks.length}
                                    </span>
                                </div>
                            </div>
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
                                            onOpenChat={handleOpenChat}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="relative group text-center py-16 sm:py-20 glass rounded-xl sm:rounded-2xl border-2 border-dashed border-gray-200 hover:border-indigo-300 transition-all duration-300 overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/0 to-indigo-100/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                    <div className="relative z-10">
                                        <div className="inline-block p-4 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-2xl mb-4 group-hover:scale-110 transition-transform duration-300">
                                            <Box className="text-indigo-600" size={48} />
                                        </div>
                                        <p className="text-gray-400 text-base sm:text-lg font-medium">目前沒有待處理的裝箱任務</p>
                                        <p className="text-gray-300 text-xs sm:text-sm mt-2">繼續加油！💪</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* 全部完成狀態 */}
                {visibleTasks.length === 0 && !loading && (
                    <div className="text-center py-24 animate-fade-in">
                        <div className="glass rounded-3xl p-12 max-w-md mx-auto">
                            <CheckCircle2 size={80} className="mx-auto mb-6 text-green-500" />
                            <h3 className="text-3xl font-bold text-gray-900 mb-2">太棒了！</h3>
                            <p className="text-gray-500 text-lg">所有任務都已完成</p>
                        </div>
                    </div>
                )}
            </div>

            {/* 浮動聊天面板 */}
            {openChats.map((chat, index) => (
                <FloatingChatPanel
                    key={chat.orderId}
                    orderId={chat.orderId}
                    voucherNumber={chat.voucherNumber}
                    position={index}
                    onClose={() => handleCloseChat(chat.orderId)}
                />
            ))}
        </div>
    );
}
