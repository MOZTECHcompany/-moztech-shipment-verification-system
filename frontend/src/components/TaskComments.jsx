// frontend/src/components/TaskComments.jsx
// 任務評論系統 - 優化版（優先級、置頂、搜尋、未讀提示）

import React, { useState, useEffect, useRef } from 'react';
import { socket } from '@/api/socket';
import { FixedSizeList as List } from 'react-window';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { 
    MessageSquare, Send, User, AtSign, Reply, Loader2, 
    Pin, AlertCircle, Clock, CheckCircle2, Search, X,
    Star, Bell, Filter, Paperclip, Upload, Image as ImageIcon,
    TrendingUp, Users
} from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api';
import { useComments } from '@/api/useComments';

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
    
    const textareaRef = useRef(null);
    const mentionsRef = useRef(null);
    const commentsEndRef = useRef(null);

    useEffect(() => {
        // 降低備援輪詢頻率（主要依賴 WebSocket）
        const interval = setInterval(() => invalidate(), 60000);

        // 啟用 WebSocket 監聽新評論
        try {
            if (!socket.connected) socket.connect();
            const onNewComment = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
                }
            };
            socket.on('new_comment', onNewComment);
            return () => {
                clearInterval(interval);
                socket.off('new_comment', onNewComment);
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

    useEffect(() => {
        // 滾動到底部（新評論時）
        commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [comments]);

    const fetchComments = async () => {
        // 已改由 React Query 管理；這個函數保留舊呼叫點
        await invalidate();
        const pinned = JSON.parse(localStorage.getItem(`pinned_comments_${orderId}`) || '[]');
        setPinnedComments(pinned);
    };

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

            await apiClient.post(`/api/tasks/${orderId}/comments`, {
                content: newComment,
                parent_id: replyTo?.id || null,
                priority: priority
            });
            
            setNewComment('');
            setReplyTo(null);
            setPriority('normal');
            await invalidate();
            toast.success('評論已發送');
        } catch (error) {
            // 還原暫時卡片
            await invalidate();
            toast.error('發送評論失敗', {
                description: error.message || error.response?.data?.message || '請稍後再試'
            });
        } finally {
            setLoading(false);
        }
    };

    const togglePin = (commentId) => {
        const newPinned = pinnedComments.includes(commentId)
            ? pinnedComments.filter(id => id !== commentId)
            : [...pinnedComments, commentId];
        
        setPinnedComments(newPinned);
        localStorage.setItem(`pinned_comments_${orderId}`, JSON.stringify(newPinned));
        
        toast.success(
            pinnedComments.includes(commentId) ? '已取消置頂' : '已置頂評論'
        );
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
    const pinnedList = filteredComments.filter(c => pinnedComments.includes(c.id) && !c.parent_id);
    const normalList = filteredComments.filter(c => !pinnedComments.includes(c.id) && !c.parent_id);
    const displayList = [...pinnedList.map(c => ({ ...c, __pinned: true })), ...normalList];

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

    const renderComment = (comment, isReply = false, isPinned = false) => {
        const commentPriority = PRIORITIES[comment.priority || 'normal'];
        const PriorityIcon = commentPriority.icon;
        
        return (
            <div 
                key={comment.id} 
                className={`
                    glass-card p-4 animate-scale-in transition-all duration-200
                    ${isReply ? 'ml-12 mt-2 border-l-2 border-l-apple-blue/30' : 'mb-3'}
                    ${isPinned ? 'ring-2 ring-amber-400 shadow-lg' : ''}
                    ${commentPriority.bgGlow}
                    hover:shadow-apple-md
                `}
            >
                <div className="flex items-start gap-3">
                    {/* 用戶頭像 */}
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-apple-blue/20 to-apple-purple/20 flex items-center justify-center flex-shrink-0">
                            <User className="w-5 h-5 text-apple-blue" />
                        </div>
                        {/* 優先級指示器 */}
                        {comment.priority && comment.priority !== 'normal' && (
                            <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full ${commentPriority.dotColor} border-2 border-white shadow-sm`} />
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        {/* 用戶資訊和操作按鈕 */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-gray-900">
                                        {comment.username || '未知用戶'}
                                    </span>
                                    
                                    {/* 優先級標籤 */}
                                    {comment.priority && comment.priority !== 'normal' && (
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${commentPriority.color}`}>
                                            <PriorityIcon className="w-3 h-3" />
                                            {commentPriority.label}
                                        </span>
                                    )}
                                    
                                    {/* 置頂標記 */}
                                    {isPinned && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium border border-amber-300">
                                            <Pin className="w-3 h-3" />
                                            已置頂
                                        </span>
                                    )}
                                </div>
                                
                                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                    <Clock className="w-3 h-3" />
                                    <span>
                                        {formatDistanceToNow(new Date(comment.created_at), {
                                            addSuffix: true,
                                            locale: zhTW
                                        })}
                                    </span>
                                </div>
                            </div>

                            {/* 操作按鈕 */}
                            <div className="flex items-center gap-1">
                                {/* 置頂按鈕 */}
                                {!isReply && (
                                    <button
                                        onClick={() => togglePin(comment.id)}
                                        className={`p-1.5 rounded-lg transition-all duration-200 ${
                                            isPinned
                                                ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                                                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                        }`}
                                        title={isPinned ? '取消置頂' : '置頂評論'}
                                    >
                                        <Pin className={`w-4 h-4 ${isPinned ? 'fill-current' : ''}`} />
                                    </button>
                                )}
                                
                                {/* 回覆按鈕 */}
                                {!isReply && (
                                    <button
                                        onClick={() => {
                                            setReplyTo(comment);
                                            textareaRef.current?.focus();
                                        }}
                                        className="p-1.5 text-gray-400 hover:bg-apple-blue/10 hover:text-apple-blue rounded-lg transition-all duration-200"
                                        title="回覆"
                                    >
                                        <Reply className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 評論內容 */}
                        <div className="text-gray-700 leading-relaxed break-words">
                            {highlightMentions(comment.content)}
                        </div>

                        {/* 回覆列表 */}
                        {!isReply && comment.replies && comment.replies.length > 0 && (
                            <div className="mt-3 space-y-2">
                                {comment.replies.map(reply => renderComment(reply, true))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-white">
            {/* 標題欄 */}
            <div className="glass-card p-4 border-b border-gray-200">
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
                {displayList.length === 0 ? (
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
                    <List height={420} itemCount={displayList.length} itemSize={120} width={'100%'}>
                        {({ index, style }) => (
                            <div style={style}>
                                {renderComment(displayList[index], false, !!displayList[index].__pinned)}
                            </div>
                        )}
                    </List>
                )}
                {hasNextPage && (
                    <div className="flex justify-center py-3">
                        <button onClick={() => fetchNextPage()} className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-apple-blue/50" aria-label="載入更多評論">
                            載入更多
                        </button>
                    </div>
                )}
                <div ref={commentsEndRef} />
            </div>

            {/* 輸入區域 */}
            <div className="glass-card p-4 border-t border-gray-200">
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

                {/* 優先級選擇 */}
                <div className="mb-3 flex items-center gap-2">
                    <span className="text-sm text-gray-600">優先級：</span>
                    {Object.entries(PRIORITIES).map(([key, config]) => {
                        const Icon = config.icon;
                        return (
                            <button
                                key={key}
                                onClick={() => setPriority(key)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${
                                    priority === key
                                        ? config.color
                                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                }`}
                            >
                                <Icon className="w-3 h-3" />
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
                        className="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-apple-blue/50 focus:border-apple-blue transition-all text-sm"
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
                    <div className="mt-3 flex items-center justify-end">
                        <button
                            type="submit"
                            disabled={loading || !newComment.trim()}
                            className="px-6 py-2.5 bg-gradient-to-r from-apple-blue to-apple-purple text-white rounded-xl font-medium shadow-apple hover:shadow-apple-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    發送中...
                                </>
                            ) : (
                                <>
                                    <Send className="w-4 h-4" />
                                    發送評論
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
