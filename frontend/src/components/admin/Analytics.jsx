// frontend/src/components/admin/Analytics.jsx
// 數據分析儀表板

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import {
    ArrowLeft, TrendingUp, Users, Package, Clock,
    Award, Target, BarChart3, Activity, Calendar
} from 'lucide-react';
import {
    PageHeader,
    Card, CardHeader, CardTitle, CardDescription, CardContent,
    Button,
    Skeleton,
    EmptyState,
    Badge,
} from '../../ui';

export function Analytics() {
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState('7days'); // 7days, 30days, 90days
    const [analytics, setAnalytics] = useState({
        overview: {
            totalOrders: 0,
            completedOrders: 0,
            avgPickingTime: 0,
            avgPackingTime: 0,
            errorRate: 0
        },
        userPerformance: [],
        orderTrends: [],
        topProducts: [],
        hourlyDistribution: []
    });

    useEffect(() => {
        fetchAnalytics();
    }, [dateRange]);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const response = await apiClient.get(`/api/analytics?range=${dateRange}`);
            setAnalytics(response.data);
        } catch (error) {
            toast.error('載入分析數據失敗', { 
                description: error.response?.data?.message || '請稍後再試' 
            });
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (minutes) => {
        if (minutes < 60) return `${Math.round(minutes)} 分鐘`;
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours} 小時 ${mins} 分鐘`;
    };

    const formatPercentage = (value) => `${(value * 100).toFixed(1)}%`;

        return (
            <div className="min-h-screen p-6 md:p-8 bg-gradient-to-br from-gray-50 via-white to-gray-100">
                <PageHeader
                    title="數據分析儀表板"
                    description="全面掌握倉儲營運數據"
                    actions={
                        <div className="flex gap-2 items-center">
                            <select
                                value={dateRange}
                                onChange={(e) => setDateRange(e.target.value)}
                                className="px-3 py-2 rounded-xl border-2 border-gray-200 bg-white text-sm font-medium focus:border-apple-blue focus:outline-none"
                            >
                                <option value="7days">最近 7 天</option>
                                <option value="30days">最近 30 天</option>
                                <option value="90days">最近 90 天</option>
                            </select>
                            <Link to="/admin">
                                <Button variant="secondary" size="sm" className="gap-1">
                                    <ArrowLeft className="h-4 w-4" /> 返回
                                </Button>
                            </Link>
                        </div>
                    }
                />

                {loading ? (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Card key={i} className="p-4">
                                <Skeleton className="h-6 w-24 mb-4" />
                                <Skeleton className="h-10 w-20" />
                                <Skeleton className="h-3 w-32 mt-3" />
                            </Card>
                        ))}
                        <div className="col-span-full mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {Array.from({ length: 2 }).map((_, i) => (
                                <Card key={i} className="p-6 space-y-3">
                                    {Array.from({ length: 7 }).map((__, j) => (
                                        <Skeleton key={j} className="h-12 w-full" />
                                    ))}
                                </Card>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-gray-600">總訂單數</span>
                                        <div className="w-10 h-10 rounded-xl bg-apple-blue/10 flex items-center justify-center">
                                            <Package className="text-apple-blue" size={20} />
                                        </div>
                                    </div>
                                    <p className="text-3xl font-bold text-gray-900">{analytics.overview.totalOrders}</p>
                                    <p className="text-xs text-gray-500 mt-2 font-medium">
                                        完成率: {formatPercentage(analytics.overview.completedOrders / analytics.overview.totalOrders || 0)}
                                    </p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-gray-600">平均揀貨時間</span>
                                        <Clock className="text-cyan-500" size={20} />
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">{formatTime(analytics.overview.avgPickingTime)}</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-gray-600">平均裝箱時間</span>
                                        <Clock className="text-green-500" size={20} />
                                    </div>
                                    <p className="text-2xl font-bold text-gray-900">{formatTime(analytics.overview.avgPackingTime)}</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-gray-600">準確率</span>
                                        <Target className="text-purple-500" size={20} />
                                    </div>
                                    <p className="text-3xl font-bold text-gray-900">{formatPercentage(1 - analytics.overview.errorRate)}</p>
                                    <p className="text-xs text-red-500 mt-1">錯誤率: {formatPercentage(analytics.overview.errorRate)}</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-gray-600">活躍人數</span>
                                        <Users className="text-indigo-500" size={20} />
                                    </div>
                                    <p className="text-3xl font-bold text-gray-900">{analytics.userPerformance.length}</p>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Card>
                                <CardHeader className="flex items-center gap-2">
                                    <Award className="text-yellow-500" size={20} />
                                    <CardTitle className="text-lg">員工績效排行</CardTitle>
                                    <CardDescription>前 10 名完成訂單數</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {analytics.userPerformance.slice(0, 10).map((user, index) => (
                                        <div
                                            key={user.user_id}
                                            className="flex items-center gap-4 p-3 rounded-lg bg-gradient-to-r from-gray-50 to-blue-50"
                                        >
                                            <div
                                                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                                                    index === 0
                                                        ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-white'
                                                        : index === 1
                                                        ? 'bg-gradient-to-br from-gray-300 to-gray-500 text-white'
                                                        : index === 2
                                                        ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-white'
                                                        : 'bg-gray-200 text-gray-700'
                                                }`}
                                            >
                                                {index + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-900 truncate">{user.user_name}</p>
                                                <p className="text-xs text-gray-500">{user.role === 'picker' ? '揀貨員' : '裝箱員'}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-base text-blue-600">{user.completed_orders}</p>
                                                <p className="text-[10px] text-gray-500">完成訂單</p>
                                            </div>
                                        </div>
                                    ))}
                                    {analytics.userPerformance.length === 0 && (
                                        <EmptyState title="暫無數據" description="尚未有績效紀錄" />
                                    )}
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex items-center gap-2">
                                    <TrendingUp className="text-green-500" size={20} />
                                    <CardTitle className="text-lg">熱門商品 TOP 10</CardTitle>
                                    <CardDescription>出貨數量最高的商品</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {analytics.topProducts.slice(0, 10).map((product, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center gap-4 p-3 rounded-lg bg-gradient-to-r from-gray-50 to-green-50"
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                                                {index + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-900 truncate">{product.product_name}</p>
                                                <p className="text-[10px] text-gray-500 font-mono truncate">{product.barcode}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-base text-green-600">{product.total_quantity}</p>
                                                <p className="text-[10px] text-gray-500">出貨數</p>
                                            </div>
                                        </div>
                                    ))}
                                    {analytics.topProducts.length === 0 && (
                                        <EmptyState title="暫無數據" description="尚未有商品紀錄" />
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </>
                )}
            </div>
        );
}
