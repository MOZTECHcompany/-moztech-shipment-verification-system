// NotificationCenter.jsx - 討論通知中心
import React, { useState, useEffect } from 'react';
import { Bell, MessageSquare, AlertTriangle, AtSign, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';

const NotificationCenter = ({ onOpenChat }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [unreadSummary, setUnreadSummary] = useState({
        total_unread: 0,
        total_urgent: 0,
        orders: []
    });
    const [loading, setLoading] = useState(false);

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
                className="relative p-3 bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition shadow-sm"
            >
                <Bell size={20} className={totalUrgent > 0 ? 'text-red-600 animate-pulse' : 'text-gray-700'} />
                {totalUnread > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center animate-pulse">
                        {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                )}
            </button>

            {/* 下拉面板 */}
            {isOpen && (
                <>
                    {/* 背景遮罩 */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* 通知面板 */}
                    <div className="absolute right-0 top-16 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 max-h-[600px] flex flex-col">
                        {/* 標題欄 */}
                        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Bell size={20} className="text-blue-600" />
                                <h3 className="font-semibold text-lg">訊息通知</h3>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 hover:bg-gray-100 rounded-lg transition"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* 統計摘要 */}
                        <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <div className="text-2xl font-bold text-blue-600">{totalUnread}</div>
                                    <div className="text-xs text-gray-600">未讀訊息</div>
                                </div>
                                <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <div className="text-2xl font-bold text-red-600">{totalUrgent}</div>
                                    <div className="text-xs text-gray-600">緊急訊息</div>
                                </div>
                            </div>
                            
                            {totalUnread > 0 && (
                                <button
                                    onClick={markAllAsRead}
                                    className="mt-2 w-full px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 transition flex items-center justify-center gap-1"
                                >
                                    <Check size={14} />
                                    全部標記為已讀
                                </button>
                            )}
                        </div>

                        {/* 訊息列表 */}
                        <div className="flex-1 overflow-y-auto">
                            {loading ? (
                                <div className="p-8 text-center text-gray-500">載入中...</div>
                            ) : unreadSummary.orders.length === 0 ? (
                                <div className="p-8 text-center text-gray-400">
                                    <MessageSquare size={48} className="mx-auto mb-2 opacity-50" />
                                    <p>目前沒有未讀訊息</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {unreadSummary.orders.map((order) => (
                                        <button
                                            key={order.order_id}
                                            onClick={() => handleOpenChat(order.order_id, order.voucher_number)}
                                            className="w-full px-4 py-3 hover:bg-blue-50 transition text-left group"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                                                    {order.voucher_number?.charAt(0) || 'T'}
                                                </div>
                                                
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-semibold text-sm truncate">
                                                            {order.voucher_number}
                                                        </span>
                                                        {parseInt(order.urgent_count) > 0 && (
                                                            <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full flex items-center gap-1 flex-shrink-0">
                                                                <AlertTriangle size={10} />
                                                                {order.urgent_count}
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    <p className="text-xs text-gray-500 truncate mb-1">
                                                        {order.customer_name}
                                                    </p>
                                                    
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                                            {order.unread_count} 則未讀
                                                        </span>
                                                        <span className="text-gray-400">
                                                            {new Date(order.latest_comment_time).toLocaleTimeString('zh-TW', {
                                                                hour: '2-digit',
                                                                minute: '2-digit'
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="opacity-0 group-hover:opacity-100 transition">
                                                    <MessageSquare size={16} className="text-blue-600" />
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default NotificationCenter;
