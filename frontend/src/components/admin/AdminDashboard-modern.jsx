// frontend/src/components/admin/AdminDashboard-modern.jsx
// Apple 風格管理中心

import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { LayoutDashboard, FileDown, Users, LayoutGrid, UploadCloud, FileSpreadsheet, FileText, Sparkles, TrendingUp } from 'lucide-react';

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
        <div className="min-h-screen bg-gradient-to-br from-blue-50/50 via-white to-purple-50/50">
            <div className="p-6 md:p-8 lg:p-12 max-w-7xl mx-auto">
                {/* 現代化標題列 */}
                <header className="mb-10 animate-fade-in">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                                    <LayoutDashboard className="text-white" size={24} />
                                </div>
                                <h1 className="text-5xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-700 bg-clip-text text-transparent">
                                    管理中心
                                </h1>
                            </div>
                            <p className="text-gray-500 text-lg ml-15">在這裡匯入訂單與管理系統</p>
                        </div>
                        
                        <Link 
                            to="/tasks" 
                            className="
                                flex items-center gap-2 px-6 py-3 rounded-xl font-medium
                                bg-gradient-to-r from-blue-600 to-indigo-600 text-white
                                hover:from-blue-700 hover:to-indigo-700
                                transition-all duration-200 shadow-lg shadow-blue-500/30
                                hover:shadow-xl hover:shadow-blue-500/40
                                active:scale-[0.98]
                            "
                        >
                            <LayoutGrid size={20} />
                            前往作業面板
                        </Link>
                    </div>
                </header>

                {/* 功能卡片網格 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 1. 建立新任務 */}
                    <div className="card-apple group animate-scale-in">
                        <div className="p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <UploadCloud className="text-purple-600" size={24} />
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900">建立新任務</h3>
                            </div>
                            
                            <div 
                                className="
                                    glass p-8 rounded-2xl border-2 border-dashed border-gray-300
                                    hover:border-purple-400 hover:bg-purple-50/50
                                    cursor-pointer transition-all duration-300
                                    group/upload
                                " 
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <div className="text-center">
                                    <FileSpreadsheet className="mx-auto h-16 w-16 text-gray-400 group-hover/upload:text-purple-500 transition-colors mb-4" />
                                    <p className="text-lg font-semibold text-gray-900 mb-2">
                                        <span className="text-purple-600">點擊此處</span> 上傳出貨單
                                    </p>
                                    <p className="text-sm text-gray-500">支援 .xlsx, .xls 格式</p>
                                    <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-purple-100 rounded-lg">
                                        <Sparkles size={16} className="text-purple-600" />
                                        <span className="text-sm text-purple-700 font-medium">拖放檔案或點擊選擇</span>
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
                        </div>
                    </div>

                    {/* 2. 匯出營運報告 */}
                    <div className="card-apple group animate-scale-in" style={{ animationDelay: '100ms' }}>
                        <div className="p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <FileDown className="text-green-600" size={24} />
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900">匯出營運報告</h3>
                            </div>
                            
                            <div className="space-y-5">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                                        選擇日期範圍
                                    </label>
                                    <div className="relative">
                                        <DatePicker 
                                            selectsRange={true} 
                                            startDate={startDate} 
                                            endDate={endDate} 
                                            onChange={(update) => setDateRange(update)} 
                                            isClearable={true} 
                                            dateFormat="yyyy/MM/dd" 
                                            className="
                                                w-full px-4 py-4 rounded-xl
                                                bg-white border-2 border-gray-200
                                                focus:border-green-500 focus:ring-4 focus:ring-green-500/10
                                                outline-none transition-all duration-200
                                                text-gray-900
                                            "
                                            placeholderText="點擊選擇日期範圍"
                                        />
                                    </div>
                                </div>
                                
                                <button 
                                    onClick={handleExportAdminReport} 
                                    disabled={!startDate || !endDate}
                                    className="
                                        w-full px-6 py-4 rounded-xl font-semibold text-lg
                                        bg-gradient-to-r from-green-500 to-emerald-600 text-white
                                        hover:from-green-600 hover:to-emerald-700
                                        disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed
                                        shadow-lg shadow-green-500/30
                                        hover:shadow-xl hover:shadow-green-500/40
                                        active:scale-[0.98]
                                        transition-all duration-200
                                        flex items-center justify-center gap-2
                                    "
                                >
                                    <TrendingUp size={20} />
                                    下載 CSV 報告
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 3. 使用者管理 */}
                    <div className="card-apple group bg-gradient-to-br from-blue-50 to-cyan-50 animate-scale-in" style={{ animationDelay: '200ms' }}>
                        <div className="p-8">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Users className="text-blue-600" size={24} />
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900">使用者管理</h3>
                            </div>
                            
                            <p className="text-gray-600 mb-6 text-base leading-relaxed">
                                新增、編輯或刪除系統操作員帳號，統一管理團隊成員權限。
                            </p>
                            
                            <Link 
                                to="/admin/users" 
                                className="
                                    inline-flex items-center gap-2 px-6 py-3 rounded-xl font-medium
                                    bg-gradient-to-r from-blue-500 to-cyan-600 text-white
                                    hover:from-blue-600 hover:to-cyan-700
                                    shadow-lg shadow-blue-500/30
                                    hover:shadow-xl hover:shadow-blue-500/40
                                    active:scale-[0.98]
                                    transition-all duration-200
                                "
                            >
                                前往管理
                                <span className="text-lg">→</span>
                            </Link>
                        </div>
                    </div>
                    
                    {/* 4. 操作日誌查詢 */}
                    <div className="card-apple group bg-gradient-to-br from-indigo-50 to-purple-50 animate-scale-in" style={{ animationDelay: '300ms' }}>
                        <div className="p-8">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <FileText className="text-indigo-600" size={24} />
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900">操作日誌查詢</h3>
                            </div>
                            
                            <p className="text-gray-600 mb-6 text-base leading-relaxed">
                                查詢特定訂單或人員的所有操作記錄，追蹤系統活動，確保作業透明。
                            </p>
                            
                            <Link 
                                to="/admin/operation-logs" 
                                className="
                                    inline-flex items-center gap-2 px-6 py-3 rounded-xl font-medium
                                    bg-gradient-to-r from-indigo-500 to-purple-600 text-white
                                    hover:from-indigo-600 hover:to-purple-700
                                    shadow-lg shadow-indigo-500/30
                                    hover:shadow-xl hover:shadow-indigo-500/40
                                    active:scale-[0.98]
                                    transition-all duration-200
                                "
                            >
                                查看日誌
                                <span className="text-lg">→</span>
                            </Link>
                        </div>
                    </div>
                </div>

                {/* 底部提示 */}
                <div className="mt-12 text-center animate-fade-in" style={{ animationDelay: '400ms' }}>
                    <p className="text-sm text-gray-500">
                        © 2025 MOZTECH 倉儲管理系統 - 企業級管理平台
                    </p>
                </div>
            </div>
        </div>
    );
}
