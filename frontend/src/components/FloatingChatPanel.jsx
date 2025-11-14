// FloatingChatPanel.jsx - 類似 Messenger 的浮動討論面板
import React, { useState, useEffect, useRef } from 'react';
import { X, Minus, Maximize2, Minimize2, Send, Paperclip, Smile, AlertTriangle, AtSign, Pin, Trash2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { useComments } from '@/api/useComments.js';

const FloatingChatPanel = ({ orderId, voucherNumber, onClose, position = 0, onPositionChange }) => {
    const [isMinimized, setIsMinimized] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [panelPosition, setPanelPosition] = useState({
        x: window.innerWidth - 400 - (position * 420),
        y: window.innerHeight - 600
    });
    const [message, setMessage] = useState('');
    const [priority, setPriority] = useState('normal');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [users, setUsers] = useState([]);
    const [showUserMention, setShowUserMention] = useState(false);
    const [mentionSearch, setMentionSearch] = useState('');
    
    const panelRef = useRef(null);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    
    const { comments, loading, sendComment, deleteComment, markAsRead } = useComments(orderId);

    // 獲取用戶列表
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const response = await apiClient.get('/api/users/basic');
                setUsers(response.data);
            } catch (error) {
                console.error('獲取用戶列表失敗:', error);
            }
        };
        fetchUsers();
    }, []);

    // 自動滾動到最新消息
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [comments]);

    // 標記所有評論為已讀
    useEffect(() => {
        if (!isMinimized && comments.length > 0) {
            markAllAsRead();
        }
    }, [comments, isMinimized]);

    const markAllAsRead = async () => {
        try {
            await apiClient.post(`/api/tasks/${orderId}/comments/mark-all-read`);
        } catch (error) {
            console.error('標記已讀失敗:', error);
        }
    };

    // 拖曳功能
    const handleMouseDown = (e) => {
        if (e.target.closest('.drag-handle')) {
            setIsDragging(true);
            dragStartPos.current = {
                x: e.clientX - panelPosition.x,
                y: e.clientY - panelPosition.y
            };
        }
    };

    const handleMouseMove = (e) => {
        if (isDragging) {
            const newX = Math.max(0, Math.min(window.innerWidth - 400, e.clientX - dragStartPos.current.x));
            const newY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragStartPos.current.y));
            setPanelPosition({ x: newX, y: newY });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging]);

    // 處理 @ 提及
    const handleTextChange = (e) => {
        const text = e.target.value;
        setMessage(text);
        
        // 檢查是否觸發 @ 提及
        const cursorPosition = e.target.selectionStart;
        const textBeforeCursor = text.slice(0, cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        
        if (lastAtIndex !== -1) {
            const searchTerm = textBeforeCursor.slice(lastAtIndex + 1);
            if (!searchTerm.includes(' ')) {
                setMentionSearch(searchTerm);
                setShowUserMention(true);
            } else {
                setShowUserMention(false);
            }
        } else {
            setShowUserMention(false);
        }
    };

    // 插入提及
    const insertMention = (username) => {
        const cursorPosition = textareaRef.current.selectionStart;
        const textBeforeCursor = message.slice(0, cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        const textAfterCursor = message.slice(cursorPosition);
        
        const newMessage = message.slice(0, lastAtIndex) + `@${username} ` + textAfterCursor;
        setMessage(newMessage);
        setShowUserMention(false);
        textareaRef.current.focus();
    };

    // 發送消息
    const handleSend = async () => {
        if (!message.trim()) return;
        
        try {
            await sendComment({
                content: message,
                priority: priority
            });
            setMessage('');
            setPriority('normal');
            toast.success('消息已發送');
        } catch (error) {
            toast.error('發送失敗', {
                description: error.response?.data?.message
            });
        }
    };

    // Emoji 選擇器（簡化版）
    const emojis = ['👍', '👎', '❤️', '😂', '😊', '😢', '😡', '🔥', '✅', '❌', '⚠️', '📦', '🚀', '💡', '👀'];

    const insertEmoji = (emoji) => {
        setMessage(prev => prev + emoji);
        setShowEmojiPicker(false);
        textareaRef.current.focus();
    };

    // 過濾用戶列表
    const filteredUsers = users.filter(u => 
        u.username.toLowerCase().includes(mentionSearch.toLowerCase()) ||
        u.name.toLowerCase().includes(mentionSearch.toLowerCase())
    ).slice(0, 5);

    // 最小化時的樣式
    if (isMinimized) {
        return (
            <div
                style={{
                    position: 'fixed',
                    right: 20 + (position * 280),
                    bottom: 20,
                    zIndex: 9999
                }}
                className="bg-white rounded-xl shadow-2xl border-2 border-blue-500 cursor-pointer hover:shadow-2xl transition-all"
                onClick={() => setIsMinimized(false)}
            >
                <div className="px-4 py-3 flex items-center gap-3">
                    <MessageSquare size={20} className="text-blue-600" />
                    <div>
                        <div className="font-semibold text-sm">{voucherNumber}</div>
                        {comments.length > 0 && (
                            <div className="text-xs text-gray-500">
                                {comments.length} 則對話
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={panelRef}
            style={{
                position: 'fixed',
                left: isMaximized ? 0 : panelPosition.x,
                top: isMaximized ? 0 : panelPosition.y,
                width: isMaximized ? '100vw' : 400,
                height: isMaximized ? '100vh' : 600,
                zIndex: 9999,
                transition: isDragging ? 'none' : 'all 0.3s ease'
            }}
            className="bg-white rounded-xl shadow-2xl border-2 border-gray-200 flex flex-col"
            onMouseDown={handleMouseDown}
        >
            {/* 標題欄 */}
            <div className="drag-handle bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3 rounded-t-xl flex items-center justify-between cursor-move">
                <div className="flex items-center gap-2">
                    <MessageSquare size={20} />
                    <div>
                        <div className="font-semibold">{voucherNumber}</div>
                        <div className="text-xs opacity-80">任務討論</div>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsMinimized(true)}
                        className="p-1.5 hover:bg-white/20 rounded-lg transition"
                        title="最小化"
                    >
                        <Minus size={18} />
                    </button>
                    <button
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="p-1.5 hover:bg-white/20 rounded-lg transition"
                        title={isMaximized ? '還原' : '最大化'}
                    >
                        {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/20 rounded-lg transition"
                        title="關閉"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {loading ? (
                    <div className="text-center text-gray-500 py-8">載入中...</div>
                ) : comments.length === 0 ? (
                    <div className="text-center text-gray-400 py-8">
                        <MessageSquare size={48} className="mx-auto mb-2 opacity-50" />
                        <p>還沒有對話，開始第一則留言吧！</p>
                    </div>
                ) : (
                    comments.map((comment) => (
                        <div
                            key={comment.id}
                            className={`flex gap-2 ${comment.is_mine ? 'flex-row-reverse' : ''}`}
                        >
                            {/* 頭像 */}
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                                {comment.user_name?.charAt(0).toUpperCase()}
                            </div>
                            
                            {/* 消息氣泡 */}
                            <div className={`flex-1 max-w-[70%] ${comment.is_mine ? 'items-end' : 'items-start'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-semibold text-gray-700">
                                        {comment.user_name}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        {new Date(comment.created_at).toLocaleTimeString('zh-TW', {
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </span>
                                    {comment.priority === 'urgent' && (
                                        <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full flex items-center gap-1">
                                            <AlertTriangle size={12} />
                                            緊急
                                        </span>
                                    )}
                                </div>
                                
                                <div
                                    className={`px-4 py-2 rounded-2xl ${
                                        comment.is_mine
                                            ? 'bg-blue-600 text-white'
                                            : comment.priority === 'urgent'
                                            ? 'bg-red-50 border-2 border-red-300 text-gray-900'
                                            : 'bg-white border border-gray-200 text-gray-900'
                                    }`}
                                >
                                    <p className="whitespace-pre-wrap break-words text-sm">
                                        {comment.content}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* @ 提及選擇器 */}
            {showUserMention && filteredUsers.length > 0 && (
                <div className="absolute bottom-32 left-4 right-4 bg-white rounded-lg shadow-xl border border-gray-200 max-h-40 overflow-y-auto z-10">
                    {filteredUsers.map(user => (
                        <button
                            key={user.id}
                            onClick={() => insertMention(user.username)}
                            className="w-full px-4 py-2 hover:bg-blue-50 text-left flex items-center gap-2 transition"
                        >
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                                {user.name?.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div className="font-semibold text-sm">{user.name}</div>
                                <div className="text-xs text-gray-500">@{user.username}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Emoji 選擇器 */}
            {showEmojiPicker && (
                <div className="absolute bottom-32 left-4 bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-10">
                    <div className="grid grid-cols-5 gap-2">
                        {emojis.map((emoji, idx) => (
                            <button
                                key={idx}
                                onClick={() => insertEmoji(emoji)}
                                className="text-2xl hover:bg-gray-100 rounded p-1 transition"
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 輸入區域 */}
            <div className="border-t border-gray-200 p-4 bg-white rounded-b-xl">
                {/* 優先級選擇 */}
                <div className="flex gap-2 mb-3">
                    <button
                        onClick={() => setPriority('normal')}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                            priority === 'normal'
                                ? 'bg-gray-200 text-gray-800'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                    >
                        一般
                    </button>
                    <button
                        onClick={() => setPriority('important')}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                            priority === 'important'
                                ? 'bg-orange-200 text-orange-800'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                    >
                        重要
                    </button>
                    <button
                        onClick={() => setPriority('urgent')}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1 ${
                            priority === 'urgent'
                                ? 'bg-red-200 text-red-800'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                    >
                        <AlertTriangle size={12} />
                        緊急
                    </button>
                </div>

                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <textarea
                            ref={textareaRef}
                            value={message}
                            onChange={handleTextChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder="輸入訊息... (Shift+Enter 換行，@ 提及用戶)"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            rows={2}
                        />
                    </div>
                    
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                            title="插入 Emoji"
                        >
                            <Smile size={20} />
                        </button>
                        <button
                            onClick={handleSend}
                            disabled={!message.trim()}
                            className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                            title="發送 (Enter)"
                        >
                            <Send size={20} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FloatingChatPanel;
