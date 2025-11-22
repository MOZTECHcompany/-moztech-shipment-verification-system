// frontend/src/components/TaskDashboard-modern.jsx
// 現代化 Apple 風格任務儀表板

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { Package, Box, User, Loader2, ServerOff, LayoutDashboard, Trash2, Volume2, VolumeX, ArrowRight, Clock, CheckCircle2, ListChecks, MessageSquare, Bell, Flame, AlertTriangle, Pin } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { soundNotification } from '@/utils/soundNotification.js';
import { voiceNotification } from '@/utils/voiceNotification.js';
import { desktopNotification } from '@/utils/desktopNotification.js';
import FloatingChatPanel from './FloatingChatPanel';
import NotificationCenter from './NotificationCenter';
import { PageHeader, FilterBar, Button, Skeleton, SkeletonText } from '@/ui';

// 可調整：任務分區數字徽章呼吸動畫秒數與光暈強度
const BADGE_PULSE_SECONDS = 2.75; // 推薦：2.5~3.5 之間
const BADGE_GLOW_ALPHA = 0.18;    // 推薦：0.12~0.22 之間

// 數字滾動動畫：摘要卡數字在變化時垂直滾動過渡
function NumberTicker({ value, duration = 300 }) {
    const [display, setDisplay] = useState(value);
    const [prev, setPrev] = useState(value);
    const [anim, setAnim] = useState(null); // 'up' | 'down' | null
    const timeoutRef = useRef(null);

    useEffect(() => {
        if (value === display) return;
        // 設定方向與觸發動畫
        setPrev(display);
        setAnim(value > display ? 'up' : 'down');
        // 動畫結束後更新顯示值並清理狀態
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            setDisplay(value);
            setAnim(null);
        }, duration);
        return () => clearTimeout(timeoutRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    // 容器高度以 1 行文字高度為準
    const baseClass = 'relative h-[1em] overflow-hidden inline-block align-bottom';
    const commonRow = 'block leading-none';

    if (!anim) {
        return <span className={baseClass}><span className={commonRow}>{display}</span></span>;
    }

    const translateStart = anim === 'up' ? 'translate-y-0' : '-translate-y-full';
    const translateEnd = anim === 'up' ? '-translate-y-full' : 'translate-y-0';
    const nextStart = anim === 'up' ? 'translate-y-full' : 'translate-y-0';
    const nextEnd = anim === 'up' ? 'translate-y-0' : 'translate-y-full';

    const style = { transition: `transform ${duration}ms ease-in-out` };

    return (
        <span className={baseClass} aria-live="polite">
            <span className={`absolute inset-0 ${commonRow} ${translateStart}`} style={style}>{prev}</span>
            <span className={`absolute inset-0 ${commonRow} ${nextStart}`} style={style}>{value}</span>
            {/* 觸發下一個 frame 將 class 切換至結束狀態 */}
            <span className="sr-only">&nbsp;</span>
            <style>{`
                /* 動態應用 translate 的結束狀態透過 requestAnimationFrame 會更穩定，
                   這裡簡化為下一次 reflow 自動過渡（實務表現足夠平滑） */
            `}</style>
        </span>
    );
}

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

// 現代化任務卡片 - 2025 重構版 (Spatial Style)
const ModernTaskCard = ({ task, onClaim, user, onDelete, batchMode, selectedTasks, toggleTaskSelection, onOpenChat, isPinned, onTogglePin }) => {
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

    // 視覺狀態處理 - 強烈風格
    const selectionRing = selectedTasks.includes(task.id) ? 'ring-4 ring-primary/30 scale-[0.98]' : '';
    
    // 根據狀態決定卡片邊框與陰影風格
    let cardStyle = 'glass-panel hover:shadow-2xl hover:scale-[1.02] hover:-rotate-1 transition-all duration-400 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]';
    if (isUrgent) {
        cardStyle = 'glass-panel bg-red-500/10 border-red-500/30 shadow-[0_0_30px_-10px_rgba(239,68,68,0.3)] hover:shadow-red-500/40 hover:scale-[1.02] hover:-rotate-1';
    } else if (isPinned) {
        cardStyle = 'glass-panel bg-blue-500/10 border-blue-500/30 shadow-[0_0_30px_-10px_rgba(59,130,246,0.3)] hover:shadow-blue-500/40 hover:scale-[1.02] hover:-rotate-1';
    }

    return (
        <div className={`
            group relative flex flex-col
            rounded-[32px]
            ${cardStyle} ${selectionRing}
            overflow-hidden
        `}>
            {/* 頂部狀態光條 - 僅在非緊急/置頂時顯示一般顏色，緊急/置頂由邊框主導 */}
            {!isUrgent && !isPinned && (
                <div className={`h-1.5 w-full opacity-80 ${
                    task.status === 'picking' ? 'bg-gradient-to-r from-blue-500 to-cyan-400' : (
                    task.status === 'picked' ? 'bg-gradient-to-r from-purple-500 to-pink-400' : (
                    task.status === 'packing' ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gray-200'))
                }`} />
            )}
            
            {/* 緊急/置頂 頂部標籤 */}
            {(isUrgent || isPinned) && (
                <div className={`h-1.5 w-full ${isUrgent ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}`} />
            )}
            
            <div className="p-7 flex flex-col h-full relative">
                {/* 背景裝飾 - 更加微妙的光暈 */}
                <div className={`absolute top-0 right-0 w-40 h-40 bg-gradient-to-br rounded-bl-[100px] -z-0 opacity-10 pointer-events-none blur-2xl ${
                    isUrgent ? 'from-red-500 to-transparent' : (isPinned ? 'from-blue-500 to-transparent' : 'from-white to-transparent')
                }`}></div>

                {/* Header Section */}
                <div className="flex justify-between items-start mb-6 relative z-10">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                        {batchMode && (
                            <div className="pt-1">
                                <input
                                    type="checkbox"
                                    checked={selectedTasks.includes(task.id)}
                                    onChange={() => toggleTaskSelection(task.id)}
                                    className="w-6 h-6 rounded-lg border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer transition-all"
                                />
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                                <h3 className="font-black text-4xl text-gray-900 tracking-tighter group-hover:text-blue-600 transition-colors drop-shadow-sm">
                                    {task.voucher_number}
                                </h3>
                            </div>
                            
                            <div className="flex items-center gap-3 mt-2">
                                <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full backdrop-blur-md border border-white/20 shadow-sm ${statusInfo.color.replace('border', '')} bg-opacity-60`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                                    {statusInfo.text}
                                </div>
                                <div className="flex items-center gap-1.5 text-gray-600 font-bold bg-white/40 backdrop-blur-md border border-white/30 px-2.5 py-1 rounded-full text-[10px] shadow-sm">
                                    <User size={10} />
                                    <span className="truncate max-w-[100px]">{task.customer_name}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* 右上角工具列 - 總是顯示重要狀態 */}
                    <div className="flex items-center gap-2">
                        {isPinned && (
                            <div className="w-10 h-10 rounded-full bg-gray-900/90 backdrop-blur text-white flex items-center justify-center shadow-lg">
                                <Pin size={18} />
                            </div>
                        )}
                        {isUrgent && (
                            <div className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg animate-pulse">
                                <Flame size={18} />
                            </div>
                        )}
                        
                        {/* Admin Actions - Hover Reveal */}
                        {user && user.role === 'admin' && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-4 group-hover:translate-x-0 ml-2">
                                <button onClick={(e) => { e.stopPropagation(); onTogglePin?.(task.id); }} className="p-2 hover:bg-white/50 rounded-full text-gray-400 hover:text-blue-600 transition-colors backdrop-blur-sm">
                                    <Pin size={18} />
                                </button>
                                <button onClick={handleSetUrgent} className="p-2 hover:bg-white/50 rounded-full text-gray-400 hover:text-red-600 transition-colors backdrop-blur-sm">
                                    <AlertTriangle size={18} />
                                </button>
                                <button onClick={() => onDelete(task.id, task.voucher_number)} className="p-2 hover:bg-red-50/50 rounded-full text-gray-400 hover:text-red-600 transition-colors backdrop-blur-sm">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* 揀貨員資訊 */}
                {task.task_type === 'pack' && task.picker_name && (
                    <div className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50/40 backdrop-blur-sm rounded-lg border border-blue-100/30 w-fit">
                        <CheckCircle2 size={14} className="text-blue-600" />
                        <span className="text-xs text-blue-900 font-medium">
                            揀貨員: <span className="font-bold">{task.picker_name}</span>
                        </span>
                    </div>
                )}

                {/* 評論區塊 - 依照第二張圖設計重構 */}
                {hasComments && (
                    <div className="mt-auto mb-6">
                        <div 
                            onClick={handleOpenChat}
                            className="cursor-pointer relative overflow-hidden rounded-[24px] bg-white/40 backdrop-blur-md border border-white/40 transition-all hover:bg-white/60 hover:shadow-lg group/chat"
                        >
                            <div className="p-5">
                                {/* Header: Avatar + Name + Status */}
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shadow-md border border-white/20">
                                        {latestComment?.user_name?.[0] || 'U'}
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="text-base font-bold text-gray-900">
                                                {latestComment?.user_name}
                                            </span>
                                            <span className="text-xs text-gray-500 font-medium">• 最新留言</span>
                                        </div>
                                        {/* 緊急標籤 */}
                                        {hasUrgentComments && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100/80 text-red-600 text-[10px] font-bold w-fit mt-0.5 backdrop-blur-sm">
                                                <Flame size={10} /> 緊急
                                            </span>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Message Body - Large Text with Indicator */}
                                <div className="flex gap-4">
                                    {/* Vertical Indicator Bar */}
                                    <div className="w-1.5 rounded-full bg-gray-400/30 flex-shrink-0 self-stretch backdrop-blur-sm"></div>
                                    
                                    <div className="flex-1 py-1">
                                        <p className="text-xl font-bold text-gray-800 leading-relaxed line-clamp-2 drop-shadow-sm">
                                            {latestComment?.content || '...'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Footer Action */}
                            <div className="px-5 py-3 bg-white/30 border-t border-white/20 flex items-center justify-between backdrop-blur-sm">
                                <span className="text-sm font-bold text-blue-600 flex items-center gap-2">
                                    <MessageSquare size={16} />
                                    {task.total_comments} 則對話紀錄
                                </span>
                                <span className="text-sm font-bold text-blue-600 flex items-center gap-1 group-hover/chat:translate-x-1 transition-transform">
                                    回覆 <ArrowRight size={16} />
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 主要操作按鈕 */}
                <div className="mt-auto pt-2">
                    {isMyTask ? (
                        <Button
                            variant="primary"
                            size="lg"
                            className="w-full justify-center h-14 text-lg font-bold rounded-2xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all active:scale-95"
                            onClick={() => onClaim(task.id, true)}
                        >
                            <span className="flex items-center gap-2">
                                繼續作業 <ArrowRight size={20} />
                            </span>
                        </Button>
                    ) : (
                        <Button
                            variant="primary"
                            size="lg"
                            className={`w-full justify-center h-14 text-lg font-bold rounded-2xl shadow-lg hover:-translate-y-0.5 transition-all active:scale-95 ${
                                task.task_type === 'pick' 
                                    ? 'bg-gray-900 hover:bg-gray-800 shadow-gray-900/20' 
                                    : 'bg-gray-900 hover:bg-gray-800 shadow-gray-900/20'
                            }`}
                            onClick={() => onClaim(task.id, false)}
                        >
                            <span className="flex items-center gap-2">
                                {task.task_type === 'pick' ? '開始揀貨' : '開始裝箱'} <ArrowRight size={20} />
                            </span>
                        </Button>
                    )}
                </div>
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
    const [pickHighlight, setPickHighlight] = useState(false);
    const [pinnedTaskIds, setPinnedTaskIds] = useState([]);
    
    // 浮動聊天面板狀態
    const [openChats, setOpenChats] = useState([]);
    
    const navigate = useNavigate();
    const MySwal = withReactContent(Swal);

    // 置頂任務：雲端同步（團隊共享），以 localStorage 作快取
    const pinStorageKey = useMemo(() => `pinned_tasks_team_cache`, []);
    const fetchPinnedTasks = useCallback(async () => {
        try {
            const res = await apiClient.get('/api/tasks/pins');
            const list = Array.isArray(res?.data?.pinned) ? res.data.pinned : [];
            setPinnedTaskIds(list);
            localStorage.setItem(pinStorageKey, JSON.stringify(list));
        } catch (e) {
            try {
                const cached = JSON.parse(localStorage.getItem(pinStorageKey) || '[]');
                setPinnedTaskIds(Array.isArray(cached) ? cached : []);
            } catch { setPinnedTaskIds([]); }
        }
    }, [pinStorageKey]);

    useEffect(() => {
        fetchPinnedTasks();
    }, [fetchPinnedTasks]);

    const togglePinTask = useCallback(async (taskId) => {
        const willPin = !pinnedTaskIds.includes(taskId);
        // 樂觀更新
        setPinnedTaskIds(prev => {
            const next = willPin ? [...prev, taskId] : prev.filter(id => id !== taskId);
            localStorage.setItem(pinStorageKey, JSON.stringify(next));
            return next;
        });
        try {
            await apiClient.put(`/api/tasks/pins/${taskId}`, { pinned: willPin });
        } catch (e) {
            // 還原
            setPinnedTaskIds(prev => {
                const next = willPin ? prev.filter(id => id !== taskId) : [...prev, taskId];
                localStorage.setItem(pinStorageKey, JSON.stringify(next));
                return next;
            });
            toast.error('更新置頂狀態失敗');
        }
    }, [pinnedTaskIds, pinStorageKey]);

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
            setPinnedTaskIds(prev => {
                const next = prev.filter(id => id !== orderId);
                if (next.length !== prev.length) localStorage.setItem(pinStorageKey, JSON.stringify(next));
                return next;
            });
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
        const handleTaskPinChanged = ({ orderId, pinned }) => {
            setPinnedTaskIds(prev => {
                const exists = prev.includes(orderId);
                const next = pinned ? (exists ? prev : [...prev, orderId]) : prev.filter(id => id !== orderId);
                localStorage.setItem(pinStorageKey, JSON.stringify(next));
                return next;
            });
        };
        socket.on('task_pin_changed', handleTaskPinChanged);
        
        return () => {
            socket.off('new_task', handleNewTask);
            socket.off('task_claimed', handleTaskUpdate);
            socket.off('task_status_changed', handleTaskUpdate);
            socket.off('task_deleted', handleTaskDeleted);
            socket.off('task_urgent_changed', handleUrgentChanged);
            socket.off('task_pin_changed', handleTaskPinChanged);
        };
    }, [user]);

    // 當任務列表變動時，清理已不存在的置頂 ID
    useEffect(() => {
        const currentIds = new Set(tasks.map(t => t.id));
        setPinnedTaskIds(prev => {
            const next = prev.filter(id => currentIds.has(id));
            if (next.length !== prev.length) localStorage.setItem(pinStorageKey, JSON.stringify(next));
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tasks]);

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

    // 依置頂/緊急排序後，再切分揀貨/裝箱
    const sortedVisibleTasks = useMemo(() => {
        const arr = [...visibleTasks];
        arr.sort((a, b) => {
            const aScore = (pinnedTaskIds.includes(a.id) ? 2 : 0) + (a.is_urgent ? 1 : 0);
            const bScore = (pinnedTaskIds.includes(b.id) ? 2 : 0) + (b.is_urgent ? 1 : 0);
            return bScore - aScore;
        });
        return arr;
    }, [visibleTasks, pinnedTaskIds]);

    const pickTasks = sortedVisibleTasks.filter(t => t.task_type === 'pick');
    const packTasks = sortedVisibleTasks.filter(t => t.task_type === 'pack');

    // 當待揀貨數量變動時，短暫高亮
    useEffect(() => {
        setPickHighlight(true);
        const timer = setTimeout(() => setPickHighlight(false), 800);
        return () => clearTimeout(timer);
    }, [pickTasks.length]);

    if (loading) {
        return (
            <div className="min-h-screen bg-secondary dark:bg-background/95">
                <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
                    {/* Header Skeleton */}
                    <div className="mb-4">
                        <Skeleton className="h-8 w-48 mb-2" />
                        <Skeleton className="h-4 w-72" />
                    </div>
                    {/* FilterBar Skeleton */}
                    <div className="mb-6">
                        <Skeleton className="h-10 w-full rounded-xl" />
                    </div>
                    {/* Stats Skeleton */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2 mb-6">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-white rounded-2xl p-5 border border-gray-200">
                                <Skeleton className="h-6 w-24 mb-3" />
                                <Skeleton className="h-8 w-16" />
                            </div>
                        ))}
                    </div>
                    {/* Cards Skeleton */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="bg-white rounded-2xl p-6 border border-gray-200">
                                <Skeleton className="h-6 w-40 mb-4" />
                                <SkeletonText lines={3} />
                                <div className="mt-6">
                                    <Skeleton className="h-11 w-full rounded-xl" />
                                </div>
                            </div>
                        ))}
                    </div>
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
                  className="relative z-50"
                  actions={(
                    <div className="flex items-center gap-2">
                      <NotificationCenter onOpenChat={handleOpenChat} />
                      
                      {/* 批次操作按鈕 */}
                      {user && user.role === 'admin' && (
                        <Button 
                            variant={batchMode ? 'primary' : 'secondary'} 
                            size="sm" 
                            onClick={toggleBatchMode} 
                            leadingIcon={ListChecks}
                            className={batchMode ? 'shadow-lg shadow-primary/30' : ''}
                        >
                          {batchMode ? '✓ 批次模式' : '批次操作'}
                        </Button>
                      )}
                      
                      {batchMode && selectedTasks.length > 0 && (
                        <Button variant="primary" size="sm" onClick={handleBatchClaim} leadingIcon={CheckCircle2} className="animate-in fade-in zoom-in">
                          認領 {selectedTasks.length} 個
                        </Button>
                      )}

                      {/* 設定群組 */}
                      <div className="flex items-center bg-white/50 backdrop-blur-sm rounded-xl p-1 border border-gray-200/50 shadow-sm">
                          <button 
                            onClick={toggleSound}
                            className={`p-2 rounded-lg transition-all ${soundEnabled ? 'bg-white text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                            title="音效開關"
                          >
                              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                          </button>
                          <div className="w-px h-4 bg-gray-200 mx-1"></div>
                          <button 
                            onClick={toggleVoice}
                            className={`p-2 rounded-lg transition-all ${voiceEnabled ? 'bg-white text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                            title="語音播報"
                          >
                              <MessageSquare size={18} />
                          </button>
                          <div className="w-px h-4 bg-gray-200 mx-1"></div>
                          <button 
                            onClick={toggleNotification}
                            className={`p-2 rounded-lg transition-all ${notificationEnabled ? 'bg-white text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                            title="桌面通知"
                          >
                              <Bell size={18} />
                          </button>
                      </div>

                      {user && user.role === 'admin' && (
                        <Button as={Link} to="/admin" variant="secondary" size="sm" leadingIcon={LayoutDashboard}>
                          管理中心
                        </Button>
                      )}
                    </div>
                  )}
                />

                {/* 篩選／搜尋列 */}
                <div className="sticky top-0 z-30 -mx-4 px-4 py-3 mb-6">
                    <div className="glass rounded-2xl p-2 shadow-lg border border-white/40 backdrop-blur-xl">
                        <FilterBar 
                            value={search} 
                            onChange={setSearch} 
                            placeholder="搜尋單號、客戶名稱..." 
                            className="mb-0 border-0 shadow-none bg-transparent"
                        />
                    </div>
                </div>

                {/* 統計卡片 Widget 風格 */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mt-6 mb-8">
                  {[
                    {
                        label:'待揀貨', 
                        value: pickTasks.length, 
                        color:'from-orange-500 to-amber-500', 
                        bg: 'bg-orange-50',
                        text: 'text-orange-600',
                        icon: Package,
                        highlight: pickHighlight
                    },
                    {
                        label:'待裝箱', 
                        value: packTasks.length, 
                        color:'from-emerald-500 to-teal-500', 
                        bg: 'bg-emerald-50',
                        text: 'text-emerald-600',
                        icon: Box
                    },
                    {
                        label:'總任務', 
                        value: visibleTasks.length, 
                        color:'from-blue-500 to-indigo-500', 
                        bg: 'bg-blue-50',
                        text: 'text-blue-600',
                        icon: LayoutDashboard
                    },
                    {
                        label:'我的任務', 
                        value: visibleTasks.filter(t=>t.current_user).length, 
                        color:'from-purple-500 to-pink-500', 
                        bg: 'bg-purple-50',
                        text: 'text-purple-600',
                        icon: User
                    },
                  ].map((c, i)=>{
                    const Icon = c.icon;
                    return (
                      <div key={i} className="relative group overflow-hidden bg-white/80 backdrop-blur-md rounded-2xl p-5 border border-white/60 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                        <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${c.color} opacity-10 rounded-full blur-2xl -mr-8 -mt-8 group-hover:opacity-20 transition-opacity`}></div>
                        
                        <div className="relative z-10 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">{c.label}</p>
                            <p className={`text-4xl font-black tracking-tight text-gray-900 ${c.highlight ? 'animate-pulse text-orange-500' : ''}`}>
                                <NumberTicker value={c.value} />
                            </p>
                          </div>
                          <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${c.color} flex items-center justify-center shadow-lg shadow-gray-200 group-hover:scale-110 transition-transform duration-300`}>
                            <Icon className="text-white" size={22} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                

                {/* 任務列表 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* 揀貨任務區 */}
                    <section className="animate-slide-up flex flex-col h-full">
                        <div className="glass-panel rounded-2xl p-1.5 mb-4 sticky top-24 z-20 shadow-lg">
                            <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl px-4 py-3 flex items-center justify-between border border-orange-100/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white text-orange-500 flex items-center justify-center shadow-sm">
                                        <Package size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900 leading-none">待揀貨任務</h2>
                                        <p className="text-xs text-orange-600/80 font-medium mt-1">等待處理的訂單</p>
                                    </div>
                                </div>
                                <span
                                    className={`px-3 py-1 rounded-lg bg-white text-orange-600 text-sm font-bold shadow-sm border border-orange-100 ${pickHighlight ? 'ring-2 ring-orange-400 ring-offset-1' : ''}`}
                                >
                                    {pickTasks.length}
                                </span>
                            </div>
                        </div>
                        
                        <div className="flex flex-col gap-6 flex-1">
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
                                            isPinned={pinnedTaskIds.includes(task.id)}
                                            onTogglePin={togglePinTask}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center text-center p-8 glass rounded-2xl border-2 border-dashed border-gray-200/50">
                                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                        <Package className="text-gray-300" size={40} />
                                    </div>
                                    <p className="text-gray-500 font-medium">目前沒有待揀貨任務</p>
                                    <p className="text-gray-400 text-sm mt-1">稍作休息，喝杯咖啡吧 ☕️</p>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 裝箱任務區 */}
                    <section className="animate-slide-up flex flex-col h-full" style={{ animationDelay: '100ms' }}>
                        <div className="glass-panel rounded-2xl p-1.5 mb-4 sticky top-24 z-20 shadow-lg">
                            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl px-4 py-3 flex items-center justify-between border border-emerald-100/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white text-emerald-500 flex items-center justify-center shadow-sm">
                                        <Box size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900 leading-none">待裝箱任務</h2>
                                        <p className="text-xs text-emerald-600/80 font-medium mt-1">已完成揀貨，等待包裝</p>
                                    </div>
                                </div>
                                <span
                                    className="px-3 py-1 rounded-lg bg-white text-emerald-600 text-sm font-bold shadow-sm border border-emerald-100"
                                >
                                    {packTasks.length}
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col gap-6 flex-1">
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
                                            isPinned={pinnedTaskIds.includes(task.id)}
                                            onTogglePin={togglePinTask}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center text-center p-8 glass rounded-2xl border-2 border-dashed border-gray-200/50">
                                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                        <Box className="text-gray-300" size={40} />
                                    </div>
                                    <p className="text-gray-500 font-medium">目前沒有待裝箱任務</p>
                                    <p className="text-gray-400 text-sm mt-1">所有包裹都已處理完畢 ✨</p>
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
