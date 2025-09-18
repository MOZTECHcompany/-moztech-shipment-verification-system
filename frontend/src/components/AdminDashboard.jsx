import React, { useState, useRef } from 'react'; // 【新】引入 useRef
import { Link, useNavigate } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { LayoutDashboard, FileDown, Users, History, LayoutGrid, UploadCloud, FileSpreadsheet } from 'lucide-react';

export function AdminDashboard() {
    const navigate = useNavigate();
    const [dateRange, setDateRange] = useState([new Date(), new Date()]);
    const [startDate, endDate] = dateRange;
    const fileInputRef = useRef(null); // 【新】创建一个 ref 来控制档案输入框

    // 【新】处理 Excel 汇入的函数
    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('orderFile', file);

        const promise = apiClient.post('/api/orders/import', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        toast.promise(promise, {
            loading: '正在上传并处理订单...',
            success: (response) => {
                // 汇入成功后，可以选择直接跳转到任务列表
                navigate('/tasks');
                return `订单「${response.data.voucherNumber}」已成功汇入！`;
            },
            error: (err) => `上传失败: ${err.response?.data?.message || err.message}`,
        });

        // 清除选择的档案，以便再次上传同名档案
        if (fileInputRef.current) {
            fileInputRef.current.value = null;
        }
    };

    const handleExportAdminReport = async () => { /* ... 逻辑不变 ... */ };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                {/* ... Header 逻辑不变 ... */}
            </header>

            {/* 【新增】汇入订单功能区 */}
            <div className="mb-8 bg-white p-6 rounded-xl shadow-md border-l-4 border-purple-500">
                <h3 className="text-xl font-semibold text-gray-700 mb-4 flex items-center">
                    <UploadCloud className="mr-2 text-purple-600" />
                    建立新任务：汇入出货单
                </h3>
                <div 
                    className="flex items-center justify-center w-full p-6 border-2 border-purple-200 border-dashed rounded-lg cursor-pointer hover:bg-purple-50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="text-center">
                        <FileSpreadsheet className="mx-auto h-12 w-12 text-purple-400" />
                        <p className="mt-2 text-sm text-gray-600">
                            <span className="font-semibold">点击此处上传</span> 或拖曳档案到此区域
                        </p>
                        <p className="text-xs text-gray-500">支援 .xlsx, .xls 格式</p>
                    </div>
                </div>
                {/* 隐藏的档案输入框 */}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleExcelImport}
                    accept=".xlsx, .xls"
                    className="hidden"
                />
            </div>

            {/* 汇出报告功能区 */}
            <div className="bg-white p-6 rounded-xl shadow-md">
                 {/* ... 汇出报告的 JSX 保持不变 ... */}
            </div>

            {/* 未来功能佔位区 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                {/* ... 未来功能的 JSX 保持不变 ... */}
            </div>
        </div>
    );
}

// 为了方便您复制，我把完整的 JSX 内容补全
// 请使用下面的 FullAdminDashboard 函式内容，并将其名称改回 export function AdminDashboard()
export function FullAdminDashboard() {
    const navigate = useNavigate();
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
            loading: '正在上传并处理订单...',
            success: (response) => { navigate('/tasks'); return `订单「${response.data.voucherNumber}」已成功汇入！`; },
            error: (err) => `上传失败: ${err.response?.data?.message || err.message}`,
        });
        if (fileInputRef.current) { fileInputRef.current.value = null; }
    };

    const handleExportAdminReport = async () => {/* ... */};

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center"><LayoutDashboard className="mr-3 text-blue-600" />管理员仪表板</h1>
                    <p className="text-gray-500 mt-1">在这里管理系统数据与使用者</p>
                </div>
                <Link to="/tasks" className="flex-shrink-0 flex items-center px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
                    <LayoutGrid className="mr-2" />前往作业面板
                </Link>
            </header>
            
            <div className="mb-8 bg-white p-6 rounded-xl shadow-md border-l-4 border-purple-500">
                <h3 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><UploadCloud className="mr-2 text-purple-600" />建立新任务：汇入出货单</h3>
                <div className="flex items-center justify-center w-full p-6 border-2 border-purple-200 border-dashed rounded-lg cursor-pointer hover:bg-purple-50 transition-colors" onClick={() => fileInputRef.current?.click()}>
                    <div className="text-center">
                        <FileSpreadsheet className="mx-auto h-12 w-12 text-purple-400" />
                        <p className="mt-2 text-sm text-gray-600"><span className="font-semibold">点击此处上传</span> 或拖曳档案到此区域</p>
                        <p className="text-xs text-gray-500">支援 .xlsx, .xls 格式</p>
                    </div>
                </div>
                <input type="file" ref={fileInputRef} onChange={handleExcelImport} accept=".xlsx, .xls" className="hidden" />
            </div>

            <div className="bg-white p-6 rounded-xl shadow-md">
                <h3 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileDown className="mr-2" />汇出营运报告</h3>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-full sm:w-auto"><label className="block text-sm font-medium text-gray-600 mb-1">选择日期范围：</label><DatePicker selectsRange={true} startDate={startDate} endDate={endDate} onChange={(update) => setDateRange(update)} isClearable={true} dateFormat="yyyy/MM/dd" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
                    <button onClick={handleExportAdminReport} className="w-full sm:w-auto self-end px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors" disabled={!startDate || !endDate}>下载 CSV 报告</button>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                <div className="bg-white p-6 rounded-xl shadow-md opacity-60"><h3 className="text-xl font-semibold text-gray-700 mb-2 flex items-center"><Users className="mr-2" />使用者管理</h3><p className="text-gray-500 mb-4">新增、编辑或删除系统操作员帐号。</p><button className="px-4 py-2 bg-gray-200 text-gray-500 font-semibold rounded-lg cursor-not-allowed">即將推出</button></div>
                <div className="bg-white p-6 rounded-xl shadow-md opacity-60"><h3 className="text-xl font-semibold text-gray-700 mb-2 flex items-center"><History className="mr-2" />操作日誌查詢</h3><p className="text-gray-500 mb-4">查詢特定訂單或人員的所有操作記錄。</p><button className="px-4 py-2 bg-gray-200 text-gray-500 font-semibold rounded-lg cursor-not-allowed">即將推出</button></div>
            </div>
        </div>
    );
}