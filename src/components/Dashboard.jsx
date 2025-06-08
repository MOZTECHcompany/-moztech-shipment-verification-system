// src/components/Dashboard.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

// Helper Components & Functions... (保持不變)
const getItemStatus = (item, pickedQty, packedQty) => { /* ... */ };
const ProgressBar = ({ value, max, colorClass }) => { /* ... */ };
const normalizeString = (str) => { /* ... */ };
const ProgressDashboard = ({ stats }) => { /* ... */ };

// 為了讓程式碼更簡潔，這裡省略了以上元件的內部程式碼，實際複製時請包含它們
// 在下方提供的完整程式碼中，這些都是包含在內的

export function Dashboard({ user, onLogout }) {
  const MySwal = withReactContent(Swal);

  // 【本機儲存】1. 修改 useState，使其從 localStorage 初始化
  const [shipmentData, setShipmentData] = useState(() => JSON.parse(localStorage.getItem('shipment_data')) || []);
  const [scannedItems, setScannedItems] = useState(() => JSON.parse(localStorage.getItem('scanned_items')) || {});
  const [confirmedItems, setConfirmedItems] = useState(() => JSON.parse(localStorage.getItem('confirmed_items')) || {});
  const [orderId, setOrderId] = useState(() => localStorage.getItem('order_id') || "尚未匯入");
  
  // 其他狀態保持不變
  const [errors, setErrors] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [flash, setFlash] = useState({ sku: null, type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlightedSku, setHighlightedSku] = useState(null);

  const barcodeInputRef = useRef(null);
  const itemRefs = useRef({});

  // 既有的 useEffect Hooks... (保持不變)
  useEffect(() => { barcodeInputRef.current?.focus(); }, [shipmentData]);
  useEffect(() => {
    if (errors.length > 0 && errors[0]?.isNew) {
      setErrorAnimation(true);
      const animationTimer = setTimeout(() => setErrorAnimation(false), 1000);
      const highlightTimer = setTimeout(() => { setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e)); }, 2000);
      return () => { clearTimeout(animationTimer); clearTimeout(highlightTimer); };
    }
  }, [errors]);

  // 【本機儲存】2. 新增 useEffect，在進度更新時寫入資料
  useEffect(() => { localStorage.setItem('scanned_items', JSON.stringify(scannedItems)); }, [scannedItems]);
  useEffect(() => { localStorage.setItem('confirmed_items', JSON.stringify(confirmedItems)); }, [confirmedItems]);

  const progressStats = useMemo(() => { /* ... */ });
  const sortedShipmentData = useMemo(() => { /* ... */ });
  useEffect(() => { /* ... 智慧聚焦的 useEffect ... */ }, [sortedShipmentData, confirmedItems]);
  
  // 為了讓程式碼更簡潔，這裡省略了以上 useMemo/useEffect 的內部程式碼

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼'));
        const parsedOrderId = orderIdRow ? String(orderIdRow[0]).replace('憑證號碼 :', '').trim() : 'N/A';
        const headerIndex = jsonData.findIndex((row) => String(row[0]) === '品項編碼');
        if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位。請檢查Excel格式。");
        const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]);
        const parsed = detailRows.map((row) => ({ orderId: parsedOrderId, itemName: String(row[1]), sku: String(row[0]), barcode: String(row[0]), quantity: Number(row[2]) }));
        if (parsed.length === 0) { throw new Error("Excel 中沒有找到有效的品項資料。"); }
        
        // 【本機儲存】3. 匯入新單時，保存新資料並清除舊進度
        localStorage.setItem('shipment_data', JSON.stringify(parsed));
        localStorage.setItem('order_id', parsedOrderId);
        localStorage.removeItem('scanned_items');
        localStorage.removeItem('confirmed_items');
        
        // 更新 React 狀態
        setShipmentData(parsed);
        setOrderId(parsedOrderId);
        setScannedItems({});
        setConfirmedItems({});
        setErrors([]);
        
        toast.success("匯入成功", { description: `貨單 ${parsedOrderId} 已載入。` });
        
      } catch (err) {
        MySwal.fire({ icon: 'error', title: 'Excel 匯入失敗', text: err.message });
        // 清除所有相關資料以避免髒數據
        localStorage.removeItem('shipment_data');
        localStorage.removeItem('scanned_items');
        localStorage.removeItem('confirmed_items');
        localStorage.removeItem('order_id');
        setShipmentData([]); setOrderId("尚未匯入");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };
  
  // 登出時清除所有作業資料
  const handleLogout = () => {
    localStorage.removeItem('shipment_data');
    localStorage.removeItem('scanned_items');
    localStorage.removeItem('confirmed_items');
    localStorage.removeItem('order_id');
    onLogout(); // 執行 App.jsx 傳來的登出函式
  };

  const playSound = (type) => { /* ... */ };
  const handleError = (errorData) => { /* ... */ };
  const handleScan = () => { /* ... */ };

  const roleInfo = { /* ... */ };
  
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user.role]?.icon || <Package size={32} />}<span>{roleInfo[user.role]?.name || user.role}作業</span></h1><p className="text-gray-500 mt-1">操作員: {user.name} ({user.id})</p></div>
        {/* 【本機儲存】4. 確保登出按鈕呼叫新的 handleLogout 函式 */}
        <button onClick={handleLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
      </header>

      <ProgressDashboard stats={progressStats} />
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ... */}
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">作業清單 ({orderId})</h2>
            {sortedShipmentData.length > 0 ? (
              <div className="space-y-3">
                {sortedShipmentData.map((item) => {
                  const pickedQty = scannedItems[item.sku] || 0;
                  const packedQty = confirmedItems[item.sku] || 0;
                  const status = getItemStatus(item, pickedQty, packedQty);
                  const isCompleted = packedQty >= item.quantity;
                  const animationClass = flash.sku === item.sku ? (flash.type === 'green' ? 'animate-flash-green' : 'animate-flash-yellow') : '';
                  const highlightClass = highlightedSku === item.sku ? 'bg-blue-100 ring-2 ring-blue-400' : '';
                  const completedClass = isCompleted ? 'opacity-50 hover:opacity-100' : '';
                  return ( <div key={item.sku} ref={el => (itemRefs.current[item.sku] = el)} className={`border rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-all hover:shadow-lg ${animationClass} ${highlightClass} ${completedClass}`}> {/* ... */} </div> );
                })}
              </div>
            ) : ( <div className="text-center py-16 text-gray-500"><p>請先從左側匯入出貨單以開始作業。</p></div> )}
          </div>
        </div>
      </div>
      
      {errors.length > 0 && ( <div className={`mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200 transition-all ${errorAnimation ? 'animate-shake animate-flash-red-border' : ''}`}> {/* ... */} </div> )}
    </div>
  );
}


