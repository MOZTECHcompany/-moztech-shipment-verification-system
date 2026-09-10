// FloatingChatPanel.jsx - 類似 iMessage 的現代化浮動討論面板
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Minus, Maximize2, Minimize2, Send, Smile, AlertTriangle, MessageSquare, Paperclip, Image as ImageIcon, Mic } from 'lucide-react';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket';
import { useComments } from '@/api/useComments.js';
import { useVisibleCommentReads } from '@/api/useVisibleCommentReads';
import { useCommentScroll } from '@/api/useCommentScroll';
import { CommentsLoadState } from './CommentsLoadState';
import { Button, Badge, EmptyState, Skeleton } from '../ui';

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 600;
const PANEL_GAP = 24;

const getContentRightEdge = () => {
    if (typeof window === 'undefined') return null;
    const contentEl = document.querySelector('[data-layout-content]');
    if (!contentEl) return null;
    const rect = contentEl.getBoundingClientRect();
    return rect.right;
};

const getXBounds = () => {
    if (typeof window === 'undefined') return { min: PANEL_GAP, max: PANEL_GAP };
    const viewportWidth = window.innerWidth;
    const potentialMax = viewportWidth - PANEL_WIDTH - PANEL_GAP;
    const min = Math.min(PANEL_GAP, potentialMax);
    const max = Math.max(PANEL_GAP, potentialMax);
    return { min, max };
};

const getYBounds = () => {
    if (typeof window === 'undefined') return { min: PANEL_GAP, max: PANEL_GAP };
    const viewportHeight = window.innerHeight;
    const bottomAlignTop = viewportHeight - PANEL_HEIGHT - PANEL_GAP;
    const min = Math.min(PANEL_GAP, bottomAlignTop);
    const max = Math.max(PANEL_GAP, bottomAlignTop);
    return { min, max };
};

const clampToBounds = (value, { min, max }) => {
    if (Number.isNaN(value)) return min;
    if (min === max) return min;
    return Math.min(Math.max(value, min), max);
};

const getPortalTarget = () => {
    if (typeof document === 'undefined') return null;
    return document.body;
};

