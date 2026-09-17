// Corely AI task dashboard: bounded server search and role-aware work queues.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { Package, Box, User, Loader2, ServerOff, LayoutDashboard, Trash2, ArrowRight, Clock, CheckCircle2, ListChecks, MessageSquare, Flame, AlertTriangle, Pin, RefreshCw } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import soundNotification from '@/utils/soundNotification.js';
import voiceNotification from '@/utils/voiceNotification.js';
import desktopNotification from '@/utils/desktopNotification.js';
import FloatingChatPanel from './FloatingChatPanel';
import { MessageTimestamp } from './MessageTimestamp';
import NotificationCenter from './NotificationCenter';
import DefectReportModal from './DefectReportModal';
import { PageHeader, Button, Skeleton, SkeletonText } from '@/ui';
import TaskListFilters from './TaskListFilters';
import { filterTasks, canBatchClaim, batchStagesForRole, isActiveTaskForRole } from '@/utils/taskFilters';
import { TASK_PAGE_SIZE, taskQueryScope, taskPageUrl, readTaskPage } from '@/utils/taskPage';

// Counts should stay readable while tasks refresh.
function NumberTicker({ value }) {
    return <span aria-live="polite" aria-atomic="true">{value}</span>;
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
    completed: {
        text: '已完成',
        color: 'bg-gradient-to-r from-green-50/80 to-emerald-50/80 text-green-700 border border-green-200/50',
        icon: CheckCircle2,
        dot: 'bg-green-500'
    },
};

