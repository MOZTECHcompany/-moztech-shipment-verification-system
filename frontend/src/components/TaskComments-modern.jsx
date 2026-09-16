// frontend/src/components/TaskComments-modern.jsx
// 任務評論系統 - 現代化重構版 (iMessage/LINE 風格)

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { socket } from '@/api/socket';
import { MessageTimestamp } from './MessageTimestamp';
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
import { usePinnedComments } from '@/api/usePinnedComments';
import { useVisibleCommentReads } from '@/api/useVisibleCommentReads';
import { useCommentScroll } from '@/api/useCommentScroll';
import { CommentsLoadState } from './CommentsLoadState';
import desktopNotification from '@/utils/desktopNotification';
import soundNotification from '@/utils/soundNotification';
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

export default function TaskComments({ orderId, currentUser, allUsers, mode = 'embedded' }) {
    const { comments, isLoading, isError, error, refetch, isFetching, isFetchingNextPage, isFetchNextPageError, fetchNextPage, hasNextPage, invalidate, markVisibleRead } = useComments(orderId);
    const [newComment, setNewComment] = useState('');
    const [replyTo, setReplyTo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sendError, setSendError] = useState(null);
    const sendingRef = useRef(false);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [cursorPosition, setCursorPosition] = useState(0);
    const [priority, setPriority] = useState('normal');
    const [showQuickReplies, setShowQuickReplies] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const { pinnedComments, invalidatePins } = usePinnedComments(orderId, currentUser);
    const pinSavingRef = useRef(false);
    const [isMinimized, setIsMinimized] = useState(false); // Widget mode only
    const [mentionsOpen, setMentionsOpen] = useState(false);
    const [mentions, setMentions] = useState([]);
    const [mentionsUnread, setMentionsUnread] = useState(0);
    const [activeMessageId, setActiveMessageId] = useState(null); // 用於顯示操作選單
    
    const textareaRef = useRef(null);
    const mentionsRef = useRef(null);
    const commentsEndRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const mentionPulseRef = useRef(new Set());
    const { onScroll, loadOlder, jumpToLatest, hasNewMessages } = useCommentScroll({
        rootRef: scrollContainerRef, comments, orderId, fetchNextPage, enabled: !isMinimized
    });
    useVisibleCommentReads({ orderId, rootRef: scrollContainerRef, comments, markVisibleRead, enabled: !isMinimized });


    // 建立評論 ID 對照表，用於快速查找父評論
    const commentMap = useMemo(() => {
        const map = {};
        comments.forEach(c => map[c.id] = c);
        return map;
    }, [comments]);

    // 初始化與 Socket 監聽
    const fetchMentions = useCallback(async () => {
        try {
            const res = await apiClient.get(`/api/tasks/${orderId}/mentions?status=unread&limit=20`);
            setMentions(res.data.items || []);
            setMentionsUnread(res.data.total || 0);
        } catch (e) { /* ignore */ }
    }, [orderId]);


    useEffect(() => {
        const interval = setInterval(() => invalidate(), 60000);
        try {
            
            const onNewComment = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
                    fetchMentions();
                    // 播放音效
                    if (data.userId !== currentUser.id) {
                        try {
                            soundNotification.play('message');
                        } catch { /* Optional notification must not interrupt the conversation. */ }
                    }
                }
            };

            const onCommentRetracted = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
                    invalidatePins();
                    toast.info('一則訊息已收回');
                }
            };

            const onCommentDeleted = (data) => {
                if (String(data.orderId) === String(orderId)) {
                    invalidate();
                    invalidatePins();
                }
            };

            const onNewMention = (payload) => {
                if (String(payload.orderId) === String(orderId) && Number(payload.userId) === Number(currentUser.id)) {
                    mentionPulseRef.current.add(payload.commentId);
                    try {
                        desktopNotification.show('有人提及了你', {
                            body: payload.content || '新提及',
                            duration: 4000,
                            onClick: () => {}
                        });
                    } catch { /* Optional notification must not interrupt the conversation. */ }
                    try {
                        soundNotification.play('newTask');
                    } catch { /* Optional notification must not interrupt the conversation. */ }
                    invalidate();
                    fetchMentions();
                }
            };

            socket.on('connect', invalidatePins);
            socket.on('new_comment', onNewComment);
            socket.on('comment_retracted', onCommentRetracted);
            socket.on('comment_deleted', onCommentDeleted);
            socket.on('new_mention', onNewMention);
            
            return () => {
                clearInterval(interval);
                socket.off('connect', invalidatePins);
                socket.off('new_comment', onNewComment);
                socket.off('comment_retracted', onCommentRetracted);
                socket.off('comment_deleted', onCommentDeleted);
                socket.off('new_mention', onNewMention);
            };
        } catch (e) {
            return () => clearInterval(interval);
        }
    }, [orderId, currentUser.id, invalidate, invalidatePins, fetchMentions]);

    // 點擊外部關閉選單
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (activeMessageId && !event.target.closest('.action-menu-container')) {
                setActiveMessageId(null);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [activeMessageId]);

    useEffect(() => { fetchMentions(); }, [fetchMentions]);

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

    const applyQuickReply = (reply) => {
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
            await invalidate();
            setActiveMessageId(null);
        } catch (error) {
            toast.error('收回失敗', { description: error.response?.data?.message });
        }
    };

    const handlePin = async (comment) => {
        if (pinSavingRef.current) return;
        pinSavingRef.current = true;
        try {
            const isPinned = pinnedComments.some(p => String(p.id) === String(comment.id));
            await apiClient.put(`/api/tasks/${orderId}/pins/${comment.id}`, { pinned: !isPinned });
            await invalidatePins();
            toast.success(isPinned ? '已取消置頂' : '已置頂留言');
            setActiveMessageId(null);
        } catch (error) {
            toast.error('操作失敗', { description: error.response?.data?.message });
        } finally {
            pinSavingRef.current = false;
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
                await invalidate();
                setActiveMessageId(null);
            } catch (error) {
                toast.error('刪除失敗', { description: error.response?.data?.message });
            }
        }
    };

    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (!newComment.trim() || sendingRef.current) return;
        sendingRef.current = true;
        setLoading(true); setSendError(null);
        const submitted = newComment;
        try {
            await apiClient.post(`/api/tasks/${orderId}/comments`, { content: submitted, parent_id: replyTo?.id || null, priority });
            setNewComment(value => value === submitted ? '' : value);
            setReplyTo(null); setPriority('normal');
            jumpToLatest();
            await invalidate();
        } catch (error) {
            setSendError(error.response?.data?.message || error.message || '留言未送出，內容已保留');
        } finally { sendingRef.current = false; setLoading(false); }
    };

    const filteredUsers = (allUsers || []).filter(u => 
        u.username?.toLowerCase().includes(mentionFilter) ||
        u.name?.toLowerCase().includes(mentionFilter)
    );

    // 渲染單個評論
    const renderComment = (comment) => {
        const isMine = String(comment.user_id) === String(currentUser.id);
        const isUrgent = comment.priority === 'urgent';
        const isPinned = pinnedComments.some(p => p.id === comment.id);
        const isRetracted = comment.content === '[已撤回]';
        const parentComment = comment.parent_id ? commentMap[comment.parent_id] : null;
        const isActive = activeMessageId === comment.id;

        return (
            <div 
                key={comment.id}
                id={`comment-${comment.id}`}
                className={`flex gap-3 mb-4 ${isMine ? 'flex-row-reverse' : ''} group relative`}
            >
                {/* Avatar */}
                <div className="flex-shrink-0 flex flex-col items-center self-end mb-1">
                    <UserAvatar name={comment.user_name} size="md" />
                </div>

                <div className={`flex flex-col max-w-[75%] ${isMine ? 'items-end' : 'items-start'}`}>
                    {/* Name & Time */}
                    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1 px-1 ${isMine ? 'flex-row-reverse' : ''}`}>
                        <span className="text-[11px] font-bold text-gray-600">{comment.user_name}</span>
                        <MessageTimestamp value={comment.created_at} className="text-[11px] text-gray-500" />
                        {isPinned && <Pin size={10} className="text-blue-500 fill-blue-500" />}
                    </div>

                    {/* Message Bubble Container */}
                    <div className="relative group/bubble">
                        {/* Message Bubble */}
                        <div
                            className={`
                                relative px-5 py-3 text-[15px] leading-relaxed shadow-md transition-all backdrop-blur-md
                                ${isRetracted 
                                    ? 'bg-gray-100/30 text-gray-400 italic border border-gray-200/30 rounded-3xl' 
                                    : isMine 
                                        ? isUrgent 
                                            ? 'bg-gradient-to-br from-red-500 to-orange-600 text-white rounded-3xl rounded-tr-sm shadow-red-500/30'
                                            : 'bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-3xl rounded-tr-sm shadow-blue-500/30' 
                                        : isUrgent
                                            ? 'bg-red-50/40 text-slate-800 border border-red-200/30 rounded-3xl rounded-tl-sm shadow-red-100/30'
                                            : 'bg-white/30 text-slate-800 border border-white/20 rounded-3xl rounded-tl-sm shadow-sm'
                                }
                            `}
                        >
                            {/* Reply Context (Integrated) */}
                            {parentComment && !isRetracted && (
                                <div className={`
                                    mb-2 rounded-xl p-2.5 text-xs border-l-2 cursor-pointer hover:opacity-80 transition-opacity
                                    ${isMine 
                                        ? 'bg-black/10 border-white/50 text-white/90' 
                                        : 'bg-white/50 border-gray-300 text-gray-600'
                                    }
                                `} onClick={() => {
                                    // Optional: Scroll to parent
                                }}>
                                    <div className="flex items-center gap-1 font-bold mb-0.5 opacity-90">
                                        <Reply size={10} />
                                        <span>回覆 {parentComment.user_name}</span>
                                    </div>
                                    <div className="truncate opacity-80">{parentComment.content}</div>
                                </div>
                            )}

                            {isUrgent && !isRetracted && (
                                <div className={`flex items-center gap-1 text-xs font-bold mb-1 uppercase tracking-wider ${isMine ? 'text-white/90' : 'text-red-500'}`}>
                                    <AlertTriangle size={10} /> Urgent
                                </div>
                            )}
                            <p data-comment-id={comment.id} className="whitespace-pre-wrap break-words font-medium">{comment.content}</p>
                        </div>

                        {/* Actions Menu (Hover/Click) */}
                        {!isRetracted && (
                            <div className={`
                                relative mt-1 flex items-center ${isMine ? 'justify-end' : 'justify-start'}
                                gap-1 action-menu-container
                            `}>
                                <button 
                                    onClick={() => handleReply(comment)}
                                    className="p-2 bg-white/80 backdrop-blur rounded-full shadow-sm border border-white/50 text-gray-500 hover:text-blue-500 hover:bg-blue-50 hover:scale-110 transition-all"
                                    title="回覆"
                                >
                                    <Reply size={14} />
                                </button>
                                
                                {(isMine || currentUser.role === 'admin' || currentUser.role === 'superadmin') && (
                                    <div className="relative">
                                        <button 
                                            aria-label="留言操作"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveMessageId(activeMessageId === comment.id ? null : comment.id);
                                            }}
                                            className={`p-2 rounded-full shadow-sm border transition-all hover:scale-110 ${
                                                isActive 
                                                    ? 'bg-blue-50 text-blue-600 border-blue-200' 
                                                    : 'bg-white/80 backdrop-blur text-gray-500 border-white/50 hover:text-gray-900 hover:bg-gray-50'
                                            }`}
                                        >
                                            <MoreHorizontal size={14} />
                                        </button>
                                        
                                        {isActive && (
                                            <div className={`
                                                absolute top-full mt-2 ${isMine ? 'right-0' : 'left-0'} 
                                                bg-white/30 backdrop-blur-md border border-white/20 shadow-sm py-1 w-28 z-30 overflow-hidden animate-scale-in
                                            `}>
                                                <button 
                                                    onClick={() => handlePin(comment)}
                                                    className="w-full px-3 py-2.5 text-left text-xs hover:bg-blue-50/50 flex items-center gap-2 text-gray-700 font-medium"
                                                >
                                                    <Pin size={12} className={pinnedComments.some(p => p.id === comment.id) ? "fill-blue-500 text-blue-500" : ""} /> 
                                                    {pinnedComments.some(p => p.id === comment.id) ? '取消置頂' : '置頂'}
                                                </button>
                                                <button 
                                                    onClick={() => handleRetract(comment)}
                                                    className="w-full px-3 py-2.5 text-left text-xs hover:bg-gray-50/50 flex items-center gap-2 text-gray-700 font-medium"
                                                >
                                                    <RotateCcw size={12} /> 收回
                                                </button>
                                                <button 
                                                    onClick={() => handleDelete(comment)}
                                                    className="w-full px-3 py-2.5 text-left text-xs hover:bg-red-50/50 flex items-center gap-2 text-red-600 font-medium"
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

    // Widget Mode: Minimized State
    if (mode === 'widget' && isMinimized) {
        return (
            <div
                style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 50 }}
                className="w-14 h-14 bg-black/80 backdrop-blur-xl text-white rounded-full shadow-2xl border border-white/10 cursor-pointer hover:scale-110 transition-all duration-300 flex items-center justify-center group"
                onClick={() => setIsMinimized(false)}
            >
                <MessageSquare size={24} className="group-hover:scale-110 transition-transform" />
                {comments.length > 0 && (
                    <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white dark:border-gray-900">
                        {comments.length}
                    </div>
                )}
            </div>
        );
    }

    const containerClasses = mode === 'widget' 
        ? "fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-50 w-full sm:w-[380px] h-[min(600px,100dvh)] rounded-[24px] bg-white/80 backdrop-blur-2xl shadow-2xl border border-white/40 flex flex-col overflow-hidden transition-all duration-300"
        : "flex flex-col min-h-0 h-full bg-transparent relative w-full";

    return (
        <div className={containerClasses}>
            {/* Header */}
            <div className={`${mode === 'widget' ? 'px-5 py-4 bg-white/50 border-b border-gray-100' : 'glass-panel m-4 mb-0 px-5 py-4 rounded-3xl'} flex items-center justify-between z-10`}>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
                        <MessageSquare size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-gray-900">團隊討論</h3>
                        <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            {comments.length} 則留言
                        </p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    {mode === 'widget' && (
                        <button onClick={() => setIsMinimized(true)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400">
                            <X size={18} />
                        </button>
                    )}
                    {mode !== 'widget' && (
                        <button 
                            onClick={() => { setMentionsOpen(!mentionsOpen); fetchMentions(); }}
                            aria-label="提及收件匣"
                            className="p-2 hover:bg-white/50 rounded-xl text-gray-500 hover:text-gray-700 relative transition-all"
                        >
                            <AtSign size={20} />
                            {mentionsUnread > 0 && (
                                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
                            )}
                        </button>
                    )}
                </div>
            </div>

            <div className="mx-4 mt-2">
                <input type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)}
                    aria-label="搜尋已載入留言" placeholder="搜尋已載入留言" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
                {mentionsOpen && <div ref={mentionsRef} className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-blue-100 bg-white p-3">
                    <p className="mb-2 text-xs font-medium text-gray-500">未讀提及</p>
                    {mentions.length === 0 ? <p className="text-sm text-gray-500">目前沒有未讀提及</p> : mentions.map(mention => <button key={mention.comment_id} type="button"
                        className="mb-1 block w-full rounded-lg p-2 text-left text-sm hover:bg-blue-50"
                        onClick={() => {
                            const element = scrollContainerRef.current?.querySelector(`[id="comment-${mention.comment_id}"]`);
                            if (element) { setSearchTerm(''); element.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
                            else toast.info('這則留言位於較早對話，請載入更早留言後查看。');
                        }}><MessageTimestamp value={mention.comment_created_at || mention.created_at} className="block mb-1 text-[11px] text-gray-500" />{mention.content}</button>)}
                </div>}
            </div>
            {/* Pinned Section */}
            {pinnedComments.length > 0 && (
                <div className="mx-4 mt-2 max-h-40 shrink-0 overflow-y-auto bg-blue-50/60 backdrop-blur-md border border-blue-100/50 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-700 mb-2">
                        <Pin size={12} className="fill-blue-700" /> 我的釘選
                    </div>
                    <div className="space-y-2">
                        {pinnedComments.map(pin => (
                            <div key={pin.id} className="bg-white/60 p-2.5 rounded-xl border border-white/50 shadow-sm text-sm text-gray-700 flex items-start gap-2 group/pin relative">
                                <UserAvatar name={pin.user_name || '系統'} size="sm" />
                                <div className="min-w-0 flex-1 pr-6">
                                    <MessageTimestamp value={pin.created_at} className="block mb-1 text-[11px] text-gray-500" />
                                    <span className="font-bold text-gray-900 mr-1">{pin.user_name || '系統'}:</span>
                                    <span className="break-all">{pin.content}</span>
                                </div>
                                <button 
                                    onClick={() => handlePin(pin)}
                                    className="absolute right-2 top-2 opacity-0 group-hover/pin:opacity-100 p-1.5 hover:bg-red-50 rounded-full text-gray-400 hover:text-red-500 transition-all"
                                    title="取消置頂"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <CommentsLoadState isError={isError} error={error} isFetching={isFetching}
                retry={isFetchNextPageError ? loadOlder : refetch} hasNewMessages={hasNewMessages} jumpToLatest={jumpToLatest} />
            {/* Comments List */}
            <div ref={scrollContainerRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-6">
                {hasNextPage && <button type="button" disabled={isFetching} onClick={loadOlder}
                    className="mx-auto block rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-blue-700 disabled:opacity-50">
                    {isFetchingNextPage ? '載入中…' : '載入更早留言'}
                </button>}
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
                ) : comments.length === 0 && !isError ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="w-24 h-24 bg-white/30 backdrop-blur rounded-full flex items-center justify-center mb-4 shadow-inner">
                            <MessageSquare size={40} className="text-gray-300" />
                        </div>
                        <p className="text-base font-bold text-gray-500">尚無討論</p>
                        <p className="text-sm text-gray-400 mt-1">開始第一則留言...</p>
                    </div>
                ) : (
                    comments
                        .filter(c => c.content.includes(searchTerm))
                        .map(renderComment)
                )}
                <div ref={commentsEndRef} />
            </div>

            {sendError && <div role="alert" className="mx-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{sendError}。內容已保留，請先重新整理確認是否送達。</div>}
            {/* Input Area */}
            <div className="shrink-0 p-3 sm:p-4 z-20 pb-[max(12px,env(safe-area-inset-bottom))]">
                <div className="bg-white/30 backdrop-blur-md border border-white/20 shadow-sm p-2 rounded-[2rem]">
                    {/* Reply Preview */}
                    {replyTo && (
                        <div className="flex items-center justify-between bg-blue-50/50 px-4 py-3 rounded-2xl border border-blue-100/50 mb-2 mx-2 animate-slide-up backdrop-blur-sm">
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
                                className="p-1.5 hover:bg-blue-100/50 rounded-full text-blue-400 hover:text-blue-600 transition-colors"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    <div className="flex items-end gap-2">
                        <div className={`min-w-0 flex-1 bg-gray-50/50 rounded-[1.5rem] border border-transparent transition-all duration-300 flex flex-col focus-within:bg-white/80 focus-within:shadow-inner`}>
                            <textarea
                                ref={textareaRef}
                                value={newComment}
                                onChange={handleInputChange}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                                placeholder={replyTo ? `回覆 ${replyTo.user_name}...` : "輸入訊息..."}
                                className="w-full px-5 py-3 bg-transparent border-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none resize-none max-h-32 min-h-[48px] text-sm text-gray-900 placeholder:text-gray-400 caret-blue-500"
                                rows={1}
                                style={{ height: 'auto', minHeight: '48px' }}
                            />
                            
                            {/* Toolbar */}
                            <div className="flex items-center justify-between px-3 pb-2">
                                <div className="flex flex-wrap items-center gap-1">
                                    <button
                                        onClick={() => setShowQuickReplies(!showQuickReplies)}
                                        className={`p-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold ${showQuickReplies ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100/50 hover:text-gray-600'}`}
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
                                                : 'text-gray-400 hover:bg-gray-100/50 hover:text-gray-600'
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
                            disabled={!newComment.trim() || loading}
                            className={`
                                w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 flex-shrink-0
                                ${newComment.trim() 
                                    ? 'bg-gradient-to-br from-blue-500 to-purple-600 text-white hover:scale-110 hover:shadow-blue-500/40' 
                                    : 'bg-gray-100 text-gray-300 cursor-not-allowed'}
                            `}
                        >
                            {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                        </button>
                    </div>
                </div>

                {/* Quick Replies Panel */}
                {showQuickReplies && (
                    <div className="mt-3 flex flex-wrap gap-2 animate-slide-down px-2">
                        {QUICK_REPLIES.map((reply, idx) => (
                            <button
                                key={idx}
                                onClick={() => applyQuickReply(reply)}
                                className="px-4 py-2 bg-white/80 backdrop-blur border border-white/50 hover:border-blue-300 hover:bg-blue-50 rounded-xl text-xs font-bold text-gray-600 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95"
                            >
                                {reply.text}
                            </button>
                        ))}
                    </div>
                )}

                {/* Mentions Dropdown */}
                {showMentions && filteredUsers.length > 0 && (
                    <div className="absolute bottom-24 left-4 bg-white/30 backdrop-blur-md border border-white/20 shadow-sm max-h-48 overflow-y-auto z-20 w-64 animate-slide-up">
                        {filteredUsers.slice(0, 5).map(user => (
                            <button
                                key={user.id}
                                onClick={() => insertMention(user)}
                                className="w-full px-4 py-3 hover:bg-blue-50/50 text-left flex items-center gap-3 transition-colors border-b border-gray-50/50 last:border-0"
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
