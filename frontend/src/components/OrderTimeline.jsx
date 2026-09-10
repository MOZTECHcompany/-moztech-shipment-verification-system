// frontend/src/components/OrderTimeline.jsx
// 訂單操作時間軸組件 - Apple風格視覺化

import React, { useState, useEffect } from 'react';
import { Clock, Package, Box, CheckCircle2, User, FileText, AlertCircle } from 'lucide-react';
import apiClient from '@/api/api.js';
import { format } from 'date-fns';

// 操作類型配置
const actionConfig = {
    order_imported: {
        icon: FileText,
        color: 'blue',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        text: 'text-blue-700',
        dot: 'bg-blue-500',
        title: '訂單匯入'
    },
    order_claimed: {
        icon: User,
        color: 'purple',
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        text: 'text-purple-700',
        dot: 'bg-purple-500',
        title: '任務認領'
    },
    picking_started: {
        icon: Package,
        color: 'indigo',
        bg: 'bg-indigo-50',
        border: 'border-indigo-200',
        text: 'text-indigo-700',
        dot: 'bg-indigo-500',
        title: '開始揀貨'
    },
    item_picked: {
        icon: CheckCircle2,
        color: 'cyan',
        bg: 'bg-cyan-50',
        border: 'border-cyan-200',
        text: 'text-cyan-700',
        dot: 'bg-cyan-500',
        title: '商品揀貨'
    },
    picking_completed: {
        icon: Package,
        color: 'green',
        bg: 'bg-green-50',
        border: 'border-green-200',
        text: 'text-green-700',
        dot: 'bg-green-500',
        title: '揀貨完成'
    },
    packing_started: {
        icon: Box,
        color: 'orange',
        bg: 'bg-orange-50',
        border: 'border-orange-200',
        text: 'text-orange-700',
        dot: 'bg-orange-500',
        title: '開始裝箱'
    },
    item_packed: {
        icon: CheckCircle2,
        color: 'teal',
        bg: 'bg-teal-50',
        border: 'border-teal-200',
        text: 'text-teal-700',
        dot: 'bg-teal-500',
        title: '商品裝箱'
    },
    order_completed: {
        icon: CheckCircle2,
        color: 'emerald',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        text: 'text-emerald-700',
        dot: 'bg-emerald-500',
        title: '訂單完成'
    },
    order_voided: {
        icon: AlertCircle,
        color: 'red',
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-700',
        dot: 'bg-red-500',
        title: '訂單作廢'
    },
    status_change: {
        icon: Clock,
        color: 'gray',
        bg: 'bg-gray-50',
        border: 'border-gray-200',
        text: 'text-gray-700',
        dot: 'bg-gray-500',
        title: '狀態變更'
    }
};

// 時間軸項目組件
const TimelineItem = ({ log, isLast }) => {
    const config = actionConfig[log.action_type] || actionConfig.status_change;
    const Icon = config.icon;
    
    // 解析詳細資訊
    let details = {};
    try {
        details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
    } catch (e) {
        details = log.details || {};
    }

    return (
        <div className="relative pb-8 group">
            {/* 連接線 */}
            {!isLast && (
                <div className="absolute left-6 top-12 bottom-0 w-0.5 bg-gradient-to-b from-gray-300 to-transparent" />
            )}

            <div className="flex gap-4 items-start">
                {/* 時間軸圓點 */}
                <div className={`
                    relative z-10 flex-shrink-0
                    w-12 h-12 rounded-full
                    ${config.bg} ${config.border}
                    border-2
                    flex items-center justify-center
                    group-hover:scale-110 transition-transform duration-200
                    shadow-apple-sm
                `}>
                    <Icon className={`${config.text} w-6 h-6`} />
                    <div className={`
                        absolute -top-1 -right-1
                        w-3 h-3 rounded-full ${config.dot}
                        animate-pulse
                    `} />
                </div>

                {/* 內容卡片 */}
                <div className="flex-1 min-w-0 animate-slide-up">
                    <div className={`
                        glass rounded-2xl p-5 border ${config.border}
                        hover:shadow-apple-lg transition-all duration-300
                    `}>
                        {/* 標題和時間 */}
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <h3 className={`text-lg font-semibold ${config.text}`}>
                                    {config.title}
                                </h3>
                                {log.user_name && (
                                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                                        <User size={14} />
                                        {log.user_name}
                                    </p>
                                )}
                            </div>
                            <div className="text-right">
                                <p className="text-sm font-medium text-gray-900">
                                    {format(new Date(log.created_at), 'HH:mm:ss')}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {format(new Date(log.created_at), 'yyyy-MM-dd')}
                                </p>
                            </div>
                        </div>

                        {/* 詳細資訊 */}
                        {Object.keys(details).length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                                <div className="grid grid-cols-2 gap-3">
                                    {Object.entries(details).map(([key, value]) => (
                                        <div key={key} className="text-sm">
                                            <span className="text-gray-500">{key}: </span>
                                            <span className="font-medium text-gray-900">
                                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// 主時間軸組件
export function OrderTimeline({ orderId }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (orderId) {
            fetchLogs();
        }
    }, [orderId]);

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const response = await apiClient.get(`/api/operation-logs?orderId=${orderId}&limit=100`);
            setLogs(response.data.logs || []);
        } catch (error) {
            console.error('載入操作日誌失敗:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
            </div>
        );
    }

    if (logs.length === 0) {
        return (
            <div className="text-center py-12 glass rounded-2xl">
                <Clock size={48} className="mx-auto mb-4 text-gray-300" />
                <p className="text-gray-500">尚無操作記錄</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto">
            {/* 標題 */}
            <div className="mb-8">
                <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                    操作時間軸
                </h2>
                <p className="text-gray-500 mt-2">
                    共 {logs.length} 筆操作記錄
                </p>
            </div>

            {/* 時間軸列表 */}
            <div className="space-y-0">
                {logs.map((log, index) => (
                    <TimelineItem 
                        key={log.id} 
                        log={log} 
                        isLast={index === logs.length - 1}
                    />
                ))}
            </div>
        </div>
    );
}

export default OrderTimeline;
