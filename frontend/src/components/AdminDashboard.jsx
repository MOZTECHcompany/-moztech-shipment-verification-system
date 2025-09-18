// frontend/src/components/AdminDashboard.jsx

import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { LayoutDashboard, FileDown, Users, History, LayoutGrid, UploadCloud, FileSpreadsheet, ArrowLeft } from 'lucide-react';

export function AdminDashboard() {
    // State 和 Refs
    const [dateRange, setDateRange] = useState([new Date(), new Date()]);
    const [startDate, endDate] = dateRange;
    const fileInputRef = useRef(null);

    // 匯入 Excel 邏輯 (保持不變，但現在是整合進來的功能之一)
    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('orderFile', file);
        const promise = apiClient.post('/api/orders/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.promise(promise, {
            loading: '正在上傳並處理訂單...',
            success: (response) => `订单「${response.data.voucherNumber}」已成功匯入！新任務已建立。`,
            error: (err) => `上傳失敗: ${err.response?.data?.message || err.message}`,
        });
        if (fileInputRef.current) { fileInputRef.current.value = null; }
    };

    // 匯出報告邏輯 (保持不變)
    const handleExportAdminReport = async () => {
        if (!startDate || !endDate) { toast.error("請選擇完整的日期範圍"); return; }
        const formattedStartDate = format(startDate, 'yyyy-MM-dd');
        const formattedEndDate = format(endDate, 'yyyy-MM-dd');
        const promise = apiClient.get(`/api/reports/export`, { params: { startDate: formattedStartDate, endDate: formattedEndDate }, responseType: 'blob' });
        toast.promise(promise, {
            loading: `正在產生 ${formattedStartDate} 至 ${formattedEndDate} 的報告...`,
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
                return `報告 ${fileName} 已成功下載！`;
            },
            error: (err) => '產生報告失敗，請檢查日期範圍內是否有資料'
        });
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center">
                        <LayoutDashboard className="mr-3 text-blue-600" />
                        管理中心
                    </h1>
                    <p className="text-gray-500 mt-1">在這裡匯入訂單、匯出報告與管理系統</p>
                </div>
                {/* 【关键修改】清晰的返回按鈕 */}
                <Link to="/tasks" className="flex-shrink-0 flex items-center px-5 py-2.5 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors shadow-sm">
                    <ArrowLeft className="mr-2" />
                    返回作業面板
                </Link>
            </header>

            {/* 功能區塊化 */}
            <div className="space-y-8">
                {/* 1. 建立新任务 */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h3 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><UploadCloud className="mr-2 text-purple-600" />建立新任务：汇入出货单</h3>
                    <div className="flex items-center justify-center w-full p-6 border-2 border-gray-200 border-dashed rounded-lg cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => fileInputRef.current?.click()}>
                        <div className="text-center">
                            <FileSpreadsheet className="mx-auto h-12 w-12 text-gray-400" />
                            <p className="mt-2 text-sm text-gray-600"><span className="font-semibold text-purple-600">点击此处上传</span> 或拖曳档案到此区域</p>
                            <p className="text-xs text-gray-500">支援 .xlsx, .xls 格式</p>
                        </div>
                    </div>
                    <input type="file" ref={fileInputRef} onChange={handleExcelImport} accept=".xlsx, .xls" className="hidden" />
                </div>

                {/* 2. 匯出營運報告 */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h3 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileDown className="mr-2 text-green-600" />汇出营运报告</h3>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <div className="w-full sm:w-auto"><label className="block text-sm font-medium text-gray-600 mb-1">选择日期范围：</label><DatePicker selectsRange={true} startDate={startDate} endDate={endDate} onChange={(update) => setDateRange(update)} isClearable={true} dateFormat="yyyy/MM/dd" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
                        <button onClick={handleExportAdminReport} className="w-full sm:w-auto self-end px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors" disabled={!startDate || !endDate}>下载 CSV 报告</button>
                    </div>
                </div>

                {/* 3. 即將推出的功能 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-white p-6 rounded-xl shadow-md opacity-60"><h3 className="text-xl font-semibold text-gray-700 mb-2 flex items-center"><Users className="mr-2" />使用者管理</h3><p className="text-gray-500 mb-4">新增、编辑或删除系统操作员帐号。</p><button className="px-4 py-2 bg-gray-200 text-gray-500 font-semibold rounded-lg cursor-not-allowed">即将推出</button></div>
                    <div className="bg-white p-6 rounded-xl shadow-md opacity-60"><h3 className="text-xl font-semibold text-gray-700 mb-2 flex items-center"><History className="mr-2" />操作日志查询</h3><p className="text-gray-500 mb-4">查询特定订单或人员的所有操作记录。</p><button className="px-4 py-2 bg-gray-200 text-gray-500 font-semibold rounded-lg cursor-not-allowed">即将推出</button></div>
                </div>
            </div>
        </div>
    );
}