// 注意：為保持簡潔，部分未變更的函式和 JSX 內容用 /* ... */ 省略了
// 實際的完整程式碼將包含所有這些內容
// 以下是完整的、未經省略的程式碼

// =========================================================
//            ↓ ↓ ↓ 完整的程式碼 ↓ ↓ ↓
// =========================================================

// src/components/Dashboard.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

// Helper Components & Functions
const getItemStatus = (item, pickedQty, packedQty) => {
    const expectedQty = item.quantity;
    if (packedQty >= expectedQty) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" };
    if (pickedQty >= expectedQty) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" };
    if (pickedQty > 0 || packedQty > 0) return { Icon: Loader2, color: "text-yellow-500 animate-spin", label: "處理中" };
    return { Icon: Circle, color: "text-gray-400", label: "待處理" };
};
const ProgressBar = ({ value, max, colorClass }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return (
        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
            <div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div>
        </div>
    );
};
const normalizeString = (str) => {
  if (!str) return "";
  return String(str).replace(/[^a-zA-Z0-9]/g, '');
};
const ProgressDashboard = ({ stats }) => {
  const { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats;
  if (totalSkus === 0) return null;
  const isAllPacked = packedSkus >= totalSkus;
  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-8">
      <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr-2" />任務總覽</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm text-gray-500">品項完成度</p><p className="text-2xl font-bold text-gray-800">{packedSkus}<span className="text-lg font-normal text-gray-500">/{totalSkus}</span></p></div>
        <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-700">總揀貨數</p><p className="text-2xl font-bold text-blue-600">{totalPickedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
        <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-green-700">總裝箱數</p><p className="text-2xl font-bold text-green-600">{totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
      </div>
      <div className="mt-4">
        {isAllPacked ? (
          <div className="flex items-center justify-center p-2 bg-green-100 text-green-700 rounded-lg"><CheckCircle2 className="mr-2" /><span className="font-semibold">恭喜！所有品項已完成裝箱！</span></div>
        ) : (
          <><p className="text-sm text-gray-600 mb-1">整體進度</p><ProgressBar value={totalPackedQty} max={totalQuantity} colorClass="bg-gradient-to-r from-green-400 to-emerald-500 h-2.5" /></>
        )}
      </div>
    </div>
  );
};

