// frontend/src/components/admin/AdminDashboard-modern.jsx
// Apple 風格管理中心 - Bento Grid Layout

import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { LayoutDashboard, FileDown, Users, LayoutGrid, UploadCloud, FileSpreadsheet, FileText, Sparkles, TrendingUp, AlertTriangle, ArrowRight, Database, History } from 'lucide-react';
import { PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '../../ui';

export function AdminDashboard({ user }) {
    const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
    const [dateRange, setDateRange] = useState([null, null]);
    const [startDate, endDate] = dateRange;
    const fileInputRef = useRef(null);

    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('orderFile', file);
        const promise = apiClient.post('/api/orders/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.promise(promise, {
            loading: '正在上傳並處理訂單...',
            success: (response) => `✅ 訂單「${response.data.voucherNumber}」已成功匯入！`,
            error: (err) => `❌ 上傳失敗: ${err.response?.data?.message || err.message}`,
        });
        if (fileInputRef.current) { fileInputRef.current.value = null; }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) {
            handleExcelImport({ target: { files: [file] } });
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleExportAdminReport = async () => {
        if (!startDate || !endDate) { 
            toast.error("請選擇完整的日期範圍"); 
            return; 
        }
        const formattedStartDate = format(startDate, 'yyyy-MM-dd');
        const formattedEndDate = format(endDate, 'yyyy-MM-dd');
        const promise = apiClient.get(`/api/reports/export`, { 
            params: { startDate: formattedStartDate, endDate: formattedEndDate }, 
            responseType: 'blob' 
        });
        toast.promise(promise, {
            loading: `📊 正在產生 ${formattedStartDate} 至 ${formattedEndDate} 的報告...`,
            success: (response) => {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                const fileName = `營運報告_${formattedStartDate}_至_${formattedEndDate}.csv`;
                link.setAttribute('download', fileName);
                document.body.appendChild(link);
                link.click();
                link.parentNode.removeChild(link);
                window.URL.revokeObjectURL(url);
                return `✅ 報告 ${fileName} 已成功下載！`;
            },
            error: (err) => '❌ 產生報告失敗，請檢查日期範圍內是否有資料。'
        });
    };

    return (
        <div className="min-h-screen bg-transparent pb-20">
            <div className="p-6 md:p-8 lg:p-10 max-w-[1600px] mx-auto">
                <PageHeader
                    title="管理中心"
                    description="系統營運概況與管理工具"
                    actions={
                        <Link to="/tasks">
                            <Button variant="primary" size="md" className="gap-2 shadow-lg shadow-primary/20 rounded-full px-6">
                                <LayoutGrid size={18} />
                                前往作業看板
                            </Button>
                        </Link>
                    }
                />

                {/* Bento Grid Layout */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 auto-rows-[minmax(180px,auto)]">
                    
                    {/* 1. 數據分析 (大卡片) */}
                    {isAdmin && (
                    <Card className="md:col-span-2 lg:col-span-2 row-span-2 animate-scale-in relative overflow-hidden group border-0 glass-panel">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-400/20 rounded-full blur-[80px] -mr-16 -mt-16 transition-all group-hover:bg-blue-400/30"></div>
                        <CardHeader className="relative z-10">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 mb-4">
                                <TrendingUp size={24} />
                            </div>
                            <CardTitle className="text-3xl font-bold text-gray-900">數據分析</CardTitle>
                            <CardDescription className="text-base mt-2">
                                深入掌握營運狀態，查看訂單趨勢、員工績效與營運數據分析。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="relative z-10 mt-4">
                            <div className="grid grid-cols-2 gap-4 mb-8">
                                <div className="p-6 rounded-3xl bg-white/40 backdrop-blur-md border border-white/50 shadow-sm hover:scale-[1.02] transition-transform duration-300">
                                    <p className="text-sm text-gray-500 font-medium uppercase tracking-wider">今日訂單</p>
                                    <p className="text-4xl font-extrabold mt-2 bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">--</p>
                                </div>
                                <div className="p-6 rounded-3xl bg-white/40 backdrop-blur-md border border-white/50 shadow-sm hover:scale-[1.02] transition-transform duration-300">
                                    <p className="text-sm text-gray-500 font-medium uppercase tracking-wider">完成率</p>
                                    <p className="text-4xl font-extrabold mt-2 bg-clip-text text-transparent bg-gradient-to-r from-green-600 to-emerald-600">--%</p>
                                </div>
                            </div>
                            <Link to="/admin/analytics">
                                <Button variant="primary" size="lg" className="w-full sm:w-auto gap-2 shadow-lg shadow-blue-500/20 rounded-full">
                                    查看完整報告 <ArrowRight size={18} />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                    )}

                    {/* 2. 建立新任務 (中卡片 - 重點功能) */}
                    <Card className="md:col-span-1 lg:col-span-2 animate-scale-in border-0 glass-panel bg-gradient-to-br from-purple-500/90 to-indigo-600/90 text-white overflow-hidden relative group" style={{ animationDelay: '50ms' }}>
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-soft-light"></div>
                        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>
                        
                        <CardContent className="relative z-10 h-full flex flex-col justify-between p-8">
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-4 shadow-inner border border-white/30">
                                        <UploadCloud size={24} className="text-white" />
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2">建立新任務</h3>
                                    <p className="text-purple-100">上傳 Excel 出貨單產生新的揀貨/裝箱作業</p>
                                </div>
                            </div>
                            
                            <div 
                                className="mt-6 border-2 border-dashed border-white/30 rounded-2xl p-6 text-center hover:bg-white/10 transition-all duration-300 cursor-pointer hover:scale-[1.01]"
                                onClick={() => fileInputRef.current?.click()}
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                            >
                                <FileSpreadsheet className="mx-auto h-10 w-10 text-white/80 mb-3" />
                                <p className="font-medium">點擊上傳或拖放檔案</p>
                                <p className="text-sm text-purple-200 mt-1">支援 .xlsx, .xls</p>
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleExcelImport}
                                accept=".xlsx, .xls"
                                className="hidden"
                            />
                        </CardContent>
                    </Card>

                    {/* 3. 新品不良統計 (小卡片 - 優先顯示) */}
                    {isAdmin && (
                    <Card className="md:col-span-1 animate-scale-in border-0 glass-panel hover:shadow-2xl transition-all duration-300 group hover:-translate-y-1" style={{ animationDelay: '100ms' }}>
                        <CardHeader>
                            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                                <AlertTriangle size={24} />
                            </div>
                            <CardTitle className="text-xl font-bold">新品不良</CardTitle>
                            <CardDescription>SN 更換記錄</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Link to="/admin/defects">
                                <Button variant="ghost" className="w-full justify-between group-hover:bg-red-50 text-red-700 rounded-xl">
                                    查看統計 <ArrowRight size={16} />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                    )}

                    {/* 4. 刷錯分析 (小卡片) */}
                    {isAdmin && (
                    <Card className="md:col-span-1 animate-scale-in border-0 glass-panel hover:shadow-2xl transition-all duration-300 group hover:-translate-y-1" style={{ animationDelay: '150ms' }}>
                        <CardHeader>
                            <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                                <AlertTriangle size={24} />
                            </div>
                            <CardTitle className="text-xl font-bold">刷錯分析</CardTitle>
                            <CardDescription>統計掃描錯誤</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Link to="/admin/scan-errors">
                                <Button variant="ghost" className="w-full justify-between group-hover:bg-orange-50 text-orange-700 rounded-xl">
                                    查看詳情 <ArrowRight size={16} />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                    )}

                    {/* 5. 使用者管理 (小卡片) */}
                    {isAdmin && (
                    <Card className="md:col-span-1 animate-scale-in border-0 glass-panel hover:shadow-2xl transition-all duration-300 group hover:-translate-y-1" style={{ animationDelay: '175ms' }}>
                        <CardHeader>
                            <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                                <Users size={24} />
                            </div>
                            <CardTitle className="text-xl font-bold">使用者管理</CardTitle>
                            <CardDescription>管理團隊成員</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Link to="/admin/users">
                                <Button variant="ghost" className="w-full justify-between group-hover:bg-indigo-50 text-indigo-700 rounded-xl">
                                    前往設定 <ArrowRight size={16} />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                    )}

                    {/* 5. 匯出營運報告 (中卡片) */}
                    {isAdmin && (
                    <Card className="md:col-span-2 lg:col-span-2 animate-scale-in border-0 glass-panel" style={{ animationDelay: '200ms' }}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-green-100 text-green-600 flex items-center justify-center shadow-sm">
                                    <FileDown size={24} />
                                </div>
                                <div>
                                    <CardTitle className="text-xl font-bold">匯出營運報告</CardTitle>
                                    <CardDescription>下載 CSV 格式報表</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col sm:flex-row gap-4 items-end">
                                <div className="w-full">
                                    <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">日期範圍</label>
                                    <DatePicker
                                        selectsRange
                                        startDate={startDate}
                                        endDate={endDate}
                                        onChange={(update) => setDateRange(update)}
                                        isClearable
                                        dateFormat="yyyy/MM/dd"
                                        className="w-full px-4 py-3 rounded-xl bg-white/50 border border-gray-200 focus:border-green-500 focus:ring-2 focus:ring-green-200 outline-none transition-all text-sm backdrop-blur-sm"
                                        placeholderText="選擇起訖日期"
                                    />
                                </div>
                                <Button
                                    onClick={handleExportAdminReport}
                                    disabled={!startDate || !endDate}
                                    variant="success"
                                    className="w-full sm:w-auto whitespace-nowrap rounded-xl shadow-lg shadow-green-500/20"
                                >
                                    下載報告
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                    )}

                    {/* 6. 操作日誌 (小卡片) */}
                    {isAdmin && (
                    <>
                    <Card className="md:col-span-1 animate-scale-in border-0 glass-panel hover:shadow-2xl transition-all duration-300 group hover:-translate-y-1" style={{ animationDelay: '250ms' }}>
                        <CardHeader>
                            <div className="w-12 h-12 rounded-2xl bg-gray-100 text-gray-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                                <History size={24} />
                            </div>
                            <CardTitle className="text-xl font-bold">操作日誌</CardTitle>
                            <CardDescription>系統操作紀錄</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Link to="/admin/operation-logs">
                                <Button variant="ghost" className="w-full justify-between group-hover:bg-gray-100 rounded-xl">
                                    查詢紀錄 <ArrowRight size={16} />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>

                    {/* 7. 資料保留清理 (小卡片) */}
                    <Card className="md:col-span-1 animate-scale-in border-0 glass-panel hover:shadow-2xl transition-all duration-300 group hover:-translate-y-1" style={{ animationDelay: '300ms' }}>
                        <CardHeader>
                            <div className="w-12 h-12 rounded-2xl bg-pink-100 text-pink-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                                <Database size={24} />
                            </div>
                            <CardTitle className="text-xl font-bold">資料清理</CardTitle>
                            <CardDescription>清理過期資料</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button
                                variant="ghost"
                                className="w-full justify-between group-hover:bg-pink-50 text-pink-700 rounded-xl"
                                onClick={() => {
                                    const promise = apiClient.post('/api/admin/maintenance/retention/run', {});
                                    toast.promise(promise, {
                                        loading: '🧹 清理中...',
                                        success: '✅ 清理完成',
                                        error: '❌ 清理失敗',
                                    });
                                }}
                            >
                                立即執行 <Sparkles size={16} />
                            </Button>
                        </CardContent>
                    </Card>

                    </>
                    )}

                </div>

                <div className="mt-16 text-center">
                    <p className="text-sm text-gray-400 font-medium">© 2025 MOZTECH 倉儲管理系統</p>
                </div>
            </div>
        </div>
    );
}