const getDefaultPosition = (index, alignToContent) => {
    if (typeof window === 'undefined') {
        return { x: PANEL_GAP, y: PANEL_GAP };
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const yBounds = getYBounds();
    const desiredY = viewportHeight - PANEL_HEIGHT - PANEL_GAP;
    const y = clampToBounds(desiredY, yBounds);

    if (alignToContent) {
        const contentRight = getContentRightEdge();
        if (typeof contentRight === 'number') {
            const stackOffset = index * (PANEL_WIDTH + PANEL_GAP);
            const rightEdge = Math.max(PANEL_WIDTH + PANEL_GAP, contentRight - PANEL_GAP - stackOffset);
            const xBounds = getXBounds();
            const x = clampToBounds(rightEdge - PANEL_WIDTH, xBounds);
            return { x, y };
        }
    }

    const rightOffset = PANEL_GAP + index * (PANEL_WIDTH + PANEL_GAP);
    const xBounds = getXBounds();
    const x = clampToBounds(viewportWidth - PANEL_WIDTH - rightOffset, xBounds);
    return { x, y };
};

const FloatingChatPanel = ({ orderId, voucherNumber, onClose, position = 0, alignToContent = false }) => {
    const [isMinimized, setIsMinimized] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [panelPosition, setPanelPosition] = useState(() => getDefaultPosition(position, alignToContent));
    const [message, setMessage] = useState('');
    const [priority, setPriority] = useState('normal');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [users, setUsers] = useState([]);
    const [showUserMention, setShowUserMention] = useState(false);
    const [mentionSearch, setMentionSearch] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [sendError, setSendError] = useState(null);
    const sendingRef = useRef(false);
    const scrollContainerRef = useRef(null);
    
    const panelRef = useRef(null);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    
    // 使用 useComments hook 獲取評論數據
    const { comments, isLoading, isError, error, refetch, isFetching, isFetchingNextPage, isFetchNextPageError, fetchNextPage, hasNextPage, invalidate, markVisibleRead, currentUserId } = useComments(orderId);
    const loading = isLoading;
    const { onScroll, loadOlder, jumpToLatest, hasNewMessages } = useCommentScroll({
        rootRef: scrollContainerRef, comments, orderId, fetchNextPage, enabled: !isMinimized
    });
    useVisibleCommentReads({ orderId, rootRef: scrollContainerRef, comments, markVisibleRead, enabled: !isMinimized });


    const recomputePosition = useCallback(() => {
        const next = getDefaultPosition(position, alignToContent);
        setPanelPosition(prev => (prev.x === next.x && prev.y === next.y ? prev : next));
    }, [position, alignToContent]);

    useEffect(() => {
        if (isMaximized || isDragging) return;
        recomputePosition();
    }, [position, alignToContent, isMaximized, isDragging, recomputePosition]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleResize = () => {
            if (isMaximized || isDragging) return;
            recomputePosition();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [recomputePosition, isMaximized, isDragging]);

    useEffect(() => {
        const onChange = event => { if (String(event.orderId) === String(orderId)) invalidate(); };
        const events = ['new_comment', 'comment_deleted', 'comment_retracted'];
        events.forEach(name => socket.on(name, onChange));
        const timer = setInterval(invalidate, 60000);
        return () => { clearInterval(timer); events.forEach(name => socket.off(name, onChange)); };
    }, [orderId, invalidate]);

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

    // 拖曳功能
    const handleMouseDown = (e) => {
        if (window.innerWidth >= 640 && e.target.closest('.drag-handle') && !e.target.closest('button')) {
            setIsDragging(true);
            dragStartPos.current = {
                x: e.clientX - panelPosition.x,
                y: e.clientY - panelPosition.y
            };
        }
    };

    const handleMouseMove = useCallback((e) => {
        if (isDragging) {
            const xBounds = getXBounds();
            const yBounds = getYBounds();
            const rawX = e.clientX - dragStartPos.current.x;
            const rawY = e.clientY - dragStartPos.current.y;
            setPanelPosition({
                x: clampToBounds(rawX, xBounds),
                y: clampToBounds(rawY, yBounds)
            });
        }
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

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
        if (!message.trim() || sendingRef.current) return;
        sendingRef.current = true;
        setIsSending(true); setSendError(null);
        const submitted = message;
        try {
            await apiClient.post(`/api/tasks/${orderId}/comments`, { content: submitted, priority, parent_id: null });
            setMessage(value => value === submitted ? '' : value);
            setPriority('normal');
            jumpToLatest();
            await invalidate();
        } catch (error) {
            setSendError(error.response?.data?.message || error.message || '留言未送出，內容已保留');
        } finally { sendingRef.current = false; setIsSending(false); }
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

    const portalTarget = getPortalTarget();
    if (!portalTarget) return null;

    const minimizedFab = (
        <div
            style={{
                position: 'fixed',
                right: 24,
                bottom: 24,
                zIndex: 50
            }}
            className="w-14 h-14 bg-black/80 backdrop-blur-xl text-white rounded-full shadow-2xl border border-white/10 cursor-pointer hover:scale-110 transition-all duration-300 flex items-center justify-center group"
            onClick={() => {
                setIsMinimized(false);
                recomputePosition();
            }}
        >
            <MessageSquare size={24} className="group-hover:scale-110 transition-transform" />
            {comments && comments.length > 0 && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white dark:border-gray-900">
                    {comments.length}
                </div>
            )}
        </div>
    );

    const panel = (
        <div
            ref={panelRef}
            style={{
                position: 'fixed',
                left: isMaximized || window.innerWidth < 640 ? 0 : panelPosition.x,
                top: isMaximized || window.innerWidth < 640 ? 0 : panelPosition.y,
                width: isMaximized || window.innerWidth < 640 ? '100%' : PANEL_WIDTH,
                height: isMaximized || window.innerWidth < 640 ? '100dvh' : 'min(600px, calc(100dvh - 24px))',
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

            <CommentsLoadState isError={isError} error={error} isFetching={isFetching}
                retry={isFetchNextPageError ? loadOlder : refetch} hasNewMessages={hasNewMessages} jumpToLatest={jumpToLatest} />
            {/* 消息列表 - iMessage 風格 */}
            <div ref={scrollContainerRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4 bg-gray-50/50 dark:bg-gray-900/50">
                {hasNextPage && <button type="button" disabled={isFetching} onClick={loadOlder}
                    className="mx-auto block rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-blue-700 disabled:opacity-50">
                    {isFetchingNextPage ? '載入中…' : '載入更早留言'}
                </button>}
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
                ) : comments.length === 0 && !isError ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <MessageSquare size={32} className="text-gray-300" />
                        </div>
                        <p className="text-gray-500 font-medium">尚無對話</p>
                        <p className="text-sm text-gray-400 mt-1">開始第一則留言...</p>
                    </div>
                ) : (
                    comments.map((comment, index) => {
                        const isMine = String(comment.user_id) === String(currentUserId);
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
                                        <p data-comment-id={comment.id} className="whitespace-pre-wrap break-words">{comment.content}</p>
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

            {sendError && <div role="alert" className="mx-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{sendError}。內容已保留，請先重新整理確認是否送達。</div>}
            {/* 輸入區域 - 現代化工具列 */}
            <div className="p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:p-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-end gap-2">
                    <div className="flex gap-1 pb-1">
                        <button 
                            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-all"
                            disabled title="圖片附件尚未開放" aria-label="圖片附件尚未開放"
                        >
                            <ImageIcon size={20} />
                        </button>
                        <button 
                            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-all"
                            disabled title="附件尚未開放" aria-label="附件尚未開放"
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
                                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
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

    if (isMinimized) {
        return createPortal(minimizedFab, portalTarget);
    }

    return createPortal(panel, portalTarget);
};

export default FloatingChatPanel;