export function Dashboard({ user, onLogout }) {
  const MySwal = withReactContent(Swal);
  
  // 【本機儲存】1. 從 localStorage 初始化狀態
  const [shipmentData, setShipmentData] = useState(() => JSON.parse(localStorage.getItem('shipment_data')) || []);
  const [scannedItems, setScannedItems] = useState(() => JSON.parse(localStorage.getItem('scanned_items')) || {});
  const [confirmedItems, setConfirmedItems] = useState(() => JSON.parse(localStorage.getItem('confirmed_items')) || {});
  const [orderId, setOrderId] = useState(() => localStorage.getItem('order_id') || "尚未匯入");
  
  const [errors, setErrors] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [flash, setFlash] = useState({ sku: null, type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlightedSku, setHighlightedSku] = useState(null);

  const barcodeInputRef = useRef(null);
  const itemRefs = useRef({});

  useEffect(() => { barcodeInputRef.current?.focus(); }, [shipmentData]);
  useEffect(() => {
    if (errors.length > 0 && errors[0]?.isNew) {
      setErrorAnimation(true);
      const animationTimer = setTimeout(() => setErrorAnimation(false), 1000);
      const highlightTimer = setTimeout(() => { setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e)); }, 2000);
      return () => { clearTimeout(animationTimer); clearTimeout(highlightTimer); };
    }
  }, [errors]);

  // 【本機儲存】2. 監聽進度變化並儲存
  useEffect(() => { localStorage.setItem('scanned_items', JSON.stringify(scannedItems)); }, [scannedItems]);
  useEffect(() => { localStorage.setItem('confirmed_items', JSON.stringify(confirmedItems)); }, [confirmedItems]);

  const progressStats = useMemo(() => {
    const totalSkus = shipmentData.length;
    const totalQuantity = shipmentData.reduce((sum, item) => sum + item.quantity, 0);
    const packedSkus = shipmentData.filter(item => (confirmedItems[item.sku] || 0) >= item.quantity).length;
    const totalPickedQty = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
    const totalPackedQty = Object.values(confirmedItems).reduce((sum, qty) => sum + qty, 0);
    return { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty };
  }, [shipmentData, scannedItems, confirmedItems]);
  
  const sortedShipmentData = useMemo(() => {
    if (!shipmentData.length) return [];
    const isItemComplete = (item) => (confirmedItems[item.sku] || 0) >= item.quantity;
    return [...shipmentData].sort((a, b) => isItemComplete(a) - isItemComplete(b));
  }, [shipmentData, confirmedItems]);
  
  useEffect(() => {
    const firstUnfinished = sortedShipmentData.find(item => (confirmedItems[item.sku] || 0) < item.quantity);
    const newHighlightedSku = firstUnfinished ? firstUnfinished.sku : null;
    setHighlightedSku(newHighlightedSku);
    if (newHighlightedSku && itemRefs.current[newHighlightedSku]) {
      itemRefs.current[newHighlightedSku].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sortedShipmentData]);

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼'));
        const parsedOrderId = orderIdRow ? String(orderIdRow[0]).replace('憑證號碼 :', '').trim() : 'N/A';
        const headerIndex = jsonData.findIndex((row) => String(row[0]) === '品項編碼');
        if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位。請檢查Excel格式。");
        const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]);
        const parsed = detailRows.map((row) => ({ orderId: parsedOrderId, itemName: String(row[1]), sku: String(row[0]), barcode: String(row[0]), quantity: Number(row[2]) }));
        if (parsed.length === 0) { throw new Error("Excel 中沒有找到有效的品項資料。"); }
        
        // 【本機儲存】3. 儲存新資料，清除舊進度
        localStorage.setItem('shipment_data', JSON.stringify(parsed));
        localStorage.setItem('order_id', parsedOrderId);
        localStorage.removeItem('scanned_items');
        localStorage.removeItem('confirmed_items');
        
        setShipmentData(parsed);
        setOrderId(parsedOrderId);
        setScannedItems({});
        setConfirmedItems({});
        setErrors([]);
        
        toast.success("匯入成功", { description: `貨單 ${parsedOrderId} 已載入。` });
        
      } catch (err) {
        MySwal.fire({ icon: 'error', title: 'Excel 匯入失敗', text: err.message });
        setShipmentData([]); setOrderId("尚未匯入");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };

  const triggerFlash = (sku, type) => { setFlash({ sku, type }); setTimeout(() => setFlash({ sku: null, type: null }), 700); };
  
  const playSound = (type) => { /* ... */ };
  const handleError = (errorData) => { /* ... */ };
  const handleScan = () => { /* ... */ };

  const handleLogout = () => {
    localStorage.removeItem('shipment_data');
    localStorage.removeItem('scanned_items');
    localStorage.removeItem('confirmed_items');
    localStorage.removeItem('order_id');
    onLogout();
  };
  
  const roleInfo = {
    picker: { name: '揀貨', icon: <Package /> },
    packer: { name: '裝箱', icon: <PackageCheck /> },
    admin: { name: '管理', icon: <PackageCheck /> },
  };
  
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user.role]?.icon || <Package size={32} />}<span>{roleInfo[user.role]?.name || user.role}作業</span></h1><p className="text-gray-500 mt-1">操作員: {user.name} ({user.id})</p></div>
        {/* 【本機儲存】4. 使用新的登出函式 */}
        <button onClick={handleLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
      </header>
      <ProgressDashboard stats={progressStats} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">{/* ... 左側控制區 ... */}</div>
        <div className="lg:col-span-2">{/* ... 右側作業清單 ... */}</div>
      </div>
      {errors.length > 0 && ( <div className={`mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200 transition-all ${errorAnimation ? 'animate-shake animate-flash-red-border' : ''}`}>{/* ... 錯誤列表 ... */}</div> )}
    </div>
  );
}

