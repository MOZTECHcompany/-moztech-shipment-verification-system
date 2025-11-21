// frontend/src/components/TaskComments-modern.jsx
// 任務評論系統 - 現代化重構版 (iMessage/LINE 風格)

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { socket } from '@/api/socket';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { 
    MessageSquare, Send, User, AtSign, Reply, Loader2, 
    Pin, AlertCircle, Clock, CheckCircle2, Search, X,
    Star, Bell, Filter, Paperclip, Upload, Image as ImageIcon,
    TrendingUp, Users, ChevronDown, Smile, AlertTriangle, Mic,
    MoreHorizontal, Trash2, RotateCcw, CornerDownRight
} from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api';
import { useComments } from '@/api/useComments';
import DesktopNotification from '@/utils/desktopNotification';
import SoundNotification from '@/utils/soundNotification';
import { Button, Skeleton } from '@/ui';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const MySwal = withReactContent(Swal);

// 優先級配置
const PRIORITIES = {
    urgent: { 
        label: '緊急', 
        color: 'bg-red-100 text-red-700 border-red-300',
        icon: AlertTriangle
    },
    important: { 
        label: '重要', 
        color: 'bg-amber-100 text-amber-700 border-amber-300',
        icon: Star
    },
    normal: { 
        label: '一般', 
        color: 'bg-blue-100 text-blue-700 border-blue-300',
        icon: MessageSquare
    }
};

// 快速回覆模板
const QUICK_REPLIES = [
    { text: '✅ 已確認', priority: 'normal' },
    { text: '👍 收到，處理中', priority: 'normal' },
    { text: '⏳ 需要時間處理', priority: 'important' },
    { text: '❓ 需要更多資訊', priority: 'important' },
    { text: '🚨 緊急！需立即處理', priority: 'urgent' },
];

