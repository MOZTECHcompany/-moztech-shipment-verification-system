import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Server, Package, Loader2, CheckCircle2, ListChecks, AlertCircle } from 'lucide-react';

// 只需註冊一次 ChartJS 的元件
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// StatCard 元件 (這個部分保持不變，設計得很好)
function StatCard({ title, value, isLoading, error, icon: Icon, colorClass }) {
  const displayValue = () => {
    if (isLoading) return <Loader2 size={24} className="animate-spin text-gray-400" />;
    if (error) return <AlertCircle size={24} className="text-red-400" />;
    return value !== null && typeof value !== 'undefined' ? value : '--';
  };
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm flex items-center gap-4 border hover:shadow-md transition-shadow">
      <div className={`p-3 rounded-full ${colorClass}`}><Icon size={24} className="text-white" /></div>
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
        <p className="text-3xl font-bold text-gray-800">{displayValue()}</p>
      </div>
    </div>
  );
}

// 主儀表板元件
export function AdminDashboard({ user }) {
  const [summaryData, setSummaryData] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- 這是整個元件的核心邏輯 ---
  useEffect(() => {
    // 1. 設定你的後端基礎 URL
    const backendUrl = 'https://moztech-wms-api.onrender.com';

    // 2. 定義我們要呼叫的 API 端點
    const summaryApiUrl = `${backendUrl}/api/reports/summary`;
    // 假設我們未來會有一個每日訂單的 API
    const dailyOrdersApiUrl = `${backendUrl}/api/reports/daily-orders`;

    // 3. 使用異步函數來獲取所有數據
    const fetchData = async () => {
      // 在開始請求前，確保 isLoading 是 true 且沒有錯誤
      setIsLoading(true);
      setError(null);
      
      try {
        // 使用 Promise.all 並行發送多個請求，速度更快
        // 注意：目前後端還沒有 /daily-orders，所以我們先註解掉它
        const [summaryRes /*, chartRes*/] = await Promise.all([
          axios.get(summaryApiUrl),
          // axios.get(dailyOrdersApiUrl) // <-- 暫時註解，等後端做好再打開
        ]);

        // 成功獲取數據後，更新 state
        setSummaryData(summaryRes.data);
        // setChartData(chartRes.data); // <-- 暫時註解

        console.log("✅ 成功從後端獲取儀表板數據:", summaryRes.data);

      } catch (err) {
        // 捕獲任何網路或伺服器錯誤
        console.error("❌ 獲取儀表板數據失敗", err);
        let errorMessage = "無法載入數據，請檢查後端服務或網路連線。";
        if (err.response) {
          // 如果後端有回傳具體的錯誤訊息 (例如 404, 500)
          errorMessage += ` (錯誤碼: ${err.response.status})`;
        }
        setError(errorMessage);
      } finally {
        // 無論成功或失敗，最後都要結束載入狀態
        setIsLoading(false);
      }
    };

    // 4. 呼叫這個異步函數
    fetchData();

  }, []); // 空依賴陣列 `[]` 確保這個 effect 只在元件第一次載入時執行一次

  // --- 圖表設定 (這個部分保持不變) ---
  const lineChartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: true, text: '每日訂單數量趨勢' } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }
  };
  const lineChartData = {
    labels: chartData?.labels || [],
    datasets: [{
      label: '訂單數量', data: chartData?.data || [], fill: true,
      backgroundColor: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 1)', tension: 0.3,
    }],
  };
  
  // --- 渲染畫面 (這個部分保持不變) ---
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
            <Server size={32} /><span>後台數據總覽</span>
          </h1>
          <p className="text-gray-500 mt-1">即時業務核心指標</p>
        </div>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="總訂單數" value={summaryData?.totalOrders} isLoading={isLoading} error={error} icon={Package} colorClass="bg-blue-500" />
        <StatCard title="待處理訂單" value={summaryData?.pendingOrders} isLoading={isLoading} error={error} icon={Loader2} colorClass="bg-yellow-500" />
        <StatCard title="已完成訂單" value={summaryData?.completedOrders} isLoading={isLoading} error={error} icon={CheckCircle2} colorClass="bg-green-500" />
        <StatCard title="總出貨品項數" value={summaryData?.totalItems} isLoading={isLoading} error={error} icon={ListChecks} colorClass="bg-indigo-500" />
      </div>
      {error && !isLoading && (
        <div className="mt-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg" role="alert">
          <strong className="font-bold">資料載入失敗: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}
      <div className="mt-8 bg-white p-6 rounded-xl shadow-md border h-96">
        {isLoading ? (
          <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin h-8 w-8 text-blue-500" /></div>
        ) : chartData ? (
          <Line options={lineChartOptions} data={lineChartData} />
        ) : (
          <div className="flex justify-center items-center h-full text-gray-500">
            {error ? '圖表資料載入失敗。' : '後端尚未提供圖表數據。'}
          </div>
        )}
      </div>
    </div>
  );
}