// 重新補全省略的函式和 JSX 內容
const fullCode = (function() {
    // 完整的 playSound, handleError, handleScan, 和 return 語句中的 JSX 內容
    const _playSound = (type) => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        if (type === 'error') {
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        }
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.15);
      } catch (e) {
        console.error("無法播放音效:", e);
      }
    };
    
    Dashboard.prototype.playSound = _playSound;
    
    Dashboard.prototype.handleError = function(errorData) {
        this.playSound('error');
        const fullErrorData = { ...errorData, isNew: true, time: new Date().toLocaleString(), user: this.props.user.name, role: this.props.user.role };
        this.setState(prevState => ({ errors: [fullErrorData, ...prevState.errors] }));
        if (errorData.sku) {
          this.triggerFlash(errorData.sku, 'yellow');
        }
        this.MySwal.fire({
          icon: 'error',
          title: `<span class="text-2xl font-bold">${errorData.toastTitle}</span>`,
          html: `<div class="text-left text-gray-700 space-y-2 mt-4"><p>${errorData.toastDescription}</p>${errorData.barcode ? `<p><strong>掃描條碼:</strong> <span class="font-mono bg-red-100 px-2 py-1 rounded">${errorData.barcode}</span></p>` : ''}${errorData.itemName ? `<p><strong>品項名稱:</strong> ${errorData.itemName}</p>` : ''}</div>`,
          confirmButtonText: '我知道了',
          confirmButtonColor: '#3B82F6',
          customClass: { popup: 'rounded-xl', confirmButton: 'px-6 py-2 font-semibold text-white rounded-lg shadow-md hover:bg-blue-600' }
        });
    };
    
    Dashboard.prototype.handleScan = function() {
        // 這段程式碼在 React Hooks 中不能這樣寫，因此我會直接將完整的、正確的函式提供在下方最終版本裡
    };
    return /* The final JSX structure */;
}());

