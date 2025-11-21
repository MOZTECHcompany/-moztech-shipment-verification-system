// frontend/src/components/admin/Analytics.jsx
// 數據分析儀表板 - Apple 風格現代化版本

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import {
    ArrowLeft, TrendingUp, Users, Package, Clock,
    Award, Target, BarChart3, Activity, Calendar, AlertTriangle
} from 'lucide-react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
    Filler
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
    PageHeader,
    Card, CardHeader, CardTitle, CardDescription, CardContent,
    Button,
    Skeleton,
    EmptyState,
    Badge,
} from '../../ui';

// 註冊 Chart.js 元件
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
    Filler
);

// Chart.js 全域設定
ChartJS.defaults.font.family = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
ChartJS.defaults.color = '#64748b';

export function Analytics() {
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState('7days'); // 7days, 30days, 90days
    const [analytics, setAnalytics] = useState({
        overview: {
            totalOrders: 0,
            completedOrders: 0,
            voidedOrders: 0,
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
        if (!minutes) return '0 分鐘';
        if (minutes < 60) return `${Math.round(minutes)} 分鐘`;
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours} 小時 ${mins} 分鐘`;
    };

    const formatPercentage = (value) => `${(value * 100).toFixed(1)}%`;

    // --- 圖表資料準備 ---

    // 1. 訂單趨勢 (Line Chart)
    const trendData = {
        labels: analytics.orderTrends.slice().reverse().map(d => new Date(d.date).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })),
        datasets: [
            {
                label: '總訂單',
                data: analytics.orderTrends.slice().reverse().map(d => d.total),
                borderColor: '#3b82f6', // blue-500
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
            },
            {
                label: '已完成',
                data: analytics.orderTrends.slice().reverse().map(d => d.completed),
                borderColor: '#10b981', // emerald-500
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
            }
        ]
    };

    const trendOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } },
            tooltip: { 
                mode: 'index', 
                intersect: false,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                titleColor: '#1e293b',
                bodyColor: '#475569',
                borderColor: '#e2e8f0',
                borderWidth: 1,
                padding: 10,
                displayColors: true,
            }
        },
        scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' }, border: { display: false } },
            x: { grid: { display: false }, border: { display: false } }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false }
    };

    // 2. 員工績效 (Bar Chart)
    const performanceData = {
        labels: analytics.userPerformance.map(u => u.user_name),
        datasets: [
            {
                label: '完成訂單數',
                data: analytics.userPerformance.map(u => u.completed_orders),
                backgroundColor: analytics.userPerformance.map((_, i) => i < 3 ? '#3b82f6' : '#94a3b8'), // 前三名藍色，其他灰色
                borderRadius: 6,
                barThickness: 24,
            }
        ]
    };

    const performanceOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                titleColor: '#1e293b',
                bodyColor: '#475569',
                borderColor: '#e2e8f0',
                borderWidth: 1,
            }
        },
        scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' }, border: { display: false } },
            x: { grid: { display: false }, border: { display: false } }
        }
    };

    // 3. 訂單狀態分佈 (Doughnut Chart)
    const statusData = {
        labels: ['已完成', '作廢', '進行中'],
        datasets: [
            {
                data: [
                    analytics.overview.completedOrders,
                    analytics.overview.voidedOrders,
                    analytics.overview.totalOrders - analytics.overview.completedOrders - analytics.overview.voidedOrders
                ],
                backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
                borderWidth: 0,
                hoverOffset: 4
            }
        ]
    };

    const statusOptions = {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } }
        }
    };

    return (
        <div className="min-h-screen p-6 md:p-8 bg-gradient-to-br from-gray-50 via-white to-gray-100 pb-20">
            <div className="max-w-[1600px] mx-auto">
                <PageHeader
                    title="數據分析儀表板"
                    description="全面掌握倉儲營運數據與績效指標"
                    actions={
                        <div className="flex gap-3 items-center">
                            <div className="bg-white rounded-xl p-1 border border-gray-200 shadow-sm flex">
                                {['7days', '30days', '90days'].map((range) => (
                                    <button
                                        key={range}
                                        onClick={() => setDateRange(range)}
                                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                            dateRange === range 
                                                ? 'bg-gray-900 text-white shadow-md' 
                                                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                                        }`}
                                    >
                                        {range === '7days' ? '7天' : range === '30days' ? '30天' : '90天'}
                                    </button>
                                ))}
                            </div>
                            <Link to="/admin">
                                <Button variant="secondary" size="sm" className="gap-1 h-[42px]">
                                    <ArrowLeft className="h-4 w-4" /> 返回
                                </Button>
                            </Link>
                        </div>
                    }
                />

                {loading ? (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-32 rounded-2xl" />
                        ))}
                        <Skeleton className="col-span-full h-96 rounded-2xl mt-4" />
                    </div>
                ) : (
                    <div className="mt-8 space-y-8 animate-fade-in">
                        {/* 1. 關鍵指標卡片 (KPI Cards) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <Card className="border-0 shadow-apple-sm hover:shadow-apple-md transition-all bg-gradient-to-br from-blue-50 to-white">
                                <CardContent className="p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                                            <Package size={24} />
                                        </div>
                                        <Badge variant={analytics.overview.totalOrders > 0 ? 'success' : 'secondary'}>
                                            總量
                                        </Badge>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-3xl font-black text-gray-900">{analytics.overview.totalOrders}</h3>
                                        <p className="text-sm text-gray-500 font-medium">期間總訂單數</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-0 shadow-apple-sm hover:shadow-apple-md transition-all bg-gradient-to-br from-emerald-50 to-white">
                                <CardContent className="p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                                            <Target size={24} />
                                        </div>
                                        <Badge variant="success">
                                            {formatPercentage(analytics.overview.completedOrders / (analytics.overview.totalOrders || 1))} 完成率
                                        </Badge>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-3xl font-black text-gray-900">{analytics.overview.completedOrders}</h3>
                                        <p className="text-sm text-gray-500 font-medium">已完成訂單</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-0 shadow-apple-sm hover:shadow-apple-md transition-all bg-gradient-to-br from-purple-50 to-white">
                                <CardContent className="p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-3 bg-purple-100 text-purple-600 rounded-xl">
                                            <Clock size={24} />
                                        </div>
                                        <span className="text-xs font-bold text-purple-600 bg-purple-100 px-2 py-1 rounded-lg">平均耗時</span>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-3xl font-black text-gray-900">{formatTime(analytics.overview.avgPickingTime)}</h3>
                                        <p className="text-sm text-gray-500 font-medium">平均揀貨時間</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-0 shadow-apple-sm hover:shadow-apple-md transition-all bg-gradient-to-br from-orange-50 to-white">
                                <CardContent className="p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                                            <AlertTriangle size={24} />
                                        </div>
                                        <Badge variant={analytics.overview.errorRate > 0.05 ? 'destructive' : 'secondary'}>
                                            {formatPercentage(analytics.overview.errorRate)} 異常率
                                        </Badge>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-3xl font-black text-gray-900">{analytics.overview.voidedOrders}</h3>
                                        <p className="text-sm text-gray-500 font-medium">作廢/異常訂單</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 2. 主要圖表區 */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* 訂單趨勢圖 (佔 2/3) */}
                            <Card className="lg:col-span-2 border-0 shadow-apple-md">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <TrendingUp className="text-blue-500" size={20} />
                                        訂單趨勢分析
                                    </CardTitle>
                                    <CardDescription>每日訂單總量與完成量對比</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[350px] w-full">
                                        <Line data={trendData} options={trendOptions} />
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 狀態分佈 (佔 1/3) */}
                            <Card className="border-0 shadow-apple-md">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Activity className="text-orange-500" size={20} />
                                        訂單狀態分佈
                                    </CardTitle>
                                    <CardDescription>整體訂單處理狀態佔比</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[250px] w-full relative flex items-center justify-center">
                                        <Doughnut data={statusData} options={statusOptions} />
                                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                            <span className="text-3xl font-black text-gray-900">{analytics.overview.totalOrders}</span>
                                            <span className="text-xs text-gray-500 font-medium">總訂單</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 3. 績效與熱門商品 */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* 員工績效排行 */}
                            <Card className="border-0 shadow-apple-md">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Award className="text-yellow-500" size={20} />
                                        人員績效排行
                                    </CardTitle>
                                    <CardDescription>依完成訂單數量排序</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[300px] w-full">
                                        <Bar data={performanceData} options={performanceOptions} />
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 熱門商品列表 */}
                            <Card className="border-0 shadow-apple-md flex flex-col">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <BarChart3 className="text-purple-500" size={20} />
                                        熱門商品 Top 5
                                    </CardTitle>
                                    <CardDescription>出貨量最高的商品項目</CardDescription>
                                </CardHeader>
                                <CardContent className="flex-1 overflow-auto">
                                    <div className="space-y-4">
                                        {analytics.topProducts.slice(0, 5).map((product, index) => (
                                            <div key={index} className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                                                    index === 0 ? 'bg-yellow-100 text-yellow-700' :
                                                    index === 1 ? 'bg-gray-100 text-gray-700' :
                                                    index === 2 ? 'bg-orange-100 text-orange-700' :
                                                    'bg-blue-50 text-blue-600'
                                                }`}>
                                                    {index + 1}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-bold text-gray-900 truncate">{product.product_name}</p>
                                                    <p className="text-xs text-gray-500 font-mono">{product.product_code}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-gray-900">{product.total_quantity}</p>
                                                    <p className="text-xs text-gray-500">件</p>
                                                </div>
                                            </div>
                                        ))}
                                        {analytics.topProducts.length === 0 && (
                                            <EmptyState 
                                                icon={Package}
                                                title="無商品數據"
                                                description="目前沒有足夠的商品出貨記錄"
                                            />
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Analytics;

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
