// frontend/src/components/admin/AdminDashboard-modern.jsx
// Apple 風格管理中心

import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { LayoutDashboard, FileDown, Users, LayoutGrid, UploadCloud, FileSpreadsheet, FileText, Sparkles, TrendingUp, AlertTriangle } from 'lucide-react';
import { PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '../../ui';

export function AdminDashboard() {
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
            <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
                <PageHeader
                    title="管理中心"
                    description="在這裡匯入訂單與管理系統"
                    actions={
                        <Link to="/tasks">
                            <Button variant="primary" size="md" className="gap-2">
                                <LayoutGrid size={18} />
                                前往作業面板
                            </Button>
                        </Link>
                    }
                />

                <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card className="animate-scale-in">
                        <CardHeader className="flex flex-row items-start gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-blue to-apple-indigo flex items-center justify-center shadow-apple-sm">
                                <LayoutDashboard className="text-white" size={26} />
                            </div>
                            <div>
                                <CardTitle className="text-2xl">數據分析</CardTitle>
                                <CardDescription>查看訂單趨勢、員工績效與營運數據分析</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2">
                            <p className="text-gray-600 mb-6 leading-relaxed">
                                深入掌握營運狀態，提升決策效率。
                            </p>
                            <Link to="/admin/analytics">
                                <Button variant="primary" size="sm" className="gap-2">
                                    <TrendingUp size={18} />
                                    前往分析
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>

                    <Card className="animate-scale-in" style={{ animationDelay: '50ms' }}>
                        <CardHeader className="flex flex-row items-start gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-orange/10 to-apple-orange/5 flex items-center justify-center">
                                <AlertTriangle className="text-apple-orange" size={24} />
                            </div>
                            <div>
                                <CardTitle className="text-2xl">刷錯分析</CardTitle>
                                <CardDescription>統計最常發生的掃描錯誤以改善流程</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2">
                            <p className="text-gray-600 mb-6 leading-relaxed">
                                掌握錯誤來源，快速迭代流程品質。
                            </p>
                            <Link to="/admin/scan-errors">
                                <Button variant="warning" size="sm" className="gap-2">
                                    <AlertTriangle size={18} />
                                    查看錯誤
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>

                    <Card className="animate-scale-in" style={{ animationDelay: '100ms' }}>
                        <CardHeader className="flex flex-row items-start gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-purple/10 to-apple-purple/5 flex items-center justify-center">
                                <UploadCloud className="text-apple-purple" size={24} />
                            </div>
                            <div>
                                <CardTitle className="text-2xl">建立新任務</CardTitle>
                                <CardDescription>上傳出貨單產生新的揀貨/裝箱作業</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2">
                            <div
                                className="glass p-8 rounded-2xl border-2 border-dashed border-gray-300 hover:border-apple-purple/50 hover:bg-apple-purple/5 cursor-pointer transition-all group"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <div className="text-center">
                                    <FileSpreadsheet className="mx-auto h-16 w-16 text-gray-400 group-hover:text-apple-purple transition-colors mb-4" />
                                    <p className="text-lg font-semibold text-gray-900 mb-2">
                                        <span className="text-apple-purple">點擊此處</span> 上傳出貨單
                                    </p>
                                    <p className="text-sm text-gray-500">支援 .xlsx, .xls 格式</p>
                                    <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-apple-purple/10 rounded-lg">
                                        <Sparkles size={16} className="text-apple-purple" />
                                        <span className="text-sm text-apple-purple font-medium">拖放檔案或點擊選擇</span>
                                    </div>
                                </div>
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

                    <Card className="animate-scale-in" style={{ animationDelay: '150ms' }}>
                        <CardHeader className="flex flex-row items-start gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-green/10 to-apple-green/5 flex items-center justify-center">
                                <FileDown className="text-apple-green" size={24} />
                            </div>
                            <div>
                                <CardTitle className="text-2xl">匯出營運報告</CardTitle>
                                <CardDescription>選擇日期範圍並下載 CSV 報告</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2 space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-3">選擇日期範圍</label>
                                <DatePicker
                                    selectsRange
                                    startDate={startDate}
                                    endDate={endDate}
                                    onChange={(update) => setDateRange(update)}
                                    isClearable
                                    dateFormat="yyyy/MM/dd"
                                    className="w-full px-4 py-4 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-green focus:ring-4 focus:ring-apple-green/10 outline-none transition-all text-gray-900"
                                    placeholderText="點擊選擇日期範圍"
                                />
                            </div>
                            <Button
                                onClick={handleExportAdminReport}
                                disabled={!startDate || !endDate}
                                variant="success"
                                className="w-full justify-center gap-2"
                            >
                                <TrendingUp size={18} />
                                下載 CSV 報告
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="animate-scale-in" style={{ animationDelay: '200ms' }}>
                        <CardHeader className="flex flex-row items-start gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-blue/10 to-apple-blue/5 flex items-center justify-center">
                                <Users className="text-blue-600" size={24} />
                            </div>
                            <div>
                                <CardTitle className="text-2xl">使用者管理</CardTitle>
                                <CardDescription>新增、編輯或刪除操作員帳號</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2">
                            <p className="text-gray-600 mb-6 leading-relaxed">統一管理團隊成員權限。</p>
                            <Link to="/admin/users">
                                <Button variant="secondary" size="sm" className="gap-2">
                                    前往管理 →
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>

                    <Card className="animate-scale-in" style={{ animationDelay: '250ms' }}>
                        <CardHeader className="flex flex-row items-start gap-3">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-indigo/10 to-apple-indigo/5 flex items-center justify-center">
                                <FileText className="text-apple-pink" size={24} />
                            </div>
                            <div>
                                <CardTitle className="text-2xl">操作日誌查詢</CardTitle>
                                <CardDescription>追蹤系統中所有操作記錄，確保透明</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2">
                            <p className="text-gray-600 mb-6 leading-relaxed">查詢特定訂單或人員的操作紀錄。</p>
                            <Link to="/admin/operation-logs">
                                <Button variant="danger" size="sm" className="gap-2">
                                    查看日誌 →
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                </div>

                <div className="mt-12 text-center">
                    <p className="text-sm text-gray-500">© 2025 MOZTECH 倉儲管理系統 - 企業級管理平台</p>
                </div>
            </div>
        </div>
    );
}