// =================== 真正的最終版本，已修復省略錯誤 ===================
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const getItemStatus = (item, pickedQty, packedQty) => {
    const expectedQty = item.quantity;
    if (packedQty >= expectedQty) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" };
    if (pickedQty >= expectedQty) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" };
    if (pickedQty > 0 || packedQty > 0) return { Icon: Loader2, color: "text-yellow-500 animate-spin", label: "處理中" };
    return { Icon: Circle, color: "text-gray-400", label: "待處理" };
};
const ProgressBar = ({ value, max, colorClass }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return (
        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
            <div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div>
        </div>
    );
};
const normalizeString = (str) => {
  if (!str) return "";
  return String(str).replace(/[^a-zA-Z0-9]/g, '');
};
const ProgressDashboard = ({ stats }) => {
  const { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats;
  if (totalSkus === 0) return null;
  const isAllPacked = packedSkus >= totalSkus;
  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-8">
      <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr-2" />任務總覽</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm text-gray-500">品項完成度</p><p className="text-2xl font-bold text-gray-800">{packedSkus}<span className="text-lg font-normal text-gray-500">/{totalSkus}</span></p></div>
        <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-700">總揀貨數</p><p className="text-2xl font-bold text-blue-600">{totalPickedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
        <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-green-700">總裝箱數</p><p className="text-2xl font-bold text-green-600">{totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
      </div>
      <div className="mt-4">
        {isAllPacked ? (
          <div className="flex items-center justify-center p-2 bg-green-100 text-green-700 rounded-lg"><CheckCircle2 className="mr-2" /><span className="font-semibold">恭喜！所有品項已完成裝箱！</span></div>
        ) : (
          <><p className="text-sm text-gray-600 mb-1">整體進度</p><ProgressBar value={totalPackedQty} max={totalQuantity} colorClass="bg-gradient-to-r from-green-400 to-emerald-500 h-2.5" /></>
        )}
      </div>
    </div>
  );
};

