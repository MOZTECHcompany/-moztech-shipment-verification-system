// FloatingChatPanel.jsx - 類似 iMessage 的現代化浮動討論面板
import React, { useState, useEffect, useRef } from 'react';
import { X, Minus, Maximize2, Minimize2, Send, Smile, AlertTriangle, MessageSquare, Paperclip, Image as ImageIcon, Mic } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { useComments } from '@/api/useComments.js';
import { Button, Badge, EmptyState, Skeleton } from '../ui';

const FloatingChatPanel = ({ orderId, voucherNumber, onClose, position = 0, onPositionChange }) => {
    const [isMinimized, setIsMinimized] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [panelPosition, setPanelPosition] = useState({
        // 加入 position 偏移量，讓多個視窗開啟時會稍微錯開，不會完全重疊
        x: window.innerWidth - 404 - (position * 30), 
        y: window.innerHeight - 624 - (position * 30)
    });
    const [message, setMessage] = useState('');
    const [priority, setPriority] = useState('normal');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [users, setUsers] = useState([]);
    const [showUserMention, setShowUserMention] = useState(false);
    const [mentionSearch, setMentionSearch] = useState('');
    const [isSending, setIsSending] = useState(false);
    
    const panelRef = useRef(null);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    
    // 使用 useComments hook 獲取評論數據
    const { data, isLoading, invalidate, addOptimistic } = useComments(orderId);
    const comments = (data?.pages || []).flatMap(p => p.items ?? []);
    const loading = isLoading;

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

    // 自動滾動
    useEffect(() => {
        if (messagesEndRef.current) {
            const container = messagesEndRef.current.parentElement;
            if (container) {
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        }
    }, [comments, isMaximized]);

    // 標記所有評論為已讀
    useEffect(() => {
        if (!isMinimized && comments && comments.length > 0) {
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
        if (!message.trim() || isSending) return;
        
        setIsSending(true);
        const currentMessage = message;
        const currentPriority = priority;

        try {
            // 樂觀更新：立即顯示訊息
            const draft = {
                id: `temp_${Date.now()}`,
                content: currentMessage,
                priority: currentPriority,
                parent_id: null,
                created_at: new Date().toISOString(),
                user_id: 99999, // 暫時 ID，會被後端覆蓋但這裡用於判斷 is_mine
                is_mine: true,
                user_name: '我', // 暫時名稱
                __optimistic: true,
            };
            addOptimistic(draft);

            setMessage('');
            setPriority('normal');

            // 直接使用 apiClient 發送評論
            await apiClient.post(`/api/tasks/${orderId}/comments`, {
                content: currentMessage,
                priority: currentPriority,
                parent_id: null
            });
            
            // 重新獲取評論列表
            await invalidate();
            
            // 音效回饋
            const audio = new Audio('/sounds/sent.mp3'); // 假設有這個音效，若無則忽略
            audio.play().catch(() => {});
            
        } catch (error) {
            toast.error('發送失敗', {
                description: error.response?.data?.message || error.message
            });
            // 失敗時恢復訊息（可選）
            setMessage(currentMessage);
        } finally {
            setIsSending(false);
        }
    };

    // Emoji 選擇器（簡化版）
    const emojis = ['👍', '👎', '❤️', '😂', '😊', '😢', '😡', '🔥', '✅', '❌', '⚠️', '📦', '🚀', '💡', '👀'];

    const insertEmoji = (emoji) => {
        setMessage(prev => prev + emoji);
        setShowEmojiPicker(false);
        textareaRef.current.focus();
    };

    // 過濾用戶列表 - 添加安全檢查
    const filteredUsers = (users || []).filter(u => 
        u.username?.toLowerCase().includes(mentionSearch.toLowerCase()) ||
        u.name?.toLowerCase().includes(mentionSearch.toLowerCase())
    ).slice(0, 5);

    // 最小化時的樣式 - 圓形 FAB
    if (isMinimized) {
        return (
            <div
                style={{
                    position: 'fixed',
                    right: 24 + (position * 70), // 最小化時橫向排列
                    bottom: 24,
                    zIndex: 50
                }}
                className="w-14 h-14 bg-black/80 backdrop-blur-xl text-white rounded-full shadow-2xl border border-white/10 cursor-pointer hover:scale-110 transition-all duration-300 flex items-center justify-center group"
                onClick={() => setIsMinimized(false)}
            >
                <MessageSquare size={24} className="group-hover:scale-110 transition-transform" />
                {comments && comments.length > 0 && (
                    <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white dark:border-gray-900">
                        {comments.length}
                    </div>
                )}
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
                width: isMaximized ? '100vw' : 380,
                height: isMaximized ? '100vh' : 600,
                zIndex: 50,
                transition: isDragging ? 'none' : 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            className={`
                flex flex-col overflow-hidden
                ${isMaximized ? 'rounded-none' : 'rounded-[24px]'}
                bg-white/80 backdrop-blur-2xl shadow-2xl border border-white/40
                dark:bg-gray-900/80 dark:border-gray-700
            `}
            onMouseDown={handleMouseDown}
        >
            {/* 標題欄 - 擬態風格 */}
            <div className="drag-handle bg-white/80 dark:bg-gray-800/80 backdrop-blur-md px-5 py-4 flex items-center justify-between cursor-move border-b border-gray-200/50 dark:border-gray-700/50 sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                        <MessageSquare size={20} />
                    </div>
                    <div>
                        <div className="font-bold text-gray-900 dark:text-white text-base leading-none mb-1">{voucherNumber}</div>
                        <div className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            線上討論中
                        </div>
                    </div>
                </div>
                
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsMinimized(true)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all text-gray-400 hover:text-gray-600"
                    >
                        <Minus size={18} />
                    </button>
                    <button
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all text-gray-400 hover:text-gray-600"
                    >
                        {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 rounded-xl transition-all text-gray-400"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* 消息列表 - iMessage 風格 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50/50 dark:bg-gray-900/50">
                {loading ? (
                    <div className="space-y-6">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className={`flex gap-3 ${i % 2 === 0 ? '' : 'flex-row-reverse'}`}>
                                <Skeleton className="w-10 h-10 rounded-full" />
                                <div className="space-y-2 max-w-[70%]">
                                    <Skeleton className="h-12 w-48 rounded-2xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : !comments || comments.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <MessageSquare size={32} className="text-gray-300" />
                        </div>
                        <p className="text-gray-500 font-medium">尚無對話</p>
                        <p className="text-sm text-gray-400 mt-1">開始第一則留言...</p>
                    </div>
                ) : (
                    comments.map((comment, index) => {
                        const isMine = comment.is_mine;
                        const isUrgent = comment.priority === 'urgent';
                        const showAvatar = index === 0 || comments[index - 1].user_id !== comment.user_id;

                        return (
                            <div
                                key={comment.id}
                                className={`flex gap-3 ${isMine ? 'flex-row-reverse' : ''} group animate-fade-in`}
                            >
                                {/* Avatar */}
                                <div className={`flex-shrink-0 flex flex-col items-center ${!showAvatar ? 'invisible' : ''}`}>
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-200 font-bold text-xs shadow-sm border border-white dark:border-gray-800">
                                        {comment.user_name?.charAt(0).toUpperCase()}
                                    </div>
                                </div>

                                <div className={`flex flex-col max-w-[75%] ${isMine ? 'items-end' : 'items-start'}`}>
                                    {/* Name & Time */}
                                    {showAvatar && (
                                        <div className={`flex items-center gap-2 mb-1 px-1 ${isMine ? 'flex-row-reverse' : ''}`}>
                                            <span className="text-[11px] font-bold text-gray-500">
                                                {comment.user_name}
                                            </span>
                                            <span className="text-[10px] text-gray-400">
                                                {new Date(comment.created_at).toLocaleTimeString('zh-TW', {
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                    )}

                                    {/* Message Bubble */}
                                    <div
                                        className={`
                                            relative px-4 py-2.5 text-[15px] leading-relaxed shadow-sm transition-all
                                            ${isMine 
                                                ? 'bg-blue-500 text-white rounded-2xl rounded-tr-sm' 
                                                : isUrgent
                                                    ? 'bg-red-50 text-gray-900 border border-red-200 rounded-2xl rounded-tl-sm shadow-red-100'
                                                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-sm'
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
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* @ 提及選擇器 */}
            {showUserMention && filteredUsers.length > 0 && (
                <div className="absolute bottom-24 left-4 right-4 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 max-h-48 overflow-y-auto z-20 p-2 animate-slide-up">
                    {filteredUsers.map(user => (
                        <button
                            key={user.id}
                            onClick={() => insertMention(user.username)}
                            className="w-full px-3 py-2.5 hover:bg-blue-50 rounded-xl text-left flex items-center gap-3 transition-colors group"
                        >
                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-xs group-hover:bg-blue-200 group-hover:text-blue-700 transition-colors">
                                {user.name?.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div className="font-bold text-sm text-gray-900">{user.name}</div>
                                <div className="text-xs text-gray-500">@{user.username}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* 輸入區域 - 現代化工具列 */}
            <div className="p-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-end gap-2">
                    <div className="flex gap-1 pb-1">
                        <button 
                            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-all"
                            title="上傳圖片 (模擬)"
                        >
                            <ImageIcon size={20} />
                        </button>
                        <button 
                            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-all"
                            title="附件 (模擬)"
                        >
                            <Paperclip size={20} />
                        </button>
                    </div>

                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-[24px] border border-transparent focus-within:bg-white dark:focus-within:bg-gray-900 focus-within:shadow-sm focus-within:ring-1 focus-within:ring-black/5 transition-all duration-200 flex flex-col">
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
                            placeholder="輸入訊息..."
                            className="w-full px-4 py-3 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[44px] text-sm placeholder:text-gray-400"
                            rows={1}
                            style={{ height: 'auto', minHeight: '44px' }}
                        />
                        
                        {/* 底部工具列 (Emoji, Priority) */}
                        <div className="flex items-center justify-between px-2 pb-1">
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                    className="p-1.5 text-gray-400 hover:text-yellow-500 rounded-full transition-colors"
                                >
                                    <Smile size={18} />
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
                        onClick={handleSend}
                        disabled={!message.trim() || isSending}
                        className={`
                            w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all duration-300
                            ${message.trim() && !isSending
                                ? 'bg-blue-500 text-white hover:bg-blue-600 hover:scale-110 hover:rotate-12' 
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
                        `}
                    >
                        {isSending ? (
                            <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <Send size={20} className={message.trim() ? 'ml-0.5' : ''} />
                        )}
                    </button>
                </div>
                
                {/* Emoji Picker Popover */}
                {showEmojiPicker && (
                    <div className="absolute bottom-20 left-4 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 p-3 z-20 animate-scale-in origin-bottom-left">
                        <div className="grid grid-cols-5 gap-1">
                            {emojis.map((emoji, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => insertEmoji(emoji)}
                                    className="text-2xl hover:bg-gray-100 rounded-lg p-2 transition-transform hover:scale-125"
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FloatingChatPanel;
