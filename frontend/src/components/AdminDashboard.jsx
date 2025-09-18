import React, { useState } from 'react';
import { Link } from 'react-router-dom'; // 【新】引入 Link 元件用於導航
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { LayoutDashboard, FileDown, Users, History, LayoutGrid } from 'lucide-react'; // 【新】引入新圖示

export function AdminDashboard() {
    // State 用於管理日期選擇器的日期範圍
    const [dateRange, setDateRange] = useState([new Date(), new Date()]);
    const [startDate, endDate] = dateRange;

    // 處理匯出報告的異步函數 (邏輯不變)
    const handleExportAdminReport = async () => {
        if (!startDate || !endDate) {
            toast.error("請選擇完整的日期範圍");
            return;
        }

        const formattedStartDate = format(startDate, 'yyyy-MM-dd');
        const formattedEndDate = format(endDate, 'yyyy-MM-dd');

        const promise = apiClient.get(`/api/reports/export`, {
            params: {
                startDate: formattedStartDate,
                endDate: formattedEndDate,
            },
            responseType: 'blob',
        });

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
            error: (err) => {
                if (err.response && err.response.data.type === 'application/json') {
                    const reader = new FileReader();
                    reader.onload = function() {
                        try {
                            const errorData = JSON.parse(this.result);
                            toast.error("產生報告失敗", { description: errorData.message || '後端回報錯誤' });
                        } catch (e) {
                             toast.error("產生報告失敗", { description: '無法解析後端錯誤訊息' });
                        }
                    }
                    reader.readAsText(err.response.data);
                    return '請稍後再試';
                }
                return '產生報告失敗，請檢查網路或聯繫技術支援';
            },
        });
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
            {/* 【關鍵修改】Header 區域 */}
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center">
                        <LayoutDashboard className="mr-3 text-blue-600" />
                        管理員儀表板
                    </h1>
                    <p className="text-gray-500 mt-1">在這裡管理系統數據與使用者</p>
                </div>
                {/* 【新增】切換到作業面板的按鈕 */}
                <Link 
                    to="/tasks" 
                    className="flex-shrink-0 flex items-center px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                    <LayoutGrid className="mr-2" />
                    前往作業面板
                </Link>
            </header>

            {/* 匯出報告功能區 (保持不變) */}
            <div className="bg-white p-6 rounded-xl shadow-md">
                <h3 className="text-xl font-semibold text-gray-700 mb-4 flex items-center">
                    <FileDown className="mr-2" />
                    匯出營運報告
                </h3>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-full sm:w-auto">
                        <label className="block text-sm font-medium text-gray-600 mb-1">選擇日期範圍：</label>
                        <DatePicker
                            selectsRange={true}
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(update) => setDateRange(update)}
                            isClearable={true}
                            dateFormat="yyyy/MM/dd"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button 
                        onClick={handleExportAdminReport} 
                        className="w-full sm:w-auto self-end px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                        disabled={!startDate || !endDate}
                    >
                        下載 CSV 報告
                    </button>
                </div>
            </div>

            {/* 未來功能佔位區 (保持不變) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                <div className="bg-white p-6 rounded-xl shadow-md opacity-60">
                     <h3 className="text-xl font-semibold text-gray-700 mb-2 flex items-center"><Users className="mr-2" />使用者管理</h3>
                     <p className="text-gray-500 mb-4">新增、編輯或刪除系統操作員帳號。</p>
                     <button className="px-4 py-2 bg-gray-200 text-gray-500 font-semibold rounded-lg cursor-not-allowed">即將推出</button>
                </div>
                 <div className="bg-white p-6 rounded-xl shadow-md opacity-60">
                     <h3 className="text-xl font-semibold text-gray-700 mb-2 flex items-center"><History className="mr-2" />操作日誌查詢</h3>
                     <p className="text-gray-500 mb-4">查詢特定訂單或人員的所有操作記錄。</p>
                     <button className="px-4 py-2 bg-gray-200 text-gray-500 font-semibold rounded-lg cursor-not-allowed">即將推出</button>
                </div>
            </div>
        </div>
    );
}