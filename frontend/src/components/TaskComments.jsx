// frontend/src/components/TaskComments.jsx
// 任務評論系統 - 優化版（優先級、置頂、搜尋、未讀提示）

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { socket } from '@/api/socket';
import { VariableSizeList as List } from 'react-window';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { 
    MessageSquare, Send, User, AtSign, Reply, Loader2, 
    Pin, AlertCircle, Clock, CheckCircle2, Search, X,
    Star, Bell, Filter, Paperclip, Upload, Image as ImageIcon,
    TrendingUp, Users, ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api';
import { useComments } from '@/api/useComments';
import DesktopNotification from '@/utils/desktopNotification';
import SoundNotification from '@/utils/soundNotification';
import { Button } from '@/ui';

// 優先級配置
const PRIORITIES = {
    urgent: { 
        label: '🔴 緊急', 
        color: 'bg-red-100 text-red-700 border-red-300',
        dotColor: 'bg-red-500',
        icon: AlertCircle,
        bgGlow: 'bg-red-50 border-l-4 border-l-red-500'
    },
    important: { 
        label: '⭐ 重要', 
        color: 'bg-amber-100 text-amber-700 border-amber-300',
        dotColor: 'bg-amber-500',
        icon: Star,
        bgGlow: 'bg-amber-50 border-l-4 border-l-amber-500'
    },
    normal: { 
        label: '💬 一般', 
        color: 'bg-blue-100 text-blue-700 border-blue-300',
        dotColor: 'bg-blue-500',
        icon: MessageSquare,
        bgGlow: ''
    }
};

// 快速回覆模板
const QUICK_REPLIES = [
    { text: '✅ 已確認', priority: 'normal' },
    { text: '👍 收到，處理中', priority: 'normal' },
    { text: '⏳ 需要時間處理', priority: 'important' },
    { text: '❓ 需要更多資訊', priority: 'important' },
    { text: '✔️ 已完成', priority: 'normal' },
    { text: '🚨 緊急！需立即處理', priority: 'urgent' },
    { text: '🔄 等待上級回覆', priority: 'important' },
    { text: '📋 已記錄', priority: 'normal' }
];

export function TaskComments({ orderId, currentUser, allUsers }) {
    const { data, isLoading, fetchNextPage, hasNextPage, addOptimistic, invalidate } = useComments(orderId);
    const comments = (data?.pages || []).flatMap(p => p.items ?? []);
    const [newComment, setNewComment] = useState('');
    const [replyTo, setReplyTo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [cursorPosition, setCursorPosition] = useState(0);
    const [priority, setPriority] = useState('normal');
    const [showQuickReplies, setShowQuickReplies] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterPriority, setFilterPriority] = useState('all');
    const [filterUnread, setFilterUnread] = useState(false);
    const [pinnedComments, setPinnedComments] = useState([]);
    const [inlineStatus, setInlineStatus] = useState(null); // {type:'success'|'error', message:string}
    const lastPayloadRef = useRef(null);
    const mentionPulseRef = useRef(new Set());
    const notifierRef = useRef(null);
    const soundRef = useRef(null);
    const [mentionsOpen, setMentionsOpen] = useState(false);
    const [mentions, setMentions] = useState([]);
    const [mentionsUnread, setMentionsUnread] = useState(0);
    
    const textareaRef = useRef(null);
    const mentionsRef = useRef(null);
    const commentsEndRef = useRef(null);
    const listRef = useRef(null);
    const shouldScrollBottomRef = useRef(false);
    const sizeMapRef = useRef({});
    const getSize = (index) => sizeMapRef.current[index] ?? 180;
    const setSize = (index, size) => {
        const next = Math.max(120, Math.ceil(size));
        if (sizeMapRef.current[index] !== next) {
            sizeMapRef.current[index] = next;
            // 避免整個清單強制更新，降低輸入時抖動
            listRef.current?.resetAfterIndex(index, false);
        }
    };

    useEffect(() => {
        // 初始化：先讀本地，盡快呈現；再從雲端同步覆蓋
        try {
            const pinned = JSON.parse(localStorage.getItem(`pinned_comments_${orderId}`) || '[]');
            setPinnedComments(Array.isArray(pinned) ? pinned : []);
        } catch { setPinnedComments([]); }

        // 從伺服器同步置頂清單（雲端化）
        (async () => {
            try {
                const res = await apiClient.get(`/api/tasks/${orderId}/pins`);
                const list = Array.isArray(res?.data?.pinned) ? res.data.pinned : [];
                setPinnedComments(list);
                localStorage.setItem(`pinned_comments_${orderId}`, JSON.stringify(list));
            } catch (e) {
                // 失敗不影響本地行為
            }
        })();
    }, [orderId]);

    useEffect(() => {
        // 降低備援輪詢頻率（主要依賴 WebSocket）
        const interval = setInterval(() => invalidate(), 60000);

        // 啟用 WebSocket 監聽新評論
        try {
            if (!socket.connected) socket.connect();
            const onNewComment = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
                    fetchMentions();
                }
            };
            const onNewMention = (payload) => {
                if (String(payload.orderId) === String(orderId) && Number(payload.userId) === Number(currentUser.id)) {
                    mentionPulseRef.current.add(payload.commentId);
                    try {
                        if (!notifierRef.current) notifierRef.current = new DesktopNotification();
                        notifierRef.current.show('有人提及了你', {
                            body: payload.content || '新提及',
                            duration: 4000,
                            onClick: () => jumpToCommentId(payload.commentId)
                        });
                    } catch {}
                    try {
                        if (!soundRef.current) soundRef.current = new SoundNotification();
                        soundRef.current.play('newTask');
                    } catch {}
                    invalidate();
                    fetchMentions();
                }
            };
            const onCommentDeleted = (payload) => {
                if (String(payload.orderId) === String(orderId)) { invalidate(); fetchMentions(); }
            };
            const onCommentRetracted = (payload) => {
                if (String(payload.orderId) === String(orderId)) { invalidate(); fetchMentions(); }
            };
            socket.on('new_comment', onNewComment);
            socket.on('new_mention', onNewMention);
            socket.on('comment_deleted', onCommentDeleted);
            socket.on('comment_retracted', onCommentRetracted);
            return () => {
                clearInterval(interval);
                socket.off('new_comment', onNewComment);
                socket.off('new_mention', onNewMention);
                socket.off('comment_deleted', onCommentDeleted);
                socket.off('comment_retracted', onCommentRetracted);
            };
        } catch (e) {
            // 若 socket 初始化失敗，不影響頁面其它功能
            return () => clearInterval(interval);
        }
    }, [orderId]);

    useEffect(() => {
        // 點擊外部關閉提及列表
        const handleClickOutside = (event) => {
            if (mentionsRef.current && !mentionsRef.current.contains(event.target)) {
                setShowMentions(false);
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 僅在需要時才自動滾動到底（例如送出成功後）
    useEffect(() => {
        if (shouldScrollBottomRef.current) {
            if (listRef.current && typeof listRef.current.scrollToItem === 'function') {
                // 嘗試捲到一般留言的最後一筆
                const lastIndex = Math.max(0, normalList.length - 1);
                listRef.current.scrollToItem(lastIndex, 'end');
            } else {
                commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
            shouldScrollBottomRef.current = false;
        }
    }, [comments]);

    const fetchComments = async () => {
        // 已改由 React Query 管理；這個函數保留舊呼叫點
        await invalidate();
        const pinned = JSON.parse(localStorage.getItem(`pinned_comments_${orderId}`) || '[]');
        setPinnedComments(pinned);
    };

    const fetchMentions = async () => {
        try {
            const res = await apiClient.get(`/api/tasks/${orderId}/mentions?status=unread&limit=20`);
            setMentions(res.data.items || []);
            setMentionsUnread(res.data.total || 0);
        } catch (e) { /* ignore */ }
    };

    useEffect(() => { fetchMentions(); }, [orderId]);

    const handleInputChange = (e) => {
        const value = e.target.value;
        const position = e.target.selectionStart;
        
        setNewComment(value);
        setCursorPosition(position);

        // 檢測 @ 符號
        const textBeforeCursor = value.slice(0, position);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        
        if (lastAtIndex !== -1) {
            const afterAt = textBeforeCursor.slice(lastAtIndex + 1);
            
            // 如果 @ 後面沒有空格，顯示提及列表
            if (!afterAt.includes(' ')) {
                setMentionFilter(afterAt.toLowerCase());
                setShowMentions(true);
            } else {
                setShowMentions(false);
            }
        } else {
            setShowMentions(false);
        }
    };

    const insertMention = (user) => {
        const textBeforeCursor = newComment.slice(0, cursorPosition);
        const textAfterCursor = newComment.slice(cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        
        const newText = 
            textBeforeCursor.slice(0, lastAtIndex) + 
            `@${user.username} ` + 
            textAfterCursor;
        
        setNewComment(newText);
        setShowMentions(false);
        textareaRef.current?.focus();
    };

    const useQuickReply = (reply) => {
        setNewComment(reply.text);
        setPriority(reply.priority);
        setShowQuickReplies(false);
        textareaRef.current?.focus();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!newComment.trim()) {
            toast.error('請輸入評論內容');
            return;
        }

        if (loading) return; // 防重複點擊
        setLoading(true);
        try {
            const draft = {
                id: `temp_${Date.now()}`,
                content: newComment,
                parent_id: replyTo?.id || null,
                priority,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                user_id: currentUser.id,
                username: currentUser.username,
                user_name: currentUser.name,
                replies: [],
                __optimistic: true,
            };
            addOptimistic(draft);

            const payload = {
                content: newComment,
                parent_id: replyTo?.id || null,
                priority: priority
            };
            lastPayloadRef.current = payload;
            await apiClient.post(`/api/tasks/${orderId}/comments`, payload);
            
            setNewComment('');
            setReplyTo(null);
            setPriority('normal');
            await invalidate();
            // 發送成功後再捲到底，避免背景重新整理時誤觸頁面跳動
            shouldScrollBottomRef.current = true;
            setInlineStatus({ type: 'success', message: '已發送評論' });
            setTimeout(() => setInlineStatus(null), 1600);
        } catch (error) {
            // 還原暫時卡片
            await invalidate();
            setInlineStatus({ type: 'error', message: error.message || '發送失敗，請重試' });
        } finally {
            setLoading(false);
        }
    };

    const togglePin = async (commentId) => {
        const willPin = !pinnedComments.includes(commentId);
        const optimistic = willPin
            ? [...pinnedComments, commentId]
            : pinnedComments.filter(id => id !== commentId);
        setPinnedComments(optimistic);
        localStorage.setItem(`pinned_comments_${orderId}`, JSON.stringify(optimistic));
        try {
            await apiClient.put(`/api/tasks/${orderId}/pins/${commentId}`, { pinned: willPin });
            toast.success(willPin ? '已置頂評論' : '已取消置頂');
        } catch (e) {
            // 還原
            const reverted = !willPin
                ? [...pinnedComments, commentId]
                : pinnedComments.filter(id => id !== commentId);
            setPinnedComments(reverted);
            localStorage.setItem(`pinned_comments_${orderId}`, JSON.stringify(reverted));
            toast.error(e?.message || '更新置頂狀態失敗');
        }
    };

    const filteredUsers = allUsers.filter(user => 
        user.id !== currentUser.id &&
        (user.username.toLowerCase().includes(mentionFilter) ||
         user.name.toLowerCase().includes(mentionFilter))
    );

    // 過濾評論
    const filteredComments = comments.filter(comment => {
        // 搜尋過濾
        if (searchTerm && !comment.content.toLowerCase().includes(searchTerm.toLowerCase()) &&
            !comment.username.toLowerCase().includes(searchTerm.toLowerCase())) {
            return false;
        }
        
        // 優先級過濾
        if (filterPriority !== 'all' && comment.priority !== filterPriority) {
            return false;
        }
        
        // 未讀過濾（簡化版：24小時內且不是自己的）
        if (filterUnread) {
            const isRecent = new Date(comment.created_at) > new Date(Date.now() - 24*60*60*1000);
            const notMine = comment.user_id !== currentUser.id;
            if (!isRecent || !notMine) return false;
        }
        
        return true;
    });

    // 分離置頂和普通評論
    const pinnedListRaw = filteredComments.filter(c => pinnedComments.includes(c.id) && !c.parent_id);
    const normalListRaw = filteredComments.filter(c => !pinnedComments.includes(c.id) && !c.parent_id);
    // 各自去重（避免跨頁重複）
    const pinnedSeen = new Set();
    const pinnedList = pinnedListRaw.filter(c => {
        if (!c?.id || pinnedSeen.has(c.id)) return false;
        pinnedSeen.add(c.id);
        return true;
    }).map(c => ({ ...c, __pinned: true }));
    const normalSeen = new Set();
    const normalList = normalListRaw.filter(c => {
        if (!c?.id || normalSeen.has(c.id)) return false;
        normalSeen.add(c.id);
        return true;
    });

    // 未讀計數
    const unreadCount = comments.filter(c => {
        const isRecent = new Date(c.created_at) > new Date(Date.now() - 24*60*60*1000);
        const notMine = c.user_id !== currentUser.id;
        return isRecent && notMine;
    }).length;

    const highlightMentions = (text) => {
        const mentionRegex = /@(\w+)/g;
        const parts = text.split(mentionRegex);
        
        return parts.map((part, index) => {
            if (index % 2 === 1) {
                // 這是 @ 提及的用戶名
                return (
                    <span 
                        key={index} 
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-apple-blue/20 text-apple-blue rounded-full text-sm font-medium"
                    >
                        <AtSign className="w-3 h-3" />
                        {part}
                    </span>
                );
            }
            return <span key={index}>{part}</span>;
        });
    };

    const markMentionRead = async (commentId) => {
        try {
            await apiClient.patch(`/api/tasks/${orderId}/mentions/${commentId}/read`);
            mentionPulseRef.current.delete(commentId);
            await invalidate();
        } catch {}
    };

    const jumpToCommentId = (commentId) => {
        // 嘗試捲到 pinned
        const pinnedEl = document.getElementById(`comment-${commentId}`);
        if (pinnedEl) {
            pinnedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            markMentionRead(commentId);
            return;
        }
        const idx = normalList.findIndex(c => c.id === commentId);
        if (idx >= 0) {
            listRef.current?.scrollToItem(idx, 'center');
            // 等待渲染後再標記
            setTimeout(() => markMentionRead(commentId), 300);
        }
    };

    const handleReplyClick = (comment) => {
        setReplyTo(comment);
        const mentionTarget = `@${comment.username || comment.user_name} `;
        setNewComment((prev) => {
            if (!prev) return mentionTarget;
            return prev.includes(mentionTarget) ? prev : `${prev}\n${mentionTarget}`;
        });
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const renderComment = (comment, isReply = false, isPinned = false) => {
        const commentPriority = PRIORITIES[comment.priority || 'normal'];
        const PriorityIcon = commentPriority.icon;
        const shouldAnimate = !!comment.__optimistic;
        const displayName = comment.user_name || comment.username || '未知用戶';
        const isUrgent = comment.priority === 'urgent';
        // 單一泡泡寬度（依需求統一 75%），回覆略縮
        const bubbleBase = 'max-w-[75%] px-4 py-3 rounded-2xl shadow-sm bg-gray-100 text-gray-800';
        const replyNarrow = isReply ? 'max-w-[76%]' : '';
        const header = (
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-apple-blue/20 to-apple-purple/20 flex items-center justify-center">
                        <User className="w-4 h-4 text-apple-blue" />
                    </div>
                    <div className="text-sm font-semibold text-gray-800">{displayName}</div>
                </div>
                <div className="text-[11px] text-gray-400 whitespace-nowrap">
                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: zhTW })}
                </div>
            </div>
        );

        const metaChips = (
            <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-1">
                {isPinned && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full border border-amber-300">
                        <Pin className="w-3 h-3" /> 已置頂
                    </span>
                )}
                {comment.priority && comment.priority !== 'normal' && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${commentPriority.color}`}>
                        <PriorityIcon className="w-3 h-3" /> {commentPriority.label}
                    </span>
                )}
                {comment.mentioned_me && !comment.mention_is_read && (
                    <button type="button" onClick={(e)=>{ e.stopPropagation(); jumpToCommentId(comment.id); }} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-blue-300 text-blue-700 bg-blue-50 ${mentionPulseRef.current.has(comment.id) ? 'animate-pulse ring-2 ring-blue-300' : ''}`}>
                        <AtSign className="w-3 h-3" /> 提及你
                    </button>
                )}
            </div>
        );

        const actions = (
            <div className="flex items-center gap-1.5 opacity-0 group-hover/thread:opacity-100 transition-opacity">
                <button
                    onClick={() => togglePin(comment.id)}
                    className={`px-1.5 py-0.5 rounded-md transition-colors ${isPinned ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                    title={isPinned ? '取消置頂' : '置頂評論'}
                >
                    <Pin className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={() => handleReplyClick(comment)}
                    className="px-1.5 py-0.5 text-gray-400 hover:bg-apple-blue/10 hover:text-apple-blue rounded-md"
                    title="回覆"
                >
                    <Reply className="w-3.5 h-3.5" />
                </button>
                {((currentUser?.id && currentUser.id === comment.user_id) || (currentUser?.role === 'admin')) && (
                    <>
                        <button
                            onClick={async () => {
                                try {
                                    await apiClient.patch(`/api/tasks/${orderId}/comments/${comment.id}/retract`);
                                    toast.success('已撤回評論');
                                    await invalidate();
                                } catch (e) { toast.error(e.message || '撤回失敗'); }
                            }}
                            className="px-1.5 py-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 rounded-md"
                            title="撤回"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={async () => {
                                if (!confirm('確定要刪除這則評論嗎？（回覆也會一併刪除）')) return;
                                try {
                                    await apiClient.delete(`/api/tasks/${orderId}/comments/${comment.id}`);
                                    toast.success('已刪除評論');
                                    await invalidate();
                                } catch (e) { toast.error(e.message || '刪除失敗'); }
                            }}
                            className="px-1.5 py-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-md"
                            title="刪除"
                        >
                            <TrashIcon />
                        </button>
                    </>
                )}
            </div>
        );

        // 訊息泡泡（含緊急雙重高亮：左側 3px 紅條 + 淡紅背景）
        const bubble = (
            <div className="relative mt-2">
                {isUrgent && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#FF3B30] rounded-full" />}
                <div className={`ml-2 ${bubbleBase} ${replyNarrow} ${isUrgent ? 'bg-[rgba(255,59,48,0.10)] text-red-800' : ''}`}>
                    <div className="whitespace-pre-wrap break-words leading-relaxed">
                        {highlightMentions(comment.content === '[已撤回]' ? '此評論已撤回' : comment.content)}
                    </div>
                </div>
            </div>
        );

        if (!isReply) {
            const highlight = replyTo?.id === comment.id ? 'ring-2 ring-apple-blue/40' : '';
            const isPinnedThread = isPinned;
            const isUrgentThread = isUrgent; // 以主訊息優先級代表整個 thread 是否緊急
            return (
                <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    className={`group/thread relative bg-white border border-gray-200 rounded-2xl shadow-sm p-5 transition-all ${highlight} ${shouldAnimate ? 'animate-scale-in' : ''} ${isPinnedThread ? 'hover:shadow-lg hover:scale-[1.015]' : 'hover:shadow-md'}`}
                >
                    {/* 左側垂直高亮條：Pinned 黃色 / Urgent 紅色 + 呼吸動畫 */}
                    <div className={`absolute left-0 top-0 bottom-0 w-[5px] rounded-l-2xl
                        ${isUrgentThread ? 'bg-[#FF3B30] animate-[pulse_2.4s_ease-in-out_infinite]' : (isPinnedThread ? 'bg-amber-400' : 'bg-transparent')}`}
                    />
                    {/* 右上角 Pin 圖示（置頂） */}
                    {isPinnedThread && (
                        <div className="absolute top-2 right-3 text-amber-500">
                            <Pin className="w-4 h-4" />
                        </div>
                    )}
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                            {header}
                            {metaChips}
                            {bubble}
                        </div>
                        {actions}
                    </div>
                    {/* 巢狀回覆區：左側連接線（細灰線），每條回覆再套泡泡樣式 */}
                    {comment.replies && comment.replies.length > 0 && (
                        <div className="mt-4 ml-8 pl-5 border-l border-gray-200 space-y-3">
                            {comment.replies.map(reply => (
                                <div key={reply.id} className="relative">
                                    {/* 連接節點小圓點 */}
                                    <div className="absolute -left-[11px] top-4 w-2 h-2 rounded-full bg-gray-300" />
                                    {renderComment(reply, true)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        // 子回覆：精簡樣式，仍保留頭像/名稱/時間戳與泡泡
        return (
            <div key={comment.id} id={`comment-${comment.id}`} className={`group/reply ${shouldAnimate ? 'animate-scale-in' : ''}`}>
                {header}
                {bubble}
                <div className="mt-1">{actions}</div>
            </div>
        );
    };

    // 輕量 TrashIcon（避免額外引入整個套件）
    const TrashIcon = () => (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
        </svg>
    );

    return (
        <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-white">
            {/* 標題欄（行動裝置固定在頂端，方便篩選） */}
            <div className="glass-card p-4 border-b border-gray-200 sticky top-0 z-10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-apple-purple/20 to-apple-blue/20 rounded-xl">
                            <MessageSquare className="w-5 h-5 text-apple-purple" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">任務討論</h3>
                            <p className="text-sm text-gray-500">
                                {comments.length} 則評論
                                {unreadCount > 0 && (
                                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-medium">
                                        <Bell className="w-3 h-3" />
                                        {unreadCount} 則未讀
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    {/* 提及收件匣按鈕 */}
                                        <Button variant="secondary" size="sm" onClick={() => setMentionsOpen(!mentionsOpen)} leadingIcon={AtSign}>
                                            提及
                                            {mentionsUnread > 0 && (
                                                <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[11px] font-semibold">
                                                    {mentionsUnread}
                                                </span>
                                            )}
                                        </Button>
                </div>

                {/* 搜尋和篩選欄 */}
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                    {/* 搜尋框 */}
                    <div className="flex-1 min-w-[200px] relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="搜尋評論..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-white/80 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-apple-blue/50 focus:border-apple-blue transition-all"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>

                    {/* 優先級篩選 */}
                    <div className="flex items-center gap-1 bg-white/80 border border-gray-300 rounded-xl p-1">
                        <button
                            onClick={() => setFilterPriority('all')}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                                filterPriority === 'all'
                                    ? 'bg-apple-blue text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            全部
                        </button>
                        {Object.entries(PRIORITIES).map(([key, config]) => {
                            const Icon = config.icon;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setFilterPriority(key)}
                                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                                        filterPriority === key
                                            ? config.color.replace('100', '200')
                                            : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                    title={config.label}
                                >
                                    <Icon className="w-3 h-3" />
                                </button>
                            );
                        })}
                    </div>

                    {/* 未讀篩選 */}
                    <button
                        onClick={() => setFilterUnread(!filterUnread)}
                        className={`px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 border ${
                            filterUnread
                                ? 'bg-red-100 text-red-600 border-red-300'
                                : 'bg-white/80 text-gray-600 border-gray-300 hover:bg-gray-100'
                        }`}
                    >
                        <Bell className="w-3 h-3" />
                        僅未讀
                    </button>
                </div>
            </div>
            {/* 提及收件匣面板 */}
            {mentionsOpen && (
                <div className="absolute z-50 right-4 top-20 w-80 max-h-96 overflow-auto bg-white border border-gray-200 rounded-xl shadow-apple-xl">
                    <div className="px-3 py-2 text-sm font-medium text-gray-700 border-b">提及收件匣</div>
                    {mentions.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500">沒有未讀提及</div>
                    ) : (
                        <div className="divide-y">
                            {mentions.map((m) => (
                                <button
                                    key={m.comment_id}
                                    className="w-full text-left px-3 py-2 hover:bg-gray-50"
                                    onClick={() => { setMentionsOpen(false); jumpToCommentId(m.comment_id); }}
                                >
                                    <div className="text-xs text-gray-500">@{m.username} • {formatDistanceToNow(new Date(m.comment_created_at || m.created_at), { addSuffix: true, locale: zhTW })}</div>
                                    <div className="text-sm text-gray-800 line-clamp-2">{m.content}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 評論列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading && (
                    <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="animate-pulse p-4 bg-white border border-gray-200 rounded-xl">
                                <div className="h-3 bg-gray-200 rounded w-1/3 mb-3" />
                                <div className="h-3 bg-gray-200 rounded w-full mb-2" />
                                <div className="h-3 bg-gray-200 rounded w-2/3" />
                            </div>
                        ))}
                    </div>
                )}
                {pinnedList.length + normalList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                        <MessageSquare className="w-12 h-12 mb-3 opacity-50" />
                        <p className="text-sm">
                            {searchTerm || filterPriority !== 'all' || filterUnread
                                ? '沒有符合條件的評論'
                                : '尚無評論，開始第一則討論吧！'}
                        </p>
                        {/* 快捷建議 chips */}
                        <div className="mt-4 flex flex-wrap gap-2">
                            {QUICK_REPLIES.slice(0,4).map((r,idx) => (
                                <button key={idx} aria-label={`插入 ${r.text}`} onClick={() => useQuickReply(r)} className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-xs text-gray-700 transition-all hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-apple-blue/50">
                                    {r.text}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {/* 置頂區塊（非虛擬化） */}
                        {pinnedList.length > 0 && (
                            <div className="space-y-2">
                                {pinnedList.map(c => (
                                    <div key={c.id}>{renderComment(c, false, true)}</div>
                                ))}
                            </div>
                        )}
                        {/* 一般留言（虛擬化，可變高度） */}
                        {normalList.length > 0 && (
                            <List
                                ref={listRef}
                                height={420}
                                itemCount={normalList.length}
                                itemSize={getSize}
                                width={'100%'}
                                overscanCount={5}
                            >
                                {({ index, style }) => (
                                    <Row
                                        style={style}
                                        index={index}
                                        item={normalList[index]}
                                        measure={(h) => setSize(index, h)}
                                        render={renderComment}
                                    />
                                )}
                            </List>
                        )}
                    </>
                )}
                {hasNextPage && (
                    <div className="flex justify-center py-3">
                        <Button variant="secondary" size="xs" className="rounded-full gap-1.5 px-3 py-1" onClick={() => fetchNextPage()} aria-label="載入更多評論" leadingIcon={ChevronDown}>
                            載入更多
                        </Button>
                    </div>
                )}
                <div ref={commentsEndRef} />
            </div>

            {/* 輸入區域（加入安全區 padding） */}
            <div className="glass-card p-4 border-t border-gray-200 pb-[max(env(safe-area-inset-bottom),0px)]">
                {/* 內嵌狀態提示 */}
                {inlineStatus && (
                    <div className={`mb-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${inlineStatus.type==='success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`} role="status" aria-live="polite">
                        <span>{inlineStatus.message}</span>
                        {inlineStatus.type==='error' && lastPayloadRef.current && (
                            <button
                                type="button"
                                onClick={async ()=>{
                                    if (loading) return;
                                    try {
                                        setLoading(true);
                                        await apiClient.post(`/api/tasks/${orderId}/comments`, lastPayloadRef.current);
                                        setInlineStatus({ type: 'success', message: '已發送評論' });
                                        setTimeout(() => setInlineStatus(null), 1600);
                                        setNewComment(''); setReplyTo(null); setPriority('normal');
                                        await invalidate();
                                    } catch (e) {
                                        setInlineStatus({ type: 'error', message: e.message || '重試仍失敗' });
                                    } finally { setLoading(false); }
                                }}
                                className="ml-auto px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-apple-blue/50"
                                aria-label="重試發送評論"
                            >
                                重試
                            </button>
                        )}
                    </div>
                )}
                {/* 回覆提示 */}
                {replyTo && (
                    <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-apple-blue/10 rounded-lg text-sm">
                        <Reply className="w-4 h-4 text-apple-blue" />
                        <span className="text-gray-700">
                            回覆 <span className="font-semibold">{replyTo.username}</span>
                        </span>
                        <button
                            onClick={() => setReplyTo(null)}
                            className="ml-auto text-gray-400 hover:text-gray-600"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* 優先級 Chips */}
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-500 tracking-wide">優先級</span>
                    {Object.entries(PRIORITIES).map(([key, config]) => {
                        const Icon = config.icon;
                        const active = priority === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setPriority(key)}
                                className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all focus:outline-none focus:ring-2 focus:ring-apple-blue/40 ${
                                    active
                                        ? `${config.color} shadow-sm scale-[1.05]`
                                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                }`}
                                aria-pressed={active}
                                aria-label={`設定優先級為 ${config.label}`}
                            >
                                <Icon className={`w-3 h-3 ${active ? 'opacity-100' : 'opacity-70 group-hover:opacity-90'}`} />
                                {config.label}
                            </button>
                        );
                    })}
                </div>

                {/* 快速回覆按鈕 */}
                <div className="mb-3">
                    <button
                        onClick={() => setShowQuickReplies(!showQuickReplies)}
                        className="text-xs text-apple-blue hover:text-apple-blue/80 flex items-center gap-1"
                    >
                        <TrendingUp className="w-3 h-3" />
                        {showQuickReplies ? '隱藏' : '顯示'}快速回覆
                    </button>
                    
                    {showQuickReplies && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {QUICK_REPLIES.map((reply, index) => (
                                <button
                                    key={index}
                                    onClick={() => useQuickReply(reply)}
                                    className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-xs text-gray-700 transition-all hover:shadow-sm"
                                >
                                    {reply.text}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* 輸入框 */}
                <form onSubmit={handleSubmit} className="relative">
                    <textarea
                        ref={textareaRef}
                        value={newComment}
                        onChange={handleInputChange}
                        placeholder="輸入評論... (使用 @ 提及同事)"
                        rows={3}
                        className="input-apple w-full min-h-[56px] bg-white text-sm text-gray-900 placeholder:text-gray-400 resize-none"
                        disabled={loading}
                    />

                    {/* @ 提及下拉選單 */}
                    {showMentions && filteredUsers.length > 0 && (
                        <div 
                            ref={mentionsRef}
                            className="absolute bottom-full mb-2 left-0 right-0 glass-card max-h-48 overflow-y-auto rounded-xl shadow-apple-xl z-50"
                        >
                            {filteredUsers.slice(0, 5).map(user => (
                                <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => insertMention(user)}
                                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-apple-blue/10 transition-colors text-left"
                                >
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-apple-blue/20 to-apple-purple/20 flex items-center justify-center">
                                        <User className="w-4 h-4 text-apple-blue" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-900 text-sm truncate">
                                            {user.name || user.username}
                                        </div>
                                        <div className="text-xs text-gray-500 truncate">
                                            @{user.username}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* 發送按鈕 */}
                                        <div className="mt-3 flex items-center justify-between">
                                                <span className="text-[11px] text-gray-400">
                                                        使用 @ 提及同事，可多行輸入。Enter 發送。
                                                </span>
                                                <Button
                                                        type="submit"
                                                        disabled={loading || !newComment.trim()}
                                                        variant={(!newComment.trim() || loading) ? 'secondary' : 'primary'}
                                                        leadingIcon={loading ? Loader2 : Send}
                                                        className={`${loading ? 'opacity-80' : ''} ${!newComment.trim() ? 'cursor-not-allowed' : ''}`}
                                                >
                                                    {loading ? '發送中...' : '發送評論'}
                                                </Button>
                                        </div>
                </form>
            </div>
        </div>
    );
}

// 單列組件：避免不相關狀態變動造成整列重渲染
const Row = React.memo(function Row({ style, index, item, measure, render }) {
    const ref = React.useRef(null);
    React.useEffect(() => {
        if (!ref.current) return;
        const el = ref.current;
        const ro = new ResizeObserver(() => {
            const h = el.scrollHeight + 12;
            measure(h);
        });
        ro.observe(el);
        // 初次量測
        measure(el.scrollHeight + 12);
        return () => ro.disconnect();
    }, [item, measure]);
    return (
        <div style={style}>
            <div ref={ref} style={{ width: '100%' }}>
                {render(item, false, false)}
            </div>
        </div>
    );
});
