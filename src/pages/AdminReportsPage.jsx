// 檔案路徑: src/pages/AdminReportsPage.jsx
// 這是全新的檔案，請直接貼上

import React, { useState } from 'react';
import apiClient from '../api/api'; // 確保路徑正確
import { Download, AlertCircle } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const MySwal = withReactContent(Swal);

function AdminReportsPage() {
    // 預設日期為今天
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleExport = async () => {
        setIsLoading(true);
        setError('');
        
        try {
            // 注意：axios 請求檔案需要設定 responseType 為 'blob'
            // 這樣瀏覽器才會將回應視為二進制檔案，而不是試圖解析為 JSON
            const response = await apiClient.get(`/api/reports/daily-export?date=${date}`, {
                responseType: 'blob',
            });

            // 檢查回應是否真的是一個 Excel 檔案，而不是一個包含錯誤訊息的 JSON
            if (response.data.type === 'application/json') {
                // 如果後端出錯，它可能會回傳 JSON。我們需要處理這種情況。
                const errorText = await response.data.text();
                const errorJson = JSON.parse(errorText);
                throw new Error(errorJson.message || '後端回傳了非預期的錯誤格式');
            }

            // 建立一個 Blob URL 來觸發瀏覽器下載
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            // 設定下載的檔案名稱
            link.setAttribute('download', `WMS_Daily_Report_${date}.xlsx`);
            document.body.appendChild(link);
            link.click();
            
            // 清理：移除臨時建立的連結並釋放 URL 物件
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);

        } catch (err) {
            console.error('匯出失敗', err);
            const errorMessage = err.response?.data?.message || err.message || '匯出報表失敗，請確認您有管理員權限或聯繫技術支援。';
            setError(errorMessage);
            MySwal.fire({
                icon: 'error',
                title: '匯出失敗',
                text: errorMessage,
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-800 mb-6">管理員報表中心</h1>
                
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">每日作業報表匯出</h2>
                    <p className="text-gray-600 mb-4">
                        選擇一個日期，系統將會匯總當天的使用者操作次數、錯誤紀錄等資訊，並產生一份 Excel 報表供您下載。
                    </p>
                    <div className="flex flex-wrap items-center gap-4">
                        <input 
                            type="date" 
                            value={date} 
                            onChange={(e) => setDate(e.target.value)}
                            className="p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        />
                        <button 
                            onClick={handleExport}
                            disabled={isLoading}
                            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                            <Download size={20} />
                            {isLoading ? '產生中...' : '匯出 Excel'}
                        </button>
                    </div>
                    {error && (
                        <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md flex items-center gap-2">
                            <AlertCircle size={20} />
                            <span>{error}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default AdminReportsPage;