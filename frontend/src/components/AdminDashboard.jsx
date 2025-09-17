// 在 AdminDashboard.jsx 的頂部引入
import React, { useState } from 'react';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format } from 'date-fns';
import apiClient from '@/api/api.js'; // 確保路徑正確
import { toast } from 'sonner';

// 在 AdminDashboard 元件內部
function AdminDashboard() {
    // ... 其他既有的 state 和邏輯
    
    const [dateRange, setDateRange] = useState([new Date(), new Date()]);
    const [startDate, endDate] = dateRange;

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
            responseType: 'blob', // 關鍵：告訴 axios 我們期望接收一個二進位檔案
        });

        toast.promise(promise, {
            loading: `正在產生 ${formattedStartDate} 至 ${formattedEndDate} 的報告...`,
            success: (response) => {
                // 創建一個 Blob URL
                const url = window.URL.createObjectURL(new Blob([response.data]));
                // 創建一個隱藏的 a 標籤來觸發下載
                const link = document.createElement('a');
                link.href = url;
                const fileName = `營運報告_${formattedStartDate}_${formattedEndDate}.csv`;
                link.setAttribute('download', fileName);
                document.body.appendChild(link);
                link.click();
                // 清理
                link.parentNode.removeChild(link);
                window.URL.revokeObjectURL(url);

                return `報告 ${fileName} 已成功下載！`;
            },
            error: (err) => {
                 // 如果後端返回 JSON 錯誤訊息，需要特殊處理
                if (err.response.data.type === 'application/json') {
                    const reader = new FileReader();
                    reader.onload = function() {
                        const errorData = JSON.parse(this.result);
                        toast.error(errorData.message || '產生報告失敗');
                    }
                    reader.readAsText(err.response.data);
                    return '後端回報錯誤';
                }
                return '產生報告失敗，請檢查網路或聯繫管理員';
            },
        });
    };

    return (
        <div>
            {/* ... 您其他的管理員儀表板內容 ... */}

            <div className="bg-white p-6 rounded-xl shadow-md mt-8">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">匯出營運報告</h3>
                <div className="flex items-center gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">選擇日期範圍：</label>
                        <DatePicker
                            selectsRange={true}
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(update) => setDateRange(update)}
                            isClearable={true}
                            dateFormat="yyyy/MM/dd"
                            className="w-full px-3 py-2 border rounded-lg"
                        />
                    </div>
                    <button 
                        onClick={handleExportAdminReport} 
                        className="self-end px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                        disabled={!startDate || !endDate}
                    >
                        下載 CSV 報告
                    </button>
                </div>
            </div>
        </div>
    );
}