export function Dashboard({ user, onLogout }) {
  const MySwal = withReactContent(Swal);
  const [shipmentData, setShipmentData] = useState(() => JSON.parse(localStorage.getItem('shipment_data')) || []);
  const [scannedItems, setScannedItems] = useState(() => JSON.parse(localStorage.getItem('scanned_items')) || {});
  const [confirmedItems, setConfirmedItems] = useState(() => JSON.parse(localStorage.getItem('confirmed_items')) || {});
  const [orderId, setOrderId] = useState(() => localStorage.getItem('order_id') || "尚未匯入");
  const [errors, setErrors] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [flash, setFlash] = useState({ sku: null, type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlightedSku, setHighlightedSku] = useState(null);

  const barcodeInputRef = useRef(null);
  const itemRefs = useRef({});

  useEffect(() => { barcodeInputRef.current?.focus(); }, [shipmentData]);
  useEffect(() => {
    if (errors.length > 0 && errors[0]?.isNew) {
      setErrorAnimation(true);
      const animationTimer = setTimeout(() => setErrorAnimation(false), 1000);
      const highlightTimer = setTimeout(() => { setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e)); }, 2000);
      return () => { clearTimeout(animationTimer); clearTimeout(highlightTimer); };
    }
  }, [errors]);

  useEffect(() => { localStorage.setItem('scanned_items', JSON.stringify(scannedItems)); }, [scannedItems]);
  useEffect(() => { localStorage.setItem('confirmed_items', JSON.stringify(confirmedItems)); }, [confirmedItems]);

  const progressStats = useMemo(() => {
    const totalSkus = shipmentData.length;
    const totalQuantity = shipmentData.reduce((sum, item) => sum + item.quantity, 0);
    const packedSkus = shipmentData.filter(item => (confirmedItems[item.sku] || 0) >= item.quantity).length;
    const totalPickedQty = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
    const totalPackedQty = Object.values(confirmedItems).reduce((sum, qty) => sum + qty, 0);
    return { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty };
  }, [shipmentData, scannedItems, confirmedItems]);
  
  const sortedShipmentData = useMemo(() => {
    if (!shipmentData.length) return [];
    const isItemComplete = (item) => (confirmedItems[item.sku] || 0) >= item.quantity;
    return [...shipmentData].sort((a, b) => isItemComplete(a) - isItemComplete(b));
  }, [shipmentData, confirmedItems]);
  
  useEffect(() => {
    const firstUnfinished = sortedShipmentData.find(item => (confirmedItems[item.sku] || 0) < item.quantity);
    const newHighlightedSku = firstUnfinished ? firstUnfinished.sku : null;
    setHighlightedSku(newHighlightedSku);
    if (newHighlightedSku && itemRefs.current[newHighlightedSku]) {
      itemRefs.current[newHighlightedSku].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sortedShipmentData]);

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼'));
        const parsedOrderId = orderIdRow ? String(orderIdRow[0]).replace('憑證號碼 :', '').trim() : 'N/A';
        const headerIndex = jsonData.findIndex((row) => String(row[0]) === '品項編碼');
        if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位。請檢查Excel格式。");
        const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]);
        const parsed = detailRows.map((row) => ({ orderId: parsedOrderId, itemName: String(row[1]), sku: String(row[0]), barcode: String(row[0]), quantity: Number(row[2]) }));
        if (parsed.length === 0) { throw new Error("Excel 中沒有找到有效的品項資料。"); }
        
        localStorage.setItem('shipment_data', JSON.stringify(parsed));
        localStorage.setItem('order_id', parsedOrderId);
        localStorage.removeItem('scanned_items');
        localStorage.removeItem('confirmed_items');
        
        setShipmentData(parsed);
        setOrderId(parsedOrderId);
        setScannedItems({});
        setConfirmedItems({});
        setErrors([]);
        toast.success("匯入成功", { description: `貨單 ${parsedOrderId} 已載入。` });
        
      } catch (err) {
        MySwal.fire({ icon: 'error', title: 'Excel 匯入失敗', text: err.message });
        setShipmentData([]); setOrderId("尚未匯入");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };

  const triggerFlash = (sku, type) => { setFlash({ sku, type }); setTimeout(() => setFlash({ sku: null, type: null }), 700); };
  
  const playSound = (type) => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        if (type === 'error') {
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        }
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.15);
      } catch (e) {
        console.error("無法播放音效:", e);
      }
  };

  const handleError = (errorData) => {
    playSound('error');
    const fullErrorData = { ...errorData, isNew: true, time: new Date().toLocaleString(), user: user.name, role: user.role };
    setErrors(prev => [fullErrorData, ...prev]);
    if (errorData.sku) {
      triggerFlash(errorData.sku, 'yellow');
    }
    MySwal.fire({
      icon: 'error',
      title: `<span class="text-2xl font-bold">${errorData.toastTitle}</span>`,
      html: `<div class="text-left text-gray-700 space-y-2 mt-4"><p>${errorData.toastDescription}</p>${errorData.barcode ? `<p><strong>掃描條碼:</strong> <span class="font-mono bg-red-100 px-2 py-1 rounded">${errorData.barcode}</span></p>` : ''}${errorData.itemName ? `<p><strong>品項名稱:</strong> ${errorData.itemName}</p>` : ''}</div>`,
      confirmButtonText: '我知道了',
      confirmButtonColor: '#3B82F6',
      customClass: { popup: 'rounded-xl', confirmButton: 'px-6 py-2 font-semibold text-white rounded-lg shadow-md hover:bg-blue-600' }
    });
  };

  const handleScan = () => {
    const normalizedInput = normalizeString(barcodeInput);
    if (!normalizedInput) { setBarcodeInput(''); return; }
    setBarcodeInput('');
    barcodeInputRef.current?.focus();
    const item = shipmentData.find((i) => normalizeString(i.barcode) === normalizedInput);

    if (!item) {
        handleError({ type: '未知條碼', barcode: barcodeInput.trim(), sku: barcodeInput.trim(), itemName: '',
            toastTitle: "掃描錯誤: 未知條碼", toastDescription: `條碼 "${barcodeInput.trim()}" 不在貨單上。`
        });
        return;
    }
    const itemSku = item.sku; 
    if (user.role === 'admin') {
      const currentPacked = confirmedItems[itemSku] || 0;
      if (currentPacked >= item.quantity) {
        handleError({ type: '管理員超量', barcode: item.barcode, sku: item.sku, itemName: item.itemName,
          toastTitle: "數量警告: 品項已完成", toastDescription: `${item.itemName} 已達應出貨數量。`
        });
      } else {
        const newQty = currentPacked + 1;
        setScannedItems((prev) => ({ ...prev, [itemSku]: newQty }));
        setConfirmedItems((prev) => ({ ...prev, [itemSku]: newQty }));
        toast.success(`管理員操作: ${item.itemName}`, { description: `數量: ${newQty}/${item.quantity}` });
        triggerFlash(itemSku, 'green');
      }
    } else if (user.role === 'picker') {
        const currentQty = scannedItems[itemSku] || 0;
        if (currentQty >= item.quantity) {
             handleError({ type: '揀貨超量', barcode: item.barcode, sku: item.sku, itemName: item.itemName,
                toastTitle: "數量警告: 揀貨超量", toastDescription: `${item.itemName} 已達預期。`
            });
        } else {
            const newQty = currentQty + 1;
            setScannedItems((prev) => ({ ...prev, [itemSku]: newQty }));
            toast.success(`揀貨成功: ${item.itemName}`, { description: `數量: ${newQty}/${item.quantity}` });
            triggerFlash(itemSku, 'green');
        }
    } else if (user.role === 'packer') {
      const pickedQty = scannedItems[itemSku] || 0;
      const confirmedQty = confirmedItems[itemSku] || 0;
      if (pickedQty === 0) {
        handleError({ type: '錯誤流程', barcode: item.barcode, sku: item.sku, itemName: item.itemName,
          toastTitle: "流程錯誤: 請先揀貨", toastDescription: `${item.itemName} 尚未揀貨。`
        });
      } else if (confirmedQty >= pickedQty) {
        handleError({ type: '裝箱超量(>揀貨)', barcode: item.barcode, sku: item.sku, itemName: item.itemName,
          toastTitle: "數量警告: 裝箱超量", toastDescription: `裝箱數已達揀貨數。`
        });
      } else {
        const newQty = confirmedQty + 1;
        setConfirmedItems((prev) => ({ ...prev, [itemSku]: newQty }));
        toast.success(`裝箱成功: ${item.itemName}`, { description: `數量: ${newQty}/${item.quantity}` });
        triggerFlash(itemSku, 'green');
      }
    }
  };
  
  const handleLogout = () => {
    localStorage.removeItem('shipment_data');
    localStorage.removeItem('scanned_items');
    localStorage.removeItem('confirmed_items');
    localStorage.removeItem('order_id');
    onLogout();
  };

  const roleInfo = {
    picker: { name: '揀貨', icon: <Package /> },
    packer: { name: '裝箱', icon: <PackageCheck /> },
    admin: { name: '管理', icon: <PackageCheck /> },
  };
  
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user.role]?.icon || <Package size={32} />}<span>{roleInfo[user.role]?.name || user.role}作業</span></h1><p className="text-gray-500 mt-1">操作員: {user.name} ({user.id})</p></div>
        <button onClick={handleLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
      </header>

      <ProgressDashboard stats={progressStats} />
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2"/>1. 匯入出貨單</h2><input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" /></div>
          <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>2. 掃描區</h2><div className="flex gap-2"><input ref={barcodeInputRef} type="text" placeholder="掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} className="w-full px-4 py-2 border rounded-lg" disabled={shipmentData.length === 0} /><button onClick={handleScan} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300" disabled={shipmentData.length === 0}>確認</button></div></div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">作業清單 ({orderId})</h2>
            {sortedShipmentData.length > 0 ? (
              <div className="space-y-3">
                {sortedShipmentData.map((item) => {
                  const pickedQty = scannedItems[item.sku] || 0;
                  const packedQty = confirmedItems[item.sku] || 0;
                  const status = getItemStatus(item, pickedQty, packedQty);
                  const isCompleted = packedQty >= item.quantity;
                  const animationClass = flash.sku === item.sku ? (flash.type === 'green' ? 'animate-flash-green' : 'animate-flash-yellow') : '';
                  const highlightClass = highlightedSku === item.sku ? 'bg-blue-100 ring-2 ring-blue-400' : '';
                  const completedClass = isCompleted ? 'opacity-50 hover:opacity-100' : '';
                  
                  return (
                    <div 
                      key={item.sku}
                      ref={el => (itemRefs.current[item.sku] = el)}
                      className={`border rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-all hover:shadow-lg ${animationClass} ${highlightClass} ${completedClass}`}
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div title={status.label}><status.Icon size={28} className={status.color}/></div>
                        <div><p className="font-semibold text-gray-800">{item.itemName}</p><p className="text-sm text-gray-500 font-mono">{item.barcode}</p></div>
                      </div>
                      <div className="w-full sm:w-auto flex items-center gap-4">
                         <div className="w-28 text-center"><span className="font-bold text-lg text-blue-600">{pickedQty}</span><span className="text-gray-500">/{item.quantity}</span><ProgressBar value={pickedQty} max={item.quantity} colorClass="bg-blue-500" /></div>
                         <div className="w-28 text-center"><span className="font-bold text-lg text-green-600">{packedQty}</span><span className="text-gray-500">/{item.quantity}</span><ProgressBar value={packedQty} max={item.quantity} colorClass="bg-green-500" /></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : ( <div className="text-center py-16 text-gray-500"><p>請先從左側匯入出貨單以開始作業。</p></div> )}
          </div>
        </div>
      </div>
      
      {errors.length > 0 && (
        <div className={`mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200 transition-all ${errorAnimation ? 'animate-shake animate-flash-red-border' : ''}`}>
          <h2 className="text-xl font-semibold text-red-700 mb-4 flex items-center gap-2"><AlertCircle /> 錯誤紀錄</h2>
          <ul className="space-y-2">
            {errors.map((err, index) => {
              const highlightClass = err.isNew ? 'bg-red-200' : 'bg-white';
              return (
                <li key={index} className={`flex items-center flex-wrap gap-x-4 gap-y-1 p-3 rounded-md transition-colors duration-1000 ${highlightClass}`}>
                  <span className="font-semibold text-red-600 w-36">{err.type}</span>
                  <span className="font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">{err.barcode}</span>
                  <span className="text-gray-600 flex-grow">{err.itemName}</span>
                  <span className="text-sm text-gray-500">{err.time}</span>
                  <span className="text-sm text-gray-500">{err.user} ({err.role})</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}