// 現代化任務卡片 - 2025 重構版 (Spatial Style)
const ModernTaskCard = ({ task, onClaim, user, onDelete, batchMode, selectedTasks, toggleTaskSelection, onOpenChat, isPinned, onTogglePin, onReportDefect, viewMode = 'active', onViewOrder, isClaiming = false, claimDisabled = false }) => {
    const isMyTask = task.current_user;
    const isUrgent = task.is_urgent || false;
    const hasComments = task.total_comments > 0;
    const hasUrgentComments = task.urgent_comments > 0;
    const latestComment = task.latest_comment;

    const isCompletedView = viewMode === 'completed';
    const isAdminLike = user?.role === 'admin' || user?.role === 'superadmin';
    const isDispatcherMine = user?.role === 'dispatcher' && Number(task?.imported_by_user_id) === Number(user?.id);
    const canManageTask = isAdminLike || isDispatcherMine;
    
    const statusInfo = statusConfig[task.status] || { 
        text: task.status, 
        color: 'bg-gray-100 text-gray-700',
        icon: Package,
        dot: 'bg-gray-500'
    };

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
    const mineRing = isDispatcherMine ? 'ring-2 ring-blue-500/20' : '';
    
    // 根據狀態決定卡片邊框與陰影風格
    let cardStyle = 'bg-white border border-slate-200 shadow-sm transition-shadow hover:shadow-md';
    if (isUrgent) {
        cardStyle = 'bg-white border border-red-300 shadow-sm';
    } else if (isPinned) {
        cardStyle = 'bg-white border border-blue-300 shadow-sm';
    }

    return (
        <div className={`
            group relative flex flex-col
            rounded-2xl
            ${cardStyle} ${selectionRing} ${mineRing}
            overflow-hidden
        `}>
            {/* 緊急/置頂 頂部標籤 */}
            {(isUrgent || isPinned) && (
                <div className={`h-1.5 w-full ${isUrgent ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}`} />
            )}
            
            <div className="p-4 sm:p-5 flex flex-col h-full relative">
                {/* Header Section */}
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between mb-4 relative z-10">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                        {batchMode && canBatchClaim(task, user, batchMode) && (
                            <div className="pt-1">
                                <input
                                    type="checkbox"
                                    aria-label={`選取${batchMode === 'pack' ? '裝箱' : '揀貨'}任務 ${task.voucher_number}`}
                                    disabled={claimDisabled}
                                    checked={selectedTasks.includes(task.id)}
                                    onChange={() => toggleTaskSelection(task.id)}
                                    className="w-6 h-6 rounded-lg border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer transition-all"
                                />
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                                <h3 className="font-bold text-xl sm:text-2xl text-gray-900 tracking-tight break-all group-hover:text-blue-600 transition-colors drop-shadow-sm">
                                    {task.voucher_number}
                                </h3>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-3 mt-2">
                                <div className={`flex items-center gap-1.5 text-[11px] sm:text-[12px] font-bold px-2.5 py-1 rounded-full shadow-sm ${statusInfo.color}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                                    {statusInfo.text}
                                </div>
                                {user?.role === 'dispatcher' && Number(task?.imported_by_user_id) === Number(user?.id) && (
                                    <div className="flex items-center gap-1.5 text-[11px] sm:text-[12px] font-bold px-2.5 py-1 rounded-full border border-white/30 shadow-sm bg-slate-50 text-gray-700">
                                        我的拋單
                                    </div>
                                )}
                                <div className="flex items-center gap-1.5 text-gray-600 font-bold bg-slate-50 border border-white/30 px-2.5 py-1 rounded-full text-[11px] sm:text-[12px] shadow-sm">
                                    <User size={10} />
                                    <span className="truncate max-w-[100px]">{task.customer_name}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* 右上角工具列 - 總是顯示重要狀態 */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {isPinned && (
                            <div className="w-10 h-10 rounded-full bg-gray-900/90 text-white flex items-center justify-center shadow-lg">
                                <Pin size={18} />
                            </div>
                        )}
                        {isUrgent && (
                            <div className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg animate-pulse">
                                <Flame size={18} />
                            </div>
                        )}
                        
                        {/* 管理操作 - Hover Reveal（admin / superadmin / 自己拋單的 dispatcher） */}
                        {user && canManageTask && (
                            <div className="flex items-center gap-1 ml-2">
                                <button onClick={(e) => { e.stopPropagation(); onTogglePin?.(task.id); }} aria-label={isPinned ? '取消置頂' : '置頂任務'} title={isPinned ? '取消置頂' : '置頂任務'} className="p-2 hover:bg-white/50 rounded-full text-gray-400 hover:text-blue-600 transition-colors ">
                                    <Pin size={18} />
                                </button>
                                <button onClick={handleSetUrgent} aria-label={isUrgent ? '取消緊急' : '標記緊急'} title={isUrgent ? '取消緊急' : '標記緊急'} className="p-2 hover:bg-white/50 rounded-full text-gray-400 hover:text-red-600 transition-colors ">
                                    <AlertTriangle size={18} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onReportDefect(task); }} className="p-2 hover:bg-white/50 rounded-full text-gray-400 hover:text-orange-600 transition-colors " title="新品不良更換">
                                    <RefreshCw size={18} />
                                </button>
                                <button onClick={() => onDelete(task.id, task.voucher_number)} aria-label={`刪除訂單 ${task.voucher_number}`} title="刪除訂單" className="p-2 hover:bg-red-50/50 rounded-full text-gray-400 hover:text-red-600 transition-colors ">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* 揀貨員資訊 */}
                {task.task_type === 'pack' && task.picker_name && (
                    <div className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg border border-blue-100/30 w-fit">
                        <CheckCircle2 size={14} className="text-blue-600" />
                        <span className="text-xs text-blue-900 font-medium">
                            揀貨員: <span className="font-bold">{task.picker_name}</span>
                        </span>
                    </div>
                )}

                {/* 留言入口 */}
                <div className="mt-auto mb-3">
                    {hasComments ? (
                        <button
                            type="button"
                            aria-label={`查看訂單 ${task.voucher_number} 的留言`}
                            onClick={handleOpenChat}
                            className="w-full min-h-[44px] text-left relative overflow-hidden rounded-xl bg-slate-50 border border-slate-200 transition-colors hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 group/chat"
                        >
                            <span className="block p-3">
                                {/* Header: Avatar + Name + Status */}
                                <span className="flex items-center gap-3 mb-2">
                                    <span className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shadow-md border border-white/20">
                                        {latestComment?.user_name?.[0] || 'U'}
                                    </span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="flex flex-wrap items-center gap-x-2">
                                            <span className="text-sm font-semibold text-gray-900 break-words">
                                                {latestComment?.user_name}
                                            </span>
                                            <span className="text-xs text-gray-500 font-medium">• 最新留言</span>
                                            <MessageTimestamp value={latestComment?.created_at} className="text-[11px] text-gray-500" />
                                        </span>
                                        {/* 緊急標籤 */}
                                        {hasUrgentComments && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100/80 text-red-600 text-[10px] font-bold w-fit mt-0.5 ">
                                                <Flame size={10} /> 緊急
                                            </span>
                                        )}
                                    </span>
                                </span>
                                
                                {/* Message Body - Large Text with Indicator */}
                                <span className="flex gap-4">
                                    {/* Vertical Indicator Bar */}
                                    <span className="w-1.5 rounded-full bg-gray-400/30 flex-shrink-0 self-stretch "></span>
                                    
                                    <span className="min-w-0 flex-1">
                                        <span className="text-sm font-medium text-gray-800 leading-relaxed line-clamp-2 break-words">
                                            {latestComment?.content || '...'}
                                        </span>
                                    </span>
                                </span>
                            </span>
                            
                            {/* Footer Action */}
                            <span className="px-3 py-2 bg-white border-t border-slate-200 flex items-center justify-between ">
                                <span className="text-sm font-bold text-blue-600 flex items-center gap-2">
                                    <MessageSquare size={16} />
                                    {task.total_comments} 則對話紀錄
                                </span>
                                <span className="text-sm font-bold text-blue-600 flex items-center gap-1 group-hover/chat:translate-x-1 transition-transform">
                                    回覆 <ArrowRight size={16} />
                                </span>
                            </span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleOpenChat}
                            aria-label={`開始討論訂單 ${task.voucher_number}`}
                            className="flex w-full min-h-[44px] items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-left text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                        >
                            <MessageSquare size={16} className="shrink-0" aria-hidden="true" />
                            <span className="min-w-0 truncate text-sm font-medium">尚無留言 · 開始討論</span>
                        </button>
                    )}
                </div>

                {/* 主要操作按鈕 */}
                <div className="mt-auto pt-2">
                    {isCompletedView ? (
                        <Button
                            variant="secondary"
                            size="lg"
                            className="w-full justify-center h-12 sm:h-14 text-base sm:text-lg font-bold rounded-2xl shadow-lg hover:-translate-y-0.5 transition-all active:scale-95"
                            onClick={() => onViewOrder?.(task.id)}
                        >
                            <span className="flex items-center gap-2">
                                查看訂單 <ArrowRight size={20} />
                            </span>
                        </Button>
                    ) : user?.role === 'dispatcher' ? (
                        <Button
                            variant="secondary"
                            size="lg"
                            className="w-full justify-center h-12 sm:h-14 text-base sm:text-lg font-bold rounded-2xl shadow-lg hover:-translate-y-0.5 transition-all active:scale-95"
                            onClick={() => onViewOrder?.(task.id)}
                        >
                            <span className="flex items-center gap-2">
                                查看訂單 <ArrowRight size={20} />
                            </span>
                        </Button>
                    ) : isAdminLike ? (
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                size="lg"
                                className="flex-1 justify-center h-12 sm:h-14 text-base sm:text-lg font-bold rounded-2xl shadow-lg hover:-translate-y-0.5 transition-all active:scale-95"
                                onClick={() => onViewOrder?.(task.id)}
                            >
                                <span className="flex items-center gap-2">
                                    查看訂單
                                </span>
                            </Button>
                            <Button
                                variant="primary"
                                size="lg"
                                className="flex-1 justify-center h-12 sm:h-14 text-base sm:text-lg font-bold rounded-2xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all active:scale-95"
                                onClick={() => onClaim(task.id, isMyTask)}
                                disabled={claimDisabled}
                            >
                                <span className="flex items-center gap-2">
                                    {isClaiming ? '認領中…' : isMyTask ? '開啟作業' : (task.task_type === 'pick' ? '開始揀貨' : '開始裝箱')} {isClaiming ? <Loader2 size={20} className="animate-spin" /> : <ArrowRight size={20} />}
                                </span>
                            </Button>
                        </div>
                    ) : isMyTask ? (
                        <Button
                            variant="primary"
                            size="lg"
                            className="w-full justify-center h-12 sm:h-14 text-base sm:text-lg font-bold rounded-2xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all active:scale-95"
                            onClick={() => onClaim(task.id, true)}
                            disabled={claimDisabled}
                        >
                            <span className="flex items-center gap-2">
                                繼續作業 <ArrowRight size={20} />
                            </span>
                        </Button>
                    ) : (
                        <Button
                            variant="primary"
                            size="lg"
                            className={`w-full justify-center h-12 sm:h-14 text-base sm:text-lg font-bold rounded-2xl shadow-lg hover:-translate-y-0.5 transition-all active:scale-95 ${
                                task.task_type === 'pick' 
                                    ? 'bg-gray-900 hover:bg-gray-800 shadow-gray-900/20' 
                                    : 'bg-gray-900 hover:bg-gray-800 shadow-gray-900/20'
                            }`}
                            onClick={() => onClaim(task.id, false)}
                            disabled={claimDisabled}
                        >
                            <span className="flex items-center gap-2">
                                {isClaiming ? '認領中…' : task.task_type === 'pick' ? '開始揀貨' : '開始裝箱'} {isClaiming ? <Loader2 size={20} className="animate-spin" /> : <ArrowRight size={20} />}
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
    const [loadError, setLoadError] = useState('');
    const [pageInfo, setPageInfo] = useState({ hasMore: false, nextCursor: null });
    const [pagination, setPagination] = useState({ scope: null, index: 0, cursors: [null] });
    const [listChanged, setListChanged] = useState(false);
    const listVersionRef = useRef(0);
    const requestScopeRef = useRef('');
    const requestSequence = useRef(0);
    const loadedScope = useRef(null);
    const activeClaimId = useRef(null);
    const [claimingId, setClaimingId] = useState(null);
    const mountedRef = useRef(false);
    const claimContextRef = useRef(0);
    const batchClaimPending = useRef(false);
    const [isBatchClaiming, setIsBatchClaiming] = useState(false);
    const location = useLocation();
    const initialView = location?.state?.view === 'completed' ? 'completed' : 'active';
    const [currentView, setCurrentView] = useState(initialView); // 'active' | 'completed'
    const currentViewRef = useRef(currentView);
    const prevViewRef = useRef(currentView);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            claimContextRef.current += 1;
        };
    }, []);

    const getLocalISODate = useCallback(() => {
        // 與已完成清單 API 的 Asia/Taipei 日期範圍一致。
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const datePart = (type) => parts.find(part => part.type === type).value;
        return `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
    }, []);

    const [completedDate, setCompletedDate] = useState(() => getLocalISODate());
    
    currentViewRef.current = currentView;

    useEffect(() => {
        // 每次「切換到已完成」都強制回到今天（避免保留上次選的日期）
        const prev = prevViewRef.current;
        if (currentView === 'completed' && prev !== 'completed') {
            setCompletedDate(getLocalISODate());
        }
        prevViewRef.current = currentView;
    }, [currentView, getLocalISODate]);


    const [selectedTasks, setSelectedTasks] = useState([]);
    const [batchMode, setBatchMode] = useState(false);
    const batchLabel = batchMode === 'pack' ? '裝箱' : '揀貨';
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);
    const [taskGroup, setTaskGroup] = useState('all');
    const [taskSummary, setTaskSummary] = useState(null);
    const [statusFilter, setStatusFilter] = useState('all');
    const [urgentOnly, setUrgentOnly] = useState(false);
    const hasFilters = Boolean(search.trim()) || statusFilter !== 'all' || urgentOnly || taskGroup !== 'all';
    const query = { view: currentView, date: completedDate, search: debouncedSearch, status: statusFilter, urgent: urgentOnly, group: taskGroup };
    const queryScope = taskQueryScope(query);
    requestScopeRef.current = taskQueryScope({ ...query, search });
    const searchPending = search.trim() !== debouncedSearch;
    const pageIndex = pagination.scope === queryScope ? pagination.index : 0;
    const pageCursors = pagination.scope === queryScope ? pagination.cursors : [null];
    const pageCursor = pageCursors[pageIndex];
    useEffect(() => {
        setPagination(current => current.scope === queryScope ? current : { scope: queryScope, index: 0, cursors: [null] });
    }, [queryScope]);
    const requestKey = `${queryScope}:${pageCursor || ''}`;
    const requestKeyRef = useRef(requestKey);
    requestKeyRef.current = requestKey;
    const resetFilters = () => { setTaskGroup('all'); setSearch(''); setStatusFilter('all'); setUrgentOnly(false); };
    const changeView = (view) => {
        if (view !== currentViewRef.current) claimContextRef.current += 1;
        setCurrentView(view);
        setTaskGroup('all');
        setStatusFilter('all');
        setUrgentOnly(false);
        setBatchMode(false);
        setSelectedTasks([]);
    };
    useEffect(() => { setSelectedTasks([]); }, [search, statusFilter, urgentOnly, currentView, completedDate, taskGroup]);
    const [pickHighlight, setPickHighlight] = useState(false);
    const [pinnedTaskIds, setPinnedTaskIds] = useState([]);
    
    // Defect Reporting Modal State
    const [defectModalOpen, setDefectModalOpen] = useState(false);
    const [defectTask, setDefectTask] = useState(null);

    const handleReportDefect = (task) => {
        setDefectTask(task);
        setDefectModalOpen(true);
    };
    
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

    const toggleBatchMode = (stage) => {
        if (batchClaimPending.current || activeClaimId.current !== null || !batchStagesForRole(user).includes(stage)) return;
        const next = batchMode === stage ? false : stage;
        setBatchMode(next);
        setSelectedTasks([]);
        if (next) { setTaskGroup(next); setStatusFilter('all'); }
    };

    const toggleTaskSelection = (taskId) => {
        if (batchClaimPending.current || loading || searchPending ||
            !tasks.some(task => task.id === taskId && canBatchClaim(task, user, batchMode))) return;
        setSelectedTasks(prev => 
            prev.includes(taskId) 
                ? prev.filter(id => id !== taskId)
                : [...prev, taskId]
        );
    };

    const fetchTasks = useCallback(async () => {
        if (!user || !mountedRef.current || searchPending) return;
        const sequence = ++requestSequence.current;
        const listVersion = listVersionRef.current;
        const isCurrent = () => mountedRef.current && sequence === requestSequence.current &&
            requestScopeRef.current === queryScope && requestKeyRef.current === requestKey;
        setLoading(true);
        setLoadError('');
        if (loadedScope.current !== requestKey) {
            setTasks([]);
            setTaskSummary(null);
            setPageInfo({ hasMore: false, nextCursor: null });
        }
        try {
            const endpoint = taskPageUrl({ view: currentView, date: completedDate, search: debouncedSearch, status: statusFilter, urgent: urgentOnly, group: taskGroup, cursor: pageCursor });
            const response = await apiClient.get(endpoint, { timeout: 15000 });
            if (!isCurrent()) return;
            const page = readTaskPage(response.data);
            setTasks(page.items);
            setTaskSummary(page.summary);
            setPageInfo({ hasMore: page.hasMore, nextCursor: page.nextCursor });
            setListChanged(listVersionRef.current !== listVersion);
            loadedScope.current = requestKey;
        } catch (error) {
            if (isCurrent()) setLoadError(error.response?.data?.message || error.message || '暫時無法取得任務，請檢查連線後重試。');
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [user, currentView, completedDate, debouncedSearch, statusFilter, urgentOnly, taskGroup, pageCursor, queryScope, requestKey, searchPending]);

    const refreshTasks = () => {
        setSelectedTasks([]);
        if (pageIndex > 0) setPagination({ scope: queryScope, index: 0, cursors: [null] });
        else void fetchTasks();
    };
    const changePage = (direction) => {
        if (loading || searchPending || (direction > 0 && (!pageInfo.hasMore || listChanged))) return;
        setSelectedTasks([]);
        if (direction > 0) setPagination({ scope: queryScope, index: pageIndex + 1, cursors: [...pageCursors.slice(0, pageIndex + 1), pageInfo.nextCursor] });
        else if (pageIndex > 0) setPagination({ scope: queryScope, index: pageIndex - 1, cursors: pageCursors });
    };

    const handleBatchClaim = async () => {
        if (!mountedRef.current || currentViewRef.current !== 'active' || loading || searchPending || batchClaimPending.current || activeClaimId.current !== null) return;
        const claimableIds = selectedTasks.filter(id => tasks.some(task => task.id === id && canBatchClaim(task, user, batchMode)));
        if (claimableIds.length === 0) {
            toast.error(`請選擇尚未認領的${batchLabel}任務`);
            return;
        }
        const claimContext = claimContextRef.current;
        const canFollowUp = () => mountedRef.current && currentViewRef.current === 'active' && claimContextRef.current === claimContext;
        batchClaimPending.current = true;
        setIsBatchClaiming(true);
        try {
            const endpoint = batchMode === 'pack' ? '/api/orders/batch/claim' : '/api/orders/batch-claim';
            const response = await apiClient.post(endpoint, { orderIds: claimableIds, stage: batchMode }, { timeout: 15000 });
            if (!canFollowUp()) return;
            const failed = response.data.results?.failed || response.data.failed || [];
            if (failed.length) toast.error(response.data.message, { description: failed.slice(0, 3).map(item =>
                `${tasks.find(task => task.id === item.orderId)?.voucher_number || item.orderId}：${item.reason}`).join('；') });
            else toast.success(response.data.message);
            setSelectedTasks([]);
            setBatchMode(false);
            await fetchTasks();
        } catch (error) {
            if (!canFollowUp()) return;
            setSelectedTasks([]);
            setBatchMode(false);
            toast.error(error.response ? '批次認領失敗' : '認領結果尚未確認', { description: error.response?.data?.message || '請重新整理任務清單核對，避免重複認領。' });
            await fetchTasks();
        } finally {
            batchClaimPending.current = false;
            if (mountedRef.current) setIsBatchClaiming(false);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    useEffect(() => {
        // Events may change the result order or membership. Keep the bounded page
        // and ask for a fresh first page instead of appending an unbounded stream.
        const markChanged = () => { listVersionRef.current += 1; setListChanged(true); };
        const handleNewTask = (newTask) => {
            if (currentViewRef.current !== 'active' || !isActiveTaskForRole(newTask, user)) return;
            markChanged();
            toast.info(`收到新任務：${newTask.voucher_number}`);
            soundNotification.play('newTask');
            voiceNotification.speakNewTask(1);
            desktopNotification.notifyNewTask(newTask);
        };
        const handleTaskUpdate = (payload) => {
            const taskId = payload.id || payload.orderId;
            if (!taskId) return;
            markChanged();
            setTasks(current => current.flatMap(task => {
                if (Number(task.id) !== Number(taskId)) return [task];
                const updated = { ...task, ...(payload.id ? payload : {}), status: payload.status || payload.newStatus || task.status };
                if (updated.status === 'voided') return [];
                if (currentViewRef.current === 'active' && !isActiveTaskForRole(updated, user)) return [];
                if (currentViewRef.current === 'completed' && !['picked', 'packing', 'completed'].includes(updated.status)) return [];
                if (currentViewRef.current === 'completed' && user.role === 'packer' && updated.status !== 'completed') return [];
                updated.task_type = ['pending', 'picking'].includes(updated.status) ? 'pick' : updated.status === 'completed' ? 'done' : 'pack';
                return [updated];
            }));
        };
        const handleTaskDeleted = ({ orderId }) => {
            markChanged();
            setTasks(current => current.filter(task => Number(task.id) !== Number(orderId)));
            setPinnedTaskIds(current => {
                const next = current.filter(id => Number(id) !== Number(orderId));
                if (next.length !== current.length) localStorage.setItem(pinStorageKey, JSON.stringify(next));
                return next;
            });
        };
        const handleUrgentChanged = ({ orderId, isUrgent }) => {
            markChanged();
            setTasks(current => current.map(task => Number(task.id) === Number(orderId) ? { ...task, is_urgent: isUrgent } : task));
        };
        const handleTaskPinChanged = ({ orderId, pinned }) => {
            markChanged();
            setPinnedTaskIds(current => {
                const next = pinned ? (current.includes(orderId) ? current : [...current, orderId]) : current.filter(id => id !== orderId);
                localStorage.setItem(pinStorageKey, JSON.stringify(next));
                return next;
            });
        };
        const events = { new_task: handleNewTask, task_claimed: handleTaskUpdate, task_status_changed: handleTaskUpdate,
            task_deleted: handleTaskDeleted, task_urgent_changed: handleUrgentChanged, task_pin_changed: handleTaskPinChanged };
        Object.entries(events).forEach(([name, handler]) => socket.on(name, handler));
        return () => Object.entries(events).forEach(([name, handler]) => socket.off(name, handler));
    }, [user, pinStorageKey]);

    // Pins are shared across dates/views: a filtered list must not delete them.
    useEffect(() => {
        setSelectedTasks(prev => prev.filter(id => tasks.some(task => task.id === id && canBatchClaim(task, user, batchMode))));
    }, [tasks, user, batchMode]);

    const handleViewOrder = (orderId) => {
        claimContextRef.current += 1;
        navigate(`/order/${orderId}`);
    };

    const handleClaimTask = async (orderId, isContinue) => {
        // One opening flow at a time, including callbacks fired before a rerender.
        if (!mountedRef.current || currentViewRef.current !== 'active' || activeClaimId.current !== null || batchClaimPending.current) return;
        if (isContinue) {
            navigate(`/order/${orderId}`);
            return;
        }
        const claimContext = claimContextRef.current;
        const canFollowUp = () => mountedRef.current && currentViewRef.current === 'active' && claimContextRef.current === claimContext;
        activeClaimId.current = orderId;
        setClaimingId(orderId);
        try {
            await apiClient.post(`/api/orders/${orderId}/claim`, undefined, { timeout: 15000 });
            // The accepted claim remains on the server if the operator has left.
            // Do not redirect their newer workflow or replay the request.
            if (!canFollowUp()) return;
            soundNotification.play('taskClaimed');
            toast.success('任務認領成功，正在開啟訂單');
            navigate(`/order/${orderId}`);
        } catch (error) {
            if (!canFollowUp()) return;
            soundNotification.play('error');
            toast.error(error.response?.data?.message || '認領未確認，請重新整理任務後查看狀態。');
            await fetchTasks();
        } finally {
            activeClaimId.current = null;
            if (mountedRef.current) setClaimingId(null);
        }
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

    const visibleTasks = useMemo(
        () => filterTasks(tasks, { status: statusFilter, urgentOnly, group: taskGroup, user, view: currentView }),
        [tasks, statusFilter, urgentOnly, taskGroup, user, currentView]
    );
    const statusOptions = Object.entries(statusConfig)
        .filter(([status]) => currentView === 'completed'
            ? (user?.role === 'packer' ? status === 'completed' : ['picked', 'packing', 'completed'].includes(status))
            : status !== 'completed' && (user?.role === 'picker' ? ['pending', 'picking'].includes(status) : user?.role === 'packer' ? ['picked', 'packing'].includes(status) : true))
        .map(([value, config]) => ({ value, label: config.text }));
    // 依置頂/緊急排序後，再切分揀貨/裝箱
    const sortedVisibleTasks = useMemo(() => {
        const arr = [...visibleTasks];
        arr.sort((a, b) => {
            const isDispatcher = user?.role === 'dispatcher';
            const aMine = isDispatcher && Number(a?.imported_by_user_id) === Number(user?.id);
            const bMine = isDispatcher && Number(b?.imported_by_user_id) === Number(user?.id);
            const aMineScore = aMine ? 4 : 0;
            const bMineScore = bMine ? 4 : 0;
            const aScore = (pinnedTaskIds.includes(a.id) ? 2 : 0) + (a.is_urgent ? 1 : 0);
            const bScore = (pinnedTaskIds.includes(b.id) ? 2 : 0) + (b.is_urgent ? 1 : 0);
            return (bMineScore + bScore) - (aMineScore + aScore);
        });
        return arr;
    }, [visibleTasks, pinnedTaskIds, user?.role, user?.id]);

    const pickTasks = sortedVisibleTasks.filter(t => t.task_type === 'pick');
    const packTasks = sortedVisibleTasks.filter(t => t.task_type === 'pack');
    // 已完成視圖資料來源為 /api/tasks/completed，但仍用 status 做分類，避免 task_type 缺失/不一致導致顯示錯誤
    const completedTasks = sortedVisibleTasks.filter(t => ['picked', 'packing', 'completed'].includes(t.status));

    // 「已完成」視圖：分成已完成揀貨(待裝箱/裝箱中) vs 已完成裝箱(已完成)
    const completedPickPhaseTasks = useMemo(
        () => completedTasks.filter(t => t.status === 'picked' || t.status === 'packing'),
        [completedTasks]
    );
    const completedPackDoneTasks = useMemo(
        () => completedTasks.filter(t => t.status === 'completed'),
        [completedTasks]
    );

    const statCards = useMemo(() => {
        const personal = user?.role === 'dispatcher' ? ['mine', '我的拋單']
            : ['admin', 'superadmin'].includes(user?.role) ? ['inProgress', '作業中'] : ['mine', '我的任務'];
        const definitions = currentView === 'completed'
            ? [['picked', '揀貨待裝箱', Box, 'from-emerald-500 to-teal-500'], ['done', '已完成裝箱', CheckCircle2, 'from-green-500 to-emerald-500'], ['all', '已完成總數', LayoutDashboard, 'from-blue-500 to-indigo-500']]
            : [['pick', '揀貨任務', Package, 'from-orange-500 to-amber-500'], ['pack', '裝箱任務', Box, 'from-emerald-500 to-teal-500'], ['all', '總任務', LayoutDashboard, 'from-blue-500 to-indigo-500']];
        definitions.push([...personal, User, 'from-purple-500 to-pink-500']);
        return definitions.map(([group, label, icon, color]) => ({ group, label, icon, color,
            value: taskSummary?.[group === 'all' ? 'total' : group] ?? null }));
    }, [currentView, user?.role, taskSummary]);
    useEffect(() => {
        setPickHighlight(true);
        const timer = setTimeout(() => setPickHighlight(false), 800);
        return () => clearTimeout(timer);
    }, [pickTasks.length]);
    const selectedGroupLabel = statCards.find(card => card.group === taskGroup)?.label || '全部任務';


    return (
        <div className="min-h-screen bg-transparent">
            <div className="w-full">
                {/* 頁面標題 + 動作 */}
                <PageHeader
                  title="任務看板"
                  className="relative z-30"
                                    actions={(
                                        <div className="flex flex-wrap items-center gap-2 justify-end">
                      {/* 視圖切換 */}
                      <div className="flex bg-gray-100/80 p-1 rounded-xl mr-2">
                          <button 
                              onClick={() => changeView('active')}
                              aria-pressed={currentView === 'active'}
                              className={`px-3 min-h-11 rounded-lg text-sm font-bold transition-all ${currentView === 'active' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                          >
                              進行中
                          </button>
                          <button 
                              onClick={() => changeView('completed')}
                              aria-pressed={currentView === 'completed'}
                              className={`px-3 min-h-11 rounded-lg text-sm font-bold transition-all ${currentView === 'completed' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                          >
                              已完成
                          </button>
                      </div>

                                            {/* 已完成：日期篩選（預設今天，可選日期） */}
                                            {currentView === 'completed' && (
                                                <div className="flex items-center gap-2 bg-white/50 backdrop-blur-sm rounded-xl px-3 py-1.5 border border-gray-200/50 shadow-sm">
                                                    <label htmlFor="completed-date" className="text-xs font-bold text-gray-600">更新日期</label>
                                                    <input
                                                        id="completed-date"
                                                        type="date"
                                                        value={completedDate}
                                                        onChange={(e) => setCompletedDate(e.target.value || getLocalISODate())}
                                                        className="text-sm bg-white/70 border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                                    />
                                                    <button
                                                        onClick={() => setCompletedDate(getLocalISODate())}
                                                        className="text-xs font-bold text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100/70"
                                                        title="回到今天"
                                                    >
                                                        今天
                                                    </button>
                                                </div>
                                            )}

                      <NotificationCenter onOpenChat={handleOpenChat} />
                      
                      {/* 批次操作按鈕 */}
                      {currentView === 'active' && batchStagesForRole(user).map(stage => (
                        <Button
                            key={stage}
                            variant={batchMode === stage ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => toggleBatchMode(stage)}
                            disabled={isBatchClaiming || claimingId !== null}
                            leadingIcon={ListChecks}
                            aria-pressed={batchMode === stage}
                        >
                          {`${batchMode === stage ? '退出' : ''}批次${stage === 'pack' ? '裝箱' : '揀貨'}`}
                        </Button>
                      ))}

                      {batchMode && selectedTasks.length > 0 && (
                        <Button variant="primary" size="sm" onClick={handleBatchClaim} disabled={isBatchClaiming || claimingId !== null || loading || searchPending} leadingIcon={CheckCircle2} className="animate-in fade-in zoom-in">
                          {isBatchClaiming ? '認領中…' : `認領 ${selectedTasks.length} 個${batchLabel}任務`}
                        </Button>
                      )}




                    </div>
                  )}
                />

                <TaskListFilters
                    search={search} onSearch={setSearch}
                    status={statusFilter} onStatus={setStatusFilter}
                    urgentOnly={urgentOnly} onUrgentOnly={setUrgentOnly}
                    showUrgent={true}
                    statusOptions={statusOptions}
                    total={tasks.length} matched={visibleTasks.length}
                    onReset={resetFilters} onRefresh={refreshTasks} loading={loading || searchPending}
                    serverSearch pageIndex={pageIndex} pageSize={TASK_PAGE_SIZE} hasMore={pageInfo.hasMore}
                />
                {batchMode && <p className="text-sm text-slate-700 mb-4">請勾選待{batchLabel}任務。認領後逐筆開啟作業。</p>}
                {currentView === 'completed' && <p className="text-xs text-slate-600 mb-4">依台灣時間的訂單更新日期查詢；包含已完成揀貨與裝箱的階段，搜尋涵蓋所有符合條件的訂單。</p>}
                {listChanged && !loading && (
                    <div role="status" className="flex flex-wrap items-center justify-between gap-2 mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                        <span>任務有更新，統計與清單可能已變動。請重新整理以取得最新資料。</span>
                        <Button size="sm" variant="secondary" onClick={refreshTasks} disabled={searchPending}>更新任務清單</Button>
                    </div>
                )}
                {loadError && (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-4 mb-6 rounded-xl border border-red-200 bg-red-50 text-red-800">
                        <div className="flex items-start gap-3"><ServerOff size={20} className="shrink-0 mt-0.5" /><div><p className="font-semibold">任務載入失敗</p><p className="text-sm mt-1">{loadError}</p>{tasks.length > 0 && <p className="text-xs mt-1">目前保留上次成功取得的清單，請重新整理確認最新狀態。</p>}</div></div>
                        <Button variant="secondary" size="sm" disabled={loading || searchPending} onClick={fetchTasks}>重試載入</Button>
                    </div>
                )}

                <p className="sr-only">統計涵蓋目前權限、搜尋、狀態與日期條件下的全部任務；點選卡片可篩選下方清單。</p>
                {/* 本頁統計 */}
                                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-3 mb-5">
                                    {statCards.map((c)=>{
                    const Icon = c.icon;
                    return (
                      <button type="button" key={c.group} aria-label={`查看${c.label}`} aria-pressed={taskGroup === c.group}
                        onClick={() => { setTaskGroup(c.group); setSelectedTasks([]); }}
                        className={`corely-task-stat corely-task-stat--${c.group} relative group text-left overflow-hidden bg-white rounded-xl p-3 sm:p-4 border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${taskGroup === c.group ? 'border-blue-600 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-400'}`}>
                        
                        
                        <div className="relative z-10 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">{c.label}</p>
                            <p className={`text-2xl sm:text-3xl font-bold tracking-tight text-gray-900`}>
                                {loading || searchPending ? '…' : c.value === null ? '—' : <NumberTicker value={c.value} />}
                            </p>
                          </div>
                          <div className={`corely-stat-icon w-10 h-10 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center text-white`}>
                            <Icon size={20} />
                          </div>
                        </div>
                        <span className="relative block mt-2 text-xs text-blue-700">{taskGroup === c.group ? '目前顯示' : '查看任務 →'}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <p role="status" className="text-sm font-semibold text-slate-700">目前清單：{selectedGroupLabel}</p>
                    {taskGroup !== 'all' && <button type="button" className="text-sm text-blue-700 underline min-h-9" onClick={() => setTaskGroup('all')}>查看全部分類</button>}
                </div>
                {!loading && !searchPending && !taskSummary && <p role="status" className="text-sm text-amber-700 mb-3">統計暫時無法取得，請重新整理；下方仍可查看已載入的任務。</p>}
                

                {/* 任務列表 */}
                {(loading || searchPending) && (tasks.length === 0 || searchPending) ? (
                    <div aria-busy="true" className="space-y-4">
                        <p role="status" className="text-sm text-slate-600">正在載入任務…</p>
                        {[0, 1, 2].map(index => <div key={index} className="bg-white/70 p-6 rounded-2xl"><Skeleton className="h-6 w-40 mb-4" /><SkeletonText lines={2} /></div>)}
                    </div>
                ) : loadError && tasks.length === 0 ? null : visibleTasks.length === 0 ? (
                    <div className="text-center py-12 px-6 bg-white/75 border border-white rounded-2xl">
                        <Package size={26} className="mx-auto mb-4 text-slate-400" />
                        <h2 className="text-xl font-semibold text-slate-800">{hasFilters ? '沒有符合條件的任務' : currentView === 'completed' ? '這個日期沒有完成階段的任務' : '目前沒有可處理的任務'}</h2>
                        <p className="text-sm text-slate-600 mt-2">{hasFilters ? '可修改單號、客戶或作業狀態，也可以清除篩選。' : currentView === 'completed' ? '請選擇其他更新日期，或回到進行中的任務。' : '收到出貨任務後，選擇「開始揀貨」或「開始裝箱」即可刷條碼核對。'}</p>
                        <div className="flex justify-center gap-3 mt-5">
                            {hasFilters ? <Button variant="secondary" onClick={resetFilters}>清除篩選</Button> : <Button variant="secondary" onClick={fetchTasks}>重新整理任務</Button>}
                            {currentView === 'completed' && <Button variant="secondary" onClick={() => changeView('active')}>查看進行中</Button>}
                            {!hasFilters && currentView === 'active' && ['admin', 'superadmin', 'dispatcher'].includes(user?.role) && <Button onClick={() => navigate('/admin')}>匯入出貨單</Button>}
                        </div>
                    </div>
                ) : currentView === 'active' ? (
                <div className={`grid grid-cols-1 ${['picker', 'packer'].includes(user?.role) ? '' : 'lg:grid-cols-2'} gap-6 lg:gap-8`}>
                    {/* 揀貨任務區 */}
                    {user?.role !== 'packer' && taskGroup !== 'pack' && (
                    <section className="animate-slide-up flex flex-col h-full">
                        <div className="mb-4 lg:sticky lg:top-20 z-20">
                            <div className="bg-orange-50 rounded-xl px-4 py-3 flex items-center justify-between border border-orange-100/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white text-orange-500 flex items-center justify-center shadow-sm">
                                        <Package size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900 leading-none">揀貨任務</h2>
                                        <p className="text-xs text-orange-600/80 font-medium mt-1">待揀貨與正在揀貨的訂單</p>
                                    </div>
                                </div>
                                <span
                                    className={`px-3 py-1 rounded-lg bg-white text-orange-600 text-sm font-bold shadow-sm border border-orange-100 ${pickHighlight ? 'ring-2 ring-orange-400 ring-offset-1' : ''}`}
                                >
                                    {pickTasks.length}
                                </span>
                            </div>
                        </div>
                        
                        <div className="flex flex-col gap-4 flex-1">
                            {pickTasks.length > 0 ? (
                                pickTasks.map((task, index) => (
                                    <div 
                                        key={task.id} 
                                        style={{ animationDelay: `${Math.min(index, 5) * 20}ms` }}
                                        className="animate-fade-in"
                                    >
                                        <ModernTaskCard 
                                            task={task} 
                                            onClaim={handleClaimTask}
                                            isClaiming={claimingId === task.id}
                                            claimDisabled={claimingId !== null || isBatchClaiming}
                                            user={user} 
                                            onDelete={handleDeleteOrder}
                                            batchMode={batchMode}
                                            selectedTasks={selectedTasks}
                                            toggleTaskSelection={toggleTaskSelection}
                                            onOpenChat={handleOpenChat}
                                            isPinned={pinnedTaskIds.includes(task.id)}
                                            onTogglePin={togglePinTask}
                                            onReportDefect={handleReportDefect}
                                            onViewOrder={handleViewOrder}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="h-44 flex flex-col items-center justify-center text-center p-8 glass rounded-2xl border-2 border-dashed border-gray-200/50">
                                    <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                        <Package className="text-gray-300" size={26} />
                                    </div>
                                    <p className="text-gray-500 font-medium">{hasFilters ? '沒有符合條件的揀貨任務' : '目前沒有揀貨任務'}</p>
                                    <p className="text-gray-400 text-sm mt-1">{hasFilters ? '可調整上方搜尋或篩選' : '新揀貨任務會顯示在這裡'}</p>
                                </div>
                            )}
                        </div>
                    </section>
                    )}

                    {/* 裝箱任務區 */}
                    {user?.role !== 'picker' && taskGroup !== 'pick' && (
                    <section className="animate-slide-up flex flex-col h-full" style={{ animationDelay: '100ms' }}>
                        <div className="mb-4 lg:sticky lg:top-20 z-20">
                            <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between border border-emerald-100/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white text-emerald-500 flex items-center justify-center shadow-sm">
                                        <Box size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900 leading-none">裝箱任務</h2>
                                        <p className="text-xs text-emerald-600/80 font-medium mt-1">待裝箱與正在裝箱的訂單</p>
                                    </div>
                                </div>
                                <span
                                    className="px-3 py-1 rounded-lg bg-white text-emerald-600 text-sm font-bold shadow-sm border border-emerald-100"
                                >
                                    {packTasks.length}
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4 flex-1">
                            {packTasks.length > 0 ? (
                                packTasks.map((task, index) => (
                                    <div 
                                        key={task.id} 
                                        style={{ animationDelay: `${Math.min(index, 5) * 20}ms` }}
                                        className="animate-fade-in"
                                    >
                                        <ModernTaskCard 
                                            task={task} 
                                            onClaim={handleClaimTask}
                                            isClaiming={claimingId === task.id}
                                            claimDisabled={claimingId !== null || isBatchClaiming}
                                            user={user} 
                                            onDelete={handleDeleteOrder}
                                            batchMode={batchMode}
                                            selectedTasks={selectedTasks}
                                            toggleTaskSelection={toggleTaskSelection}
                                            onOpenChat={handleOpenChat}
                                            isPinned={pinnedTaskIds.includes(task.id)}
                                            onTogglePin={togglePinTask}
                                            onReportDefect={handleReportDefect}
                                            onViewOrder={handleViewOrder}
                                        />
                                    </div>
                                ))
                            ) : (
                                <div className="h-44 flex flex-col items-center justify-center text-center p-8 glass rounded-2xl border-2 border-dashed border-gray-200/50">
                                    <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                        <Box className="text-gray-300" size={26} />
                                    </div>
                                    <p className="text-gray-500 font-medium">{hasFilters ? '沒有符合條件的裝箱任務' : '目前沒有裝箱任務'}</p>
                                    <p className="text-gray-400 text-sm mt-1">{hasFilters ? '可調整上方搜尋或篩選' : '完成揀貨後，任務會進入裝箱階段'}</p>
                                </div>
                            )}
                        </div>
                    </section>
                    )}
                </div>
                ) : (
                    <div className="space-y-6">
                        <div className="glass-panel rounded-2xl p-1.5 mb-4 shadow-lg">
                            <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between border border-green-100/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white text-green-500 flex items-center justify-center shadow-sm">
                                        <CheckCircle2 size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900 leading-none">已完成任務</h2>
                                        <p className="text-xs text-green-600/80 font-medium mt-1">{completedDate} 更新的訂單</p>
                                    </div>
                                </div>
                                <span className="px-3 py-1 rounded-lg bg-white text-green-600 text-sm font-bold shadow-sm border border-green-100">
                                    {completedTasks.length}
                                </span>
                            </div>
                        </div>

                        {completedTasks.length === 0 ? (
                            <div className="h-44 flex flex-col items-center justify-center text-center p-8 glass rounded-2xl border-2 border-dashed border-gray-200/50">
                                <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                    <CheckCircle2 className="text-gray-300" size={26} />
                                </div>
                                <p className="text-gray-500 font-medium">尚無已完成任務</p>
                                <p className="text-gray-400 text-sm mt-1">完成的任務將會顯示在這裡</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
                                {/* 左欄：已完成揀貨（待裝箱/裝箱中） */}
                                <section className="flex flex-col">
                                    <div className="glass-panel rounded-2xl p-1.5 shadow-lg mb-4 lg:sticky lg:top-20 z-20">
                                        <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between border border-emerald-100/50">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-white text-emerald-500 flex items-center justify-center shadow-sm">
                                                    <Box size={20} />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-gray-900 leading-none">已完成揀貨</h3>
                                                    <p className="text-xs text-emerald-600/80 font-medium mt-1">待裝箱／裝箱中</p>
                                                </div>
                                            </div>
                                            <span className="px-3 py-1 rounded-lg bg-white text-emerald-600 text-sm font-bold shadow-sm border border-emerald-100">
                                                {completedPickPhaseTasks.length}
                                            </span>
                                        </div>
                                    </div>

                                    {completedPickPhaseTasks.length === 0 ? (
                                        <div className="h-48 flex flex-col items-center justify-center text-center p-8 glass rounded-2xl border border-white/30">
                                            <p className="text-gray-500 font-medium">目前沒有揀貨待裝箱的訂單</p>
                                            <p className="text-gray-400 text-sm mt-1">完成揀貨後會顯示在這裡</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-6">
                                            {completedPickPhaseTasks.map((task, index) => (
                                                <div
                                                    key={task.id}
                                                    style={{ animationDelay: `${Math.min(index, 5) * 20}ms` }}
                                                    className="animate-fade-in"
                                                >
                                                    <ModernTaskCard
                                                        task={task}
                                                        user={user}
                                                        onClaim={() => {}}
                                                        viewMode="completed"
                                                        onViewOrder={handleViewOrder}
                                                        onDelete={handleDeleteOrder}
                                                        batchMode={false}
                                                        selectedTasks={[]}
                                                        toggleTaskSelection={() => {}}
                                                        onOpenChat={handleOpenChat}
                                                        isPinned={pinnedTaskIds.includes(task.id)}
                                                        onTogglePin={togglePinTask}
                                                        onReportDefect={handleReportDefect}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                {/* 右欄：已完成裝箱（訂單已完成） */}
                                <section className="flex flex-col">
                                    <div className="glass-panel rounded-2xl p-1.5 shadow-lg mb-4 lg:sticky lg:top-20 z-20">
                                        <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between border border-green-100/50">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-white text-green-500 flex items-center justify-center shadow-sm">
                                                    <CheckCircle2 size={20} />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-gray-900 leading-none">已完成裝箱</h3>
                                                    <p className="text-xs text-green-600/80 font-medium mt-1">訂單已完成</p>
                                                </div>
                                            </div>
                                            <span className="px-3 py-1 rounded-lg bg-white text-green-600 text-sm font-bold shadow-sm border border-green-100">
                                                {completedPackDoneTasks.length}
                                            </span>
                                        </div>
                                    </div>

                                    {completedPackDoneTasks.length === 0 ? (
                                        <div className="h-48 flex flex-col items-center justify-center text-center p-8 glass rounded-2xl border border-white/30">
                                            <p className="text-gray-500 font-medium">目前沒有已完成裝箱的訂單</p>
                                            <p className="text-gray-400 text-sm mt-1">訂單完成後會顯示在這裡</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-6">
                                            {completedPackDoneTasks.map((task, index) => (
                                                <div
                                                    key={task.id}
                                                    style={{ animationDelay: `${Math.min(index, 5) * 20}ms` }}
                                                    className="animate-fade-in"
                                                >
                                                    <ModernTaskCard
                                                        task={task}
                                                        user={user}
                                                        onClaim={() => {}}
                                                        viewMode="completed"
                                                        onViewOrder={handleViewOrder}
                                                        onDelete={handleDeleteOrder}
                                                        batchMode={false}
                                                        selectedTasks={[]}
                                                        toggleTaskSelection={() => {}}
                                                        onOpenChat={handleOpenChat}
                                                        isPinned={pinnedTaskIds.includes(task.id)}
                                                        onTogglePin={togglePinTask}
                                                        onReportDefect={handleReportDefect}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>
                        )}
                    </div>
                )}

                <nav aria-label="任務分頁" className="flex flex-wrap items-center justify-between gap-3 mt-6 rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-600">第 {pageIndex + 1} 頁 · 本頁 {visibleTasks.length} 筆 · 每頁最多 {TASK_PAGE_SIZE} 筆{!loading && !searchPending && !loadError && !pageInfo.hasMore ? ' · 已到最後一頁' : ''}</p>
                    <div className="flex gap-2">
                        <Button variant="secondary" size="sm" className="min-h-11" disabled={pageIndex === 0 || loading || searchPending} onClick={() => changePage(-1)}>上一頁</Button>
                        <Button variant="secondary" size="sm" className="min-h-11" disabled={!pageInfo.hasMore || loading || searchPending || listChanged || Boolean(loadError)} onClick={() => changePage(1)}>下一頁</Button>
                    </div>
                </nav>

            </div>

            {/* Defect Report Modal */}
            <DefectReportModal
                isOpen={defectModalOpen}
                onClose={() => setDefectModalOpen(false)}
                orderId={defectTask?.id}
                voucherNumber={defectTask?.voucher_number}
                onSuccess={fetchTasks}
            />

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
