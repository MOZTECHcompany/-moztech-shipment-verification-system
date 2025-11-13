// frontend/src/components/TaskComments.jsx
// 任務評論系統 - 支援 @ 提及功能 + 優先級管理

import React, { useState, useEffect, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { 
    MessageSquare, Send, User, AtSign, Reply, Loader2, 
    Pin, AlertCircle, Clock, CheckCircle2, Search, X,
    Star, Bell, Filter, Paperclip
} from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api';

// 優先級配置
const PRIORITIES = {
    urgent: { 
        label: '🔴 緊急', 
        color: 'bg-red-100 text-red-700 border-red-300',
        icon: AlertCircle,
        bgGlow: 'bg-red-50'
    },
    important: { 
        label: '⭐ 重要', 
        color: 'bg-amber-100 text-amber-700 border-amber-300',
        icon: Star,
        bgGlow: 'bg-amber-50'
    },
    normal: { 
        label: '💬 一般', 
        color: 'bg-blue-100 text-blue-700 border-blue-300',
        icon: MessageSquare,
        bgGlow: 'bg-blue-50'
    }
};

// 快速回覆模板
const QUICK_REPLIES = [
    '✅ 已確認',
    '👍 收到',
    '⏳ 處理中',
    '❓ 需要更多資訊',
    '✔️ 已完成',
    '🔄 等待回覆'
];

export function TaskComments({ orderId, currentUser, allUsers }) {
    const [comments, setComments] = useState([]);
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
    const [unreadCount, setUnreadCount] = useState(0);
    
    const textareaRef = useRef(null);
    const mentionsRef = useRef(null);
    const commentsEndRef = useRef(null);

    useEffect(() => {
        fetchComments();
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

    const fetchComments = async () => {
        try {
            const response = await apiClient.get(`/api/tasks/${orderId}/comments`);
            setComments(response.data);
        } catch (error) {
            console.error('載入評論失敗:', error);
        }
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!newComment.trim()) {
            toast.error('請輸入評論內容');
            return;
        }

        setLoading(true);
        try {
            await apiClient.post(`/api/tasks/${orderId}/comments`, {
                content: newComment,
                parent_id: replyTo?.id || null
            });
            
            setNewComment('');
            setReplyTo(null);
            await fetchComments();
            toast.success('評論已發送');
        } catch (error) {
            toast.error('發送評論失敗', {
                description: error.response?.data?.message || '請稍後再試'
            });
        } finally {
            setLoading(false);
        }
    };

    const filteredUsers = allUsers.filter(user => 
        user.id !== currentUser.id &&
        (user.username.toLowerCase().includes(mentionFilter) ||
         user.name.toLowerCase().includes(mentionFilter))
    );

    const renderComment = (comment, isReply = false) => (
        <div 
            key={comment.id} 
            className={`
                glass-card p-4 animate-scale-in
                ${isReply ? 'ml-12 mt-2' : 'mb-3'}
            `}
        >
            <div className="flex items-start gap-3">
                {/* 用戶頭像 */}
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-apple-blue/20 to-apple-purple/20 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-apple-blue" />
                </div>

                <div className="flex-1 min-w-0">
                    {/* 用戶資訊 */}
                    <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">
                            {comment.user_name}
                        </span>
                        <span className="text-xs text-gray-500">
                            @{comment.username}
                        </span>
                        <span className="text-xs text-gray-400">
                            {formatDistanceToNow(new Date(comment.created_at), {
                                addSuffix: true,
                                locale: zhTW
                            })}
                        </span>
                    </div>

                    {/* 評論內容 */}
                    <p className="text-gray-700 whitespace-pre-wrap break-words">
                        {highlightMentions(comment.content)}
                    </p>

                    {/* 回覆按鈕 */}
                    {!isReply && (
                        <button
                            onClick={() => setReplyTo(comment)}
                            className="mt-2 text-sm text-apple-blue hover:text-apple-blue/80 font-medium flex items-center gap-1"
                        >
                            <Reply size={14} />
                            回覆
                        </button>
                    )}
                </div>
            </div>

            {/* 回覆列表 */}
            {comment.replies && comment.replies.length > 0 && (
                <div className="mt-3 space-y-2">
                    {comment.replies.map(reply => renderComment(reply, true))}
                </div>
            )}
        </div>
    );

    const highlightMentions = (text) => {
        const parts = text.split(/(@\w+)/g);
        return parts.map((part, index) => {
            if (part.startsWith('@')) {
                return (
                    <span 
                        key={index}
                        className="text-apple-blue font-semibold bg-apple-blue/10 px-1 rounded"
                    >
                        {part}
                    </span>
                );
            }
            return part;
        });
    };

    return (
        <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-apple-blue/10 to-apple-purple/10 flex items-center justify-center">
                    <MessageSquare className="w-6 h-6 text-apple-blue" />
                </div>
                <div>
                    <h3 className="text-xl font-semibold text-gray-900">
                        💬 任務討論
                    </h3>
                    <p className="text-sm text-gray-500">
                        共 {comments.length} 則評論
                    </p>
                </div>
            </div>

            {/* 評論列表 */}
            <div className="mb-6 max-h-96 overflow-y-auto space-y-3">
                {comments.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                        <MessageSquare className="w-16 h-16 mx-auto mb-3 opacity-30" />
                        <p>尚無評論，成為第一個留言的人！</p>
                    </div>
                ) : (
                    comments.map(comment => renderComment(comment))
                )}
            </div>

            {/* 回覆提示 */}
            {replyTo && (
                <div className="mb-3 glass p-3 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                        <Reply size={16} className="text-apple-blue" />
                        <span className="text-gray-600">
                            回覆 <span className="font-semibold text-gray-900">{replyTo.user_name}</span>
                        </span>
                    </div>
                    <button
                        onClick={() => setReplyTo(null)}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        取消
                    </button>
                </div>
            )}

            {/* 輸入框 */}
            <form onSubmit={handleSubmit} className="relative">
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={newComment}
                        onChange={handleInputChange}
                        placeholder="輸入評論... (使用 @ 提及同事)"
                        className="w-full px-4 py-3 pr-12 rounded-xl border-2 border-gray-200 focus:border-apple-blue focus:outline-none resize-none transition-all font-medium"
                        rows={3}
                    />
                    
                    {/* @ 提及列表 */}
                    {showMentions && filteredUsers.length > 0 && (
                        <div 
                            ref={mentionsRef}
                            className="absolute bottom-full left-0 right-0 mb-2 glass-card max-h-48 overflow-y-auto shadow-apple-lg z-10"
                        >
                            {filteredUsers.map(user => (
                                <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => insertMention(user)}
                                    className="w-full px-4 py-2 flex items-center gap-3 hover:bg-apple-blue/10 transition-colors text-left"
                                >
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-apple-blue/20 to-apple-purple/20 flex items-center justify-center">
                                        <User className="w-4 h-4 text-apple-blue" />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-gray-900">
                                            {user.name}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            @{user.username}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* 發送按鈕 */}
                    <button
                        type="submit"
                        disabled={loading || !newComment.trim()}
                        className="absolute bottom-3 right-3 w-10 h-10 rounded-lg bg-apple-blue/90 hover:bg-apple-blue text-white flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-apple"
                    >
                        {loading ? (
                            <Loader2 size={20} className="animate-spin" />
                        ) : (
                            <Send size={20} />
                        )}
                    </button>
                </div>

                {/* 提示文字 */}
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                        <AtSign size={14} />
                        <span>輸入 @ 提及同事</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Reply size={14} />
                        <span>點擊回覆按鈕回覆評論</span>
                    </div>
                </div>
            </form>
        </div>
    );
}
