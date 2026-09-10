// NotificationCenter.jsx - 現代化通知中心
import React, { useState, useEffect, useRef } from 'react';
import { Bell, MessageSquare, AlertTriangle, X, Check, ChevronRight, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { Button, EmptyState, Skeleton } from '../ui';

const NotificationCenter = ({ onOpenChat }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [unreadSummary, setUnreadSummary] = useState({
        total_unread: 0,
        total_urgent: 0,
        orders: []
    });
    const [loading, setLoading] = useState(false);
    const panelRef = useRef(null);

    // 獲取未讀統計
    const fetchUnreadSummary = async () => {
        setLoading(true);
        try {
            const response = await apiClient.get('/api/comments/unread-summary');
            setUnreadSummary(response.data);
        } catch (error) {
            console.error('獲取未讀統計失敗:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUnreadSummary();
        const interval = setInterval(fetchUnreadSummary, 30000); // 每30秒更新一次
        return () => clearInterval(interval);
    }, []);

    // 監聽新評論
    useEffect(() => {
        const handleNewComment = () => {
            fetchUnreadSummary();
        };

        socket.on('new_comment', handleNewComment);
        socket.on('new_mention', handleNewComment);

        return () => {
            socket.off('new_comment', handleNewComment);
            socket.off('new_mention', handleNewComment);
        };
    }, []);

    // 點擊外部關閉
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (panelRef.current && !panelRef.current.contains(event.target) && !event.target.closest('.notification-trigger')) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // 打開特定訂單的對話
    const handleOpenChat = (orderId, voucherNumber) => {
        onOpenChat(orderId, voucherNumber);
        setIsOpen(false);
    };

    // 全部標記為已讀
    const markAllAsRead = async () => {
        try {
            for (const order of unreadSummary.orders) {
                await apiClient.post(`/api/tasks/${order.order_id}/comments/mark-all-read`);
            }
            toast.success('已全部標記為已讀');
            fetchUnreadSummary();
        } catch (error) {
            toast.error('操作失敗');
        }
    };

    const totalUnread = unreadSummary.total_unread || 0;
    const totalUrgent = unreadSummary.total_urgent || 0;

    return (
        <div className="relative">
            {/* 通知鈴鐺 */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    notification-trigger relative p-3 rounded-xl transition-all duration-300
                    ${isOpen 
                        ? 'bg-blue-50 text-blue-600 shadow-inner' 
                        : 'bg-white/50 hover:bg-white text-gray-600 hover:text-blue-600 hover:shadow-sm border border-transparent hover:border-blue-100'}
                `}
            >
                <Bell size={20} className={totalUrgent > 0 ? 'animate-swing' : ''} />
                {totalUnread > 0 && (
                    <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
                )}
            </button>

            {/* 下拉面板 */}
            {isOpen && (
                <div 
                    ref={panelRef}
                    className="absolute right-0 top-14 w-[400px] bg-white/90 backdrop-blur-2xl rounded-2xl shadow-apple-xl border border-white/20 z-50 max-h-[calc(100vh-120px)] flex flex-col overflow-hidden animate-scale-in origin-top-right"
                >
                    {/* 標題欄 */}
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-white/50">
                        <div>
                            <h3 className="font-bold text-lg text-gray-900">訊息中心</h3>
                            <p className="text-xs text-gray-500 font-medium mt-0.5">
                                您有 {totalUnread} 則未讀訊息
                            </p>
                        </div>
                        {totalUnread > 0 && (
                            <button
                                onClick={markAllAsRead}
                                className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1"
                            >
                                <Check size={14} /> 全部已讀
                            </button>
                        )}
                    </div>

                    {/* 統計摘要卡片 */}
                    {totalUnread > 0 && (
                        <div className="p-3 grid grid-cols-2 gap-3 bg-gray-50/50">
                            <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                                    <MessageSquare size={20} />
                                </div>
                                <div>
                                    <div className="text-xl font-black text-gray-900 leading-none">{totalUnread}</div>
                                    <div className="text-xs text-gray-500 font-medium mt-1">未讀總數</div>
                                </div>
                            </div>
                            <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${totalUrgent > 0 ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-gray-50 text-gray-400'}`}>
                                    <AlertTriangle size={20} />
                                </div>
                                <div>
                                    <div className={`text-xl font-black leading-none ${totalUrgent > 0 ? 'text-red-600' : 'text-gray-900'}`}>{totalUrgent}</div>
                                    <div className="text-xs text-gray-500 font-medium mt-1">緊急事項</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 訊息列表 */}
                    <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[500px]">
                        {loading ? (
                            <div className="p-4 space-y-4">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="flex gap-4 p-2">
                                        <Skeleton className="w-12 h-12 rounded-full" />
                                        <div className="flex-1 space-y-2">
                                            <Skeleton className="h-4 w-24" />
                                            <Skeleton className="h-10 w-full rounded-xl" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : unreadSummary.orders.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                    <Inbox size={32} className="text-gray-300" />
                                </div>
                                <h4 className="text-gray-900 font-bold mb-1">沒有新訊息</h4>
                                <p className="text-sm text-gray-500">目前所有討論都已處理完畢</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {unreadSummary.orders.map((order) => (
                                    <button
                                        key={order.order_id}
                                        onClick={() => handleOpenChat(order.order_id, order.voucher_number)}
                                        className="w-full p-4 hover:bg-blue-50/50 transition-all text-left group relative"
                                    >
                                        {/* 未讀指示點 */}
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        
                                        <div className="flex items-start gap-4">
                                            <div className="relative">
                                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-600 font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                                                    {order.voucher_number?.slice(-2) || '#'}
                                                </div>
                                                {parseInt(order.urgent_count) > 0 && (
                                                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center border-2 border-white shadow-sm animate-pulse">
                                                        <AlertTriangle size={10} />
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                                                        {order.voucher_number}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">
                                                        {new Date(order.latest_comment_time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                
                                                <p className="text-xs text-gray-500 mb-2 truncate">
                                                    {order.customer_name}
                                                </p>
                                                
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${parseInt(order.urgent_count) > 0 ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                                        {order.unread_count} 則新訊息
                                                    </span>
                                                    {parseInt(order.urgent_count) > 0 && (
                                                        <span className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                                                            包含緊急事項
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            <div className="self-center text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all">
                                                <ChevronRight size={18} />
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {/* 底部裝飾 */}
                    <div className="h-2 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-10"></div>
                </div>
            )}
        </div>
    );
};

export default NotificationCenter;