// 頭像組件
const UserAvatar = ({ name, size = "md" }) => {
    const sizeClasses = {
        sm: "w-6 h-6 text-[10px]",
        md: "w-9 h-9 text-xs",
        lg: "w-12 h-12 text-sm"
    };
    
    // 根據名字生成穩定的顏色
    const getColor = (str) => {
        const colors = [
            'from-blue-400 to-blue-600',
            'from-purple-400 to-purple-600',
            'from-green-400 to-green-600',
            'from-orange-400 to-orange-600',
            'from-pink-400 to-pink-600',
            'from-teal-400 to-teal-600'
        ];
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    };

    const colorClass = useMemo(() => getColor(name || '?'), [name]);

    return (
        <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br ${colorClass} flex items-center justify-center text-white font-bold shadow-sm border-2 border-white ring-1 ring-gray-100`}>
            {name?.charAt(0).toUpperCase()}
        </div>
    );
};

export default function TaskComments({ orderId, currentUser, allUsers }) {
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
    const [pinnedComments, setPinnedComments] = useState([]);
    const [mentionsOpen, setMentionsOpen] = useState(false);
    const [mentions, setMentions] = useState([]);
    const [mentionsUnread, setMentionsUnread] = useState(0);
    const [activeMessageId, setActiveMessageId] = useState(null); // 用於顯示操作選單
    
    const textareaRef = useRef(null);
    const mentionsRef = useRef(null);
    const commentsEndRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const mentionPulseRef = useRef(new Set());
    const notifierRef = useRef(null);
    const soundRef = useRef(null);

    // 建立評論 ID 對照表，用於快速查找父評論
    const commentMap = useMemo(() => {
        const map = {};
        comments.forEach(c => map[c.id] = c);
        return map;
    }, [comments]);

    // 初始化與 Socket 監聽
    useEffect(() => {
        try {
            const pinned = JSON.parse(localStorage.getItem(`pinned_comments_${orderId}`) || '[]');
            setPinnedComments(Array.isArray(pinned) ? pinned : []);
        } catch { setPinnedComments([]); }

        (async () => {
            try {
                const res = await apiClient.get(`/api/tasks/${orderId}/pins`);
                const list = Array.isArray(res?.data?.pinned) ? res.data.pinned : [];
                setPinnedComments(list);
                localStorage.setItem(`pinned_comments_${orderId}`, JSON.stringify(list));
            } catch (e) {}
        })();
    }, [orderId]);

    useEffect(() => {
        const interval = setInterval(() => invalidate(), 60000);
        try {
            if (!socket.connected) socket.connect();
            
            const onNewComment = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
                    fetchMentions();
                    // 播放音效
                    if (data.userId !== currentUser.id) {
                        try {
                            if (!soundRef.current) soundRef.current = new SoundNotification();
                            soundRef.current.play('message');
                        } catch {}
                    }
                }
            };

            const onCommentRetracted = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
                    toast.info('一則訊息已收回');
                }
            };

            const onCommentDeleted = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
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
                            onClick: () => {}
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

            socket.on('new_comment', onNewComment);
            socket.on('comment_retracted', onCommentRetracted);
            socket.on('comment_deleted', onCommentDeleted);
            socket.on('new_mention', onNewMention);
            
            return () => {
                clearInterval(interval);
                socket.off('new_comment', onNewComment);
                socket.off('comment_retracted', onCommentRetracted);
                socket.off('comment_deleted', onCommentDeleted);
                socket.off('new_mention', onNewMention);
            };
        } catch (e) {
            return () => clearInterval(interval);
        }
    }, [orderId, currentUser.id, invalidate]);

    // 自動滾動
    useEffect(() => {
        if (scrollContainerRef.current) {
            // 使用 scrollTop 替代 scrollIntoView 以避免頁面跳動
            const container = scrollContainerRef.current;
            // 使用 requestAnimationFrame 確保 DOM 更新後再滾動
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        }
    }, [comments.length, activeMessageId]); // 當評論增加或操作選單開啟時滾動

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

        const textBeforeCursor = value.slice(0, position);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        if (lastAtIndex !== -1) {
            const afterAt = textBeforeCursor.slice(lastAtIndex + 1);
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
        const newText = textBeforeCursor.slice(0, lastAtIndex) + `@${user.username} ` + textAfterCursor;
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

    const handleReply = (comment) => {
        setReplyTo(comment);
        textareaRef.current?.focus();
    };

    const handleRetract = async (comment) => {
        try {
            await apiClient.patch(`/api/tasks/${orderId}/comments/${comment.id}/retract`);
            toast.success('訊息已收回');
            setActiveMessageId(null);
        } catch (error) {
            toast.error('收回失敗', { description: error.response?.data?.message });
        }
    };

    const handleDelete = async (comment) => {
        const result = await MySwal.fire({
            title: '確定刪除？',
            text: '此操作無法復原',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '刪除',
            cancelButtonText: '取消',
            customClass: {
                popup: 'rounded-2xl',
                confirmButton: 'bg-red-500 text-white px-4 py-2 rounded-lg',
                cancelButton: 'bg-gray-200 text-gray-800 px-4 py-2 rounded-lg ml-2'
            }
        });

        if (result.isConfirmed) {
            try {
                await apiClient.delete(`/api/tasks/${orderId}/comments/${comment.id}`);
                toast.success('訊息已刪除');
                setActiveMessageId(null);
            } catch (error) {
                toast.error('刪除失敗', { description: error.response?.data?.message });
            }
        }
    };

    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (!newComment.trim()) return;
        if (loading) return;
        
        setLoading(true);
        try {
            const draft = {
                id: `temp_${Date.now()}`,
                content: newComment,
                parent_id: replyTo?.id || null,
                priority,
                created_at: new Date().toISOString(),
                user_id: currentUser.id,
                username: currentUser.username,
                user_name: currentUser.name,
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
        } catch (error) {
            toast.error('發送失敗');
        } finally {
            setLoading(false);
        }
    };

    const filteredUsers = (allUsers || []).filter(u => 
        u.username?.toLowerCase().includes(mentionFilter) ||
        u.name?.toLowerCase().includes(mentionFilter)
    );

    // 渲染單個評論
    const renderComment = (comment) => {
        const isMine = comment.user_id === currentUser.id;
        const isUrgent = comment.priority === 'urgent';
        const isPinned = pinnedComments.some(p => p.id === comment.id);
        const isRetracted = comment.content === '[已撤回]';
        const parentComment = comment.parent_id ? commentMap[comment.parent_id] : null;
        const isActive = activeMessageId === comment.id;

        return (
            <div 
                key={comment.id} 
                className={`flex gap-3 mb-4 ${isMine ? 'flex-row-reverse' : ''} group relative`}
                onMouseLeave={() => setActiveMessageId(null)}
            >
                {/* Avatar */}
                <div className="flex-shrink-0 flex flex-col items-center self-end mb-1">
                    <UserAvatar name={comment.user_name} size="md" />
                </div>

                <div className={`flex flex-col max-w-[75%] ${isMine ? 'items-end' : 'items-start'}`}>
                    {/* Name & Time */}
                    <div className={`flex items-center gap-2 mb-1 px-1 ${isMine ? 'flex-row-reverse' : ''}`}>
                        <span className="text-[11px] font-bold text-gray-600">{comment.user_name}</span>
                        <span className="text-[10px] text-gray-400">
                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: zhTW })}
                        </span>
                        {isPinned && <Pin size={10} className="text-blue-500 fill-blue-500" />}
                    </div>

                    {/* Message Bubble Container */}
                    <div className="relative group/bubble">
                        {/* Reply Context */}
                        {parentComment && (
                            <div className={`
                                text-xs mb-1 px-3 py-1.5 rounded-xl border-l-2 opacity-80
                                ${isMine ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-gray-100 border-gray-300 text-gray-600'}
                            `}>
                                <div className="flex items-center gap-1 font-bold mb-0.5">
                                    <Reply size={10} />
                                    <span>回覆 {parentComment.user_name}</span>
                                </div>
                                <div className="truncate max-w-[200px]">{parentComment.content}</div>
                            </div>
                        )}

                        {/* Message Bubble */}
                        <div
                            className={`
                                relative px-4 py-2.5 text-[15px] leading-relaxed shadow-sm transition-all
                                ${isRetracted 
                                    ? 'bg-gray-100 text-gray-400 italic border border-gray-200 rounded-2xl' 
                                    : isMine 
                                        ? 'bg-blue-500 text-white rounded-2xl rounded-tr-sm' 
                                        : isUrgent
                                            ? 'bg-red-50 text-gray-900 border border-red-200 rounded-2xl rounded-tl-sm shadow-red-100'
                                            : 'bg-white text-gray-900 border border-gray-100 rounded-2xl rounded-tl-sm'
                                }
                            `}
                        >
                            {isUrgent && !isMine && !isRetracted && (
                                <div className="flex items-center gap-1 text-red-500 text-xs font-bold mb-1 uppercase tracking-wider">
                                    <AlertTriangle size={10} /> Urgent
                                </div>
                            )}
                            <p className="whitespace-pre-wrap break-words">{comment.content}</p>
                        </div>

                        {/* Actions Menu (Hover/Click) */}
                        {!isRetracted && (
                            <div className={`
                                absolute top-0 ${isMine ? '-left-10' : '-right-10'} 
                                opacity-0 group-hover/bubble:opacity-100 transition-opacity flex flex-col gap-1
                            `}>
                                <button 
                                    onClick={() => handleReply(comment)}
                                    className="p-1.5 bg-white rounded-full shadow-sm border border-gray-100 text-gray-500 hover:text-blue-500 hover:bg-blue-50"
                                    title="回覆"
                                >
                                    <Reply size={14} />
                                </button>
                                
                                {(isMine || currentUser.role === 'admin') && (
                                    <div className="relative">
                                        <button 
                                            onClick={() => setActiveMessageId(activeMessageId === comment.id ? null : comment.id)}
                                            className="p-1.5 bg-white rounded-full shadow-sm border border-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                                        >
                                            <MoreHorizontal size={14} />
                                        </button>
                                        
                                        {isActive && (
                                            <div className={`
                                                absolute top-full mt-1 ${isMine ? 'right-0' : 'left-0'} 
                                                bg-white rounded-xl shadow-xl border border-gray-100 py-1 w-24 z-20 overflow-hidden animate-scale-in
                                            `}>
                                                <button 
                                                    onClick={() => handleRetract(comment)}
                                                    className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                                                >
                                                    <RotateCcw size={12} /> 收回
                                                </button>
                                                <button 
                                                    onClick={() => handleDelete(comment)}
                                                    className="w-full px-3 py-2 text-left text-xs hover:bg-red-50 flex items-center gap-2 text-red-600"
                                                >
                                                    <Trash2 size={12} /> 刪除
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-[600px] bg-white rounded-3xl overflow-hidden border border-gray-200 shadow-xl">
            {/* Header */}
            <div className="bg-white/90 backdrop-blur-md px-5 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
                        <MessageSquare size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-gray-900">團隊討論</h3>
                        <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                            {comments.length} 則留言
                        </p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => setMentionsOpen(!mentionsOpen)}
                        className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 hover:text-gray-600 relative transition-all"
                    >
                        <AtSign size={20} />
                        {mentionsUnread > 0 && (
                            <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
                        )}
                    </button>
                </div>
            </div>

            {/* Operation Hint - 操作提示 */}
            <div className="bg-blue-50/50 px-5 py-3 border-b border-blue-100 flex items-start gap-3">
                <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg mt-0.5">
                    <AlertCircle size={14} />
                </div>
                <div className="flex-1">
                    <h4 className="text-xs font-bold text-blue-800 mb-0.5">操作提示</h4>
                    <p className="text-xs text-blue-600 leading-relaxed">
                        確認游標在輸入框內，掃描槍掃描後會自動送出。如遇錯誤請檢查輸入法。
                    </p>
                </div>
            </div>

            {/* Pinned Section */}
            {pinnedComments.length > 0 && (
                <div className="bg-blue-50/80 backdrop-blur-sm border-b border-blue-100 px-4 py-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-700 mb-2">
                        <Pin size={12} className="fill-blue-700" /> 置頂公告
                    </div>
                    <div className="space-y-2">
                        {pinnedComments.map(pin => (
                            <div key={pin.id} className="bg-white/80 p-2.5 rounded-xl border border-blue-100 shadow-sm text-sm text-gray-700 flex items-start gap-2">
                                <UserAvatar name={pin.user_name} size="sm" />
                                <div>
                                    <span className="font-bold text-gray-900 mr-1">{pin.user_name}:</span>
                                    {pin.content}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Comments List */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50/30">
                {isLoading ? (
                    <div className="space-y-6">
                        {[1,2,3].map(i => (
                            <div key={i} className="flex gap-3">
                                <Skeleton className="w-10 h-10 rounded-full" />
                                <div className="space-y-2 w-2/3">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-12 w-full rounded-2xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : comments.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <MessageSquare size={32} className="text-gray-300" />
                        </div>
                        <p className="text-sm font-medium">尚無討論</p>
                        <p className="text-xs text-gray-400 mt-1">開始第一則留言...</p>
                    </div>
                ) : (
                    comments
                        .filter(c => c.content.includes(searchTerm))
                        .map(renderComment)
                )}
                <div ref={commentsEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_20px_-4px_rgba(0,0,0,0.05)] z-20">
                {/* Reply Preview */}
                {replyTo && (
                    <div className="flex items-center justify-between bg-blue-50/50 px-4 py-3 rounded-xl border border-blue-100 mb-3 animate-slide-up">
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-1 h-8 bg-blue-500 rounded-full"></div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-blue-600 flex items-center gap-1">
                                    <Reply size={12} /> 回覆 {replyTo.user_name}
                                </span>
                                <span className="text-xs text-gray-600 truncate max-w-[200px] mt-0.5">{replyTo.content}</span>
                            </div>
                        </div>
                        <button 
                            onClick={() => setReplyTo(null)}
                            className="p-1.5 hover:bg-blue-100 rounded-full text-blue-400 hover:text-blue-600 transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                <div className="flex items-end gap-3">
                    <div className={`flex-1 bg-gray-50 rounded-2xl border-2 border-transparent transition-all duration-300 flex flex-col focus-within:border-blue-500/20 focus-within:bg-white focus-within:shadow-lg focus-within:shadow-blue-500/5`}>
                        <textarea
                            ref={textareaRef}
                            value={newComment}
                            onChange={handleInputChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit();
                                }
                            }}
                            placeholder={replyTo ? `回覆 ${replyTo.user_name}...` : "輸入訊息..."}
                            className="w-full px-4 py-3 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[48px] text-sm placeholder:text-gray-400"
                            rows={1}
                            style={{ height: 'auto', minHeight: '48px' }}
                        />
                        
                        {/* Toolbar */}
                        <div className="flex items-center justify-between px-2 pb-2">
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                                    className={`p-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold ${showQuickReplies ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                                    title="快速回覆"
                                >
                                    <TrendingUp size={16} />
                                    <span className="hidden sm:inline">快速回覆</span>
                                </button>
                                <div className="h-4 w-px bg-gray-200 mx-1"></div>
                                <button
                                    onClick={() => setPriority(priority === 'urgent' ? 'normal' : 'urgent')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                        priority === 'urgent' 
                                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/30' 
                                            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                    }`}
                                >
                                    <AlertTriangle size={14} />
                                    {priority === 'urgent' ? '緊急' : '標記緊急'}
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <button
                        onClick={handleSubmit}
                        disabled={!newComment.trim()}
                        className={`
                            w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-300 flex-shrink-0
                            ${newComment.trim() 
                                ? 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 hover:shadow-blue-500/30' 
                                : 'bg-gray-100 text-gray-300 cursor-not-allowed'}
                        `}
                    >
                        <Send size={20} className={newComment.trim() ? 'ml-0.5' : ''} />
                    </button>
                </div>

                {/* Quick Replies Panel */}
                {showQuickReplies && (
                    <div className="mt-3 flex flex-wrap gap-2 animate-slide-down">
                        {QUICK_REPLIES.map((reply, idx) => (
                            <button
                                key={idx}
                                onClick={() => useQuickReply(reply)}
                                className="px-4 py-2 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded-xl text-xs font-bold text-gray-600 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95"
                            >
                                {reply.text}
                            </button>
                        ))}
                    </div>
                )}

                {/* Mentions Dropdown */}
                {showMentions && filteredUsers.length > 0 && (
                    <div className="absolute bottom-24 left-4 bg-white rounded-2xl shadow-2xl border border-gray-200 max-h-48 overflow-y-auto z-20 w-64 animate-slide-up">
                        {filteredUsers.slice(0, 5).map(user => (
                            <button
                                key={user.id}
                                onClick={() => insertMention(user)}
                                className="w-full px-4 py-3 hover:bg-blue-50 text-left flex items-center gap-3 transition-colors border-b border-gray-50 last:border-0"
                            >
                                <UserAvatar name={user.name} size="sm" />
                                <div>
                                    <div className="text-sm font-bold text-gray-900">{user.name}</div>
                                    <div className="text-xs text-gray-500">@{user.username}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
