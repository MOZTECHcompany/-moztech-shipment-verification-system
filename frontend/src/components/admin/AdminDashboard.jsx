// frontend/src/components/admin/AdminDashboard.jsx
import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { LayoutDashboard, FileDown, Users, History, LayoutGrid, UploadCloud, FileSpreadsheet } from 'lucide-react';

export function AdminDashboard() {
    const [dateRange, setDateRange] = useState([new Date(), new Date()]);
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
            success: (response) => `訂單「${response.data.voucherNumber}」已成功匯入！`,
            error: (err) => `上傳失敗: ${err.response?.data?.message || err.message}`,
        });
        if (fileInputRef.current) { fileInputRef.current.value = null; }
    };

    const handleExportAdminReport = async () => { /* ... 逻辑与之前相同 ... */ };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-background min-h-screen">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center"><LayoutDashboard className="mr-3 text-primary" />管理中心</h1>
                    <p className="text-secondary-foreground mt-1">在這裡匯入訂單、匯出報告與管理系統</p>
                </div>
                <Link to="/tasks" className="flex-shrink-0 flex items-center px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
                    <LayoutGrid className="mr-2" />前往作業面板
                </Link>
            </header>

            <div className="space-y-8">
                {/* 汇入和汇出区块 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-card p-6 rounded-xl shadow-sm border">
                        <h3 className="text-xl font-semibold text-card-foreground mb-2 flex items-center"><Users className="mr-2" />使用者管理</h3>
                        <p className="text-secondary-foreground mb-4">新增、編輯或刪除系統操作員帳號。</p>
                        {/* 【修正】确保 Link to 的路径正确 */}
                        <Link to="/admin/users" className="inline-block px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-colors">
                            前往管理
                        </Link>
                    </div>
                    <div className="bg-card p-6 rounded-xl shadow-sm border opacity-60">
                        <h3 className="text-xl font-semibold text-card-foreground mb-2 flex items-center"><History className="mr-2" />操作日誌查詢</h3>
                        <p className="text-secondary-foreground mb-4">查詢特定訂單或人員的所有操作記錄。</p>
                        <button className="px-4 py-2 bg-secondary text-secondary-foreground font-semibold rounded-md cursor-not-allowed">即將推出</button>
                    </div>
                </div>
            </div>
        </div>
    );
}