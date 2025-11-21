// frontend/src/components/TaskComments-modern.jsx
// 任務評論系統 - 現代化重構版 (iMessage 風格)

import React, { useState, useEffect, useRef } from 'react';
import { socket } from '@/api/socket';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { 
    MessageSquare, Send, User, AtSign, Reply, Loader2, 
    Pin, AlertCircle, Clock, CheckCircle2, Search, X,
    Star, Bell, Filter, Paperclip, Upload, Image as ImageIcon,
    TrendingUp, Users, ChevronDown, Smile, AlertTriangle, Mic
} from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api';
import { useComments } from '@/api/useComments';
import DesktopNotification from '@/utils/desktopNotification';
import SoundNotification from '@/utils/soundNotification';
import { Button, Skeleton } from '@/ui';

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
    
    const textareaRef = useRef(null);
    const mentionsRef = useRef(null);
    const commentsEndRef = useRef(null);
    const mentionPulseRef = useRef(new Set());
    const notifierRef = useRef(null);
    const soundRef = useRef(null);

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
            socket.on('new_mention', onNewMention);
            return () => {
                clearInterval(interval);
                socket.off('new_comment', onNewComment);
                socket.off('new_mention', onNewMention);
            };
        } catch (e) {
            return () => clearInterval(interval);
        }
    }, [orderId]);

    // 自動滾動
    useEffect(() => {
        commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [comments.length]); // 簡單依賴長度變化

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

        return (
            <div key={comment.id} className={`flex gap-3 mb-4 ${isMine ? 'flex-row-reverse' : ''} group`}>
                {/* Avatar */}
                <div className="flex-shrink-0 flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-gray-600 font-bold text-xs shadow-sm border-2 border-white">
                        {comment.user_name?.charAt(0).toUpperCase()}
                    </div>
                </div>

                <div className={`flex flex-col max-w-[80%] ${isMine ? 'items-end' : 'items-start'}`}>
                    {/* Name & Time */}
                    <div className={`flex items-center gap-2 mb-1 px-1 ${isMine ? 'flex-row-reverse' : ''}`}>
                        <span className="text-[11px] font-bold text-gray-500">{comment.user_name}</span>
                        <span className="text-[10px] text-gray-400">
                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: zhTW })}
                        </span>
                        {isPinned && <Pin size={10} className="text-blue-500 fill-blue-500" />}
                    </div>

                    {/* Message Bubble */}
                    <div
                        className={`
                            relative px-4 py-2.5 text-[15px] leading-relaxed shadow-sm
                            ${isMine 
                                ? 'bg-blue-500 text-white rounded-[20px] rounded-tr-sm' 
                                : isUrgent
                                    ? 'bg-red-50 text-gray-900 border border-red-200 rounded-[20px] rounded-tl-sm shadow-red-100'
                                    : 'bg-white text-gray-900 border border-gray-100 rounded-[20px] rounded-tl-sm'
                            }
                        `}
                    >
                        {isUrgent && !isMine && (
                            <div className="flex items-center gap-1 text-red-500 text-xs font-bold mb-1 uppercase tracking-wider">
                                <AlertTriangle size={10} /> Urgent
                            </div>
                        )}
                        <p className="whitespace-pre-wrap break-words">{comment.content}</p>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-[600px] bg-gray-50/50 rounded-2xl overflow-hidden border border-gray-200">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md px-4 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                        <MessageSquare size={16} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-gray-900">團隊討論</h3>
                        <p className="text-xs text-gray-500">{comments.length} 則留言</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-1">
                    <button 
                        onClick={() => setMentionsOpen(!mentionsOpen)}
                        className="p-2 hover:bg-gray-100 rounded-full text-gray-500 relative"
                    >
                        <AtSign size={18} />
                        {mentionsUnread > 0 && (
                            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                        )}
                    </button>
                    <div className="h-4 w-px bg-gray-200 mx-1"></div>
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                        <input 
                            type="text" 
                            placeholder="搜尋..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-7 pr-3 py-1.5 bg-gray-100 rounded-full text-xs w-32 focus:w-48 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                    </div>
                </div>
            </div>

            {/* Pinned Section */}
            {pinnedComments.length > 0 && (
                <div className="bg-blue-50/50 border-b border-blue-100 px-4 py-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-700 mb-2">
                        <Pin size={12} className="fill-blue-700" /> 置頂公告
                    </div>
                    <div className="space-y-2">
                        {pinnedComments.map(pin => (
                            <div key={pin.id} className="bg-white p-2 rounded-lg border border-blue-100 shadow-sm text-sm text-gray-700">
                                <span className="font-bold text-gray-900 mr-1">{pin.user_name}:</span>
                                {pin.content}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {isLoading ? (
                    <div className="space-y-4">
                        {[1,2,3].map(i => (
                            <div key={i} className="flex gap-3">
                                <Skeleton className="w-8 h-8 rounded-full" />
                                <div className="space-y-2 w-2/3">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-10 w-full rounded-2xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : comments.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <MessageSquare size={40} className="mb-2 opacity-20" />
                        <p className="text-sm">尚無討論</p>
                    </div>
                ) : (
                    comments
                        .filter(c => c.content.includes(searchTerm))
                        .map(renderComment)
                )}
                <div ref={commentsEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-200">
                {/* Quick Replies */}
                {showQuickReplies && (
                    <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
                        {QUICK_REPLIES.map((reply, idx) => (
                            <button
                                key={idx}
                                onClick={() => useQuickReply(reply)}
                                className="whitespace-nowrap px-3 py-1.5 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-full text-xs text-gray-600 transition-colors"
                            >
                                {reply.text}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex items-end gap-2">
                    <div className="flex-1 bg-gray-100 rounded-[24px] border border-transparent focus-within:border-blue-500/50 focus-within:bg-white focus-within:shadow-md transition-all duration-300 flex flex-col">
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
                            placeholder="輸入訊息..."
                            className="w-full px-4 py-3 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[44px] text-sm"
                            rows={1}
                            style={{ height: 'auto', minHeight: '44px' }}
                        />
                        
                        {/* Toolbar */}
                        <div className="flex items-center justify-between px-2 pb-1">
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                                    className="p-1.5 text-gray-400 hover:text-blue-500 rounded-full transition-colors"
                                    title="快速回覆"
                                >
                                    <TrendingUp size={16} />
                                </button>
                                <div className="h-4 w-px bg-gray-300 mx-1"></div>
                                <button
                                    onClick={() => setPriority(priority === 'urgent' ? 'normal' : 'urgent')}
                                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold transition-all ${
                                        priority === 'urgent' 
                                            ? 'bg-red-100 text-red-600 ring-1 ring-red-200' 
                                            : 'text-gray-400 hover:bg-gray-200'
                                    }`}
                                >
                                    <AlertTriangle size={12} />
                                    {priority === 'urgent' ? '緊急' : '標記緊急'}
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <button
                        onClick={handleSubmit}
                        disabled={!newComment.trim()}
                        className={`
                            w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all duration-300
                            ${newComment.trim() 
                                ? 'bg-blue-500 text-white hover:bg-blue-600 hover:scale-110 hover:rotate-12' 
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
                        `}
                    >
                        <Send size={20} className={newComment.trim() ? 'ml-0.5' : ''} />
                    </button>
                </div>

                {/* Mentions Dropdown */}
                {showMentions && filteredUsers.length > 0 && (
                    <div className="absolute bottom-20 left-4 bg-white rounded-xl shadow-xl border border-gray-200 max-h-48 overflow-y-auto z-20 w-64">
                        {filteredUsers.slice(0, 5).map(user => (
                            <button
                                key={user.id}
                                onClick={() => insertMention(user)}
                                className="w-full px-4 py-2 hover:bg-blue-50 text-left flex items-center gap-3 transition-colors"
                            >
                                <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold">
                                    {user.name?.charAt(0)}
                                </div>
                                <span className="text-sm text-gray-700">{user.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
