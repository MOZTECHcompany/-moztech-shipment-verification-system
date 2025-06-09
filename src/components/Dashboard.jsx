// src/components/Dashboard.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import axios from 'axios'; // 確保 axios 被引入
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks, Minus, Plus } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

// 輔助函數 (保持不變)
const getItemStatus = (item, pickedQty, packedQty) => {
    const expectedQty = item.quantity;
    if (packedQty >= expectedQty) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" };
    if (pickedQty >= expectedQty) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" };
    if (pickedQty > 0 || packedQty > 0) return { Icon: Loader2, color: "text-yellow-500 animate-spin", label: "處理中" };
    return { Icon: Circle, color: "text-gray-400", label: "待處理" };
};
const ProgressBar = ({ value, max, colorClass }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return ( <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div></div> );
};
const normalizeString = (str) => {
  if (!str) return "";
  return String(str).replace(/[^a-zA-Z0-9]/g, '');
};
const QuantityButton = ({ onClick, icon: Icon, disabled }) => (
    <button onClick={onClick} disabled={disabled} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors">
        <Icon size={16} />
    </button>
);
const ProgressDashboard = ({ stats, onExport }) => {
  const { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats;
  if (totalSkus === 0) return null;
  const isAllPacked = packedSkus >= totalSkus;
  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-8">
      <div className="flex justify-between items-start">
        <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr-2" />任務總覽</h2>
        <button onClick={onExport} className="flex items-center text-sm px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300" disabled={totalSkus === 0}>
          <FileUp size={16} className="mr-1.5" />匯出報告
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm text-gray-500">品項完成度</p><p className="text-2xl font-bold text-gray-800">{packedSkus}<span className="text-lg font-normal text-gray-500">/{totalSkus}</span></p></div>
        <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-700">總揀貨數</p><p className="text-2xl font-bold text-blue-600">{totalPickedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
        <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-green-700">總裝箱數</p><p className="text-2xl font-bold text-green-600">{totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
      </div>
      <div className="mt-4">{isAllPacked ? ( <div className="flex items-center justify-center p-2 bg-green-100 text-green-700 rounded-lg"><CheckCircle2 className="mr-2" /><span className="font-semibold">恭喜！所有品項已完成裝箱！</span></div> ) : ( <><p className="text-sm text-gray-600 mb-1">整體進度</p><ProgressBar value={totalPackedQty} max={totalQuantity} colorClass="bg-gradient-to-r from-green-400 to-emerald-500 h-2.5" /></> )}</div>
    </div>
  );
};

// 主元件
export function Dashboard({ user, onLogout }) {
  const MySwal = withReactContent(Swal);
  // localStorage 的鍵名 (保持不變)
  const KEY_SHIPMENT = 'shipment_data';
  const KEY_SCANNED = 'scanned_items';
  const KEY_CONFIRMED = 'confirmed_items';
  const KEY_ORDER_ID = 'order_id';
  const KEY_ERRORS = 'shipment_errors';

  // State (保持不變)
  const [shipmentData, setShipmentData] = useState(() => JSON.parse(localStorage.getItem(KEY_SHIPMENT)) || []);
  const [scannedItems, setScannedItems] = useState(() => JSON.parse(localStorage.getItem(KEY_SCANNED)) || {});
  const [confirmedItems, setConfirmedItems] = useState(() => JSON.parse(localStorage.getItem(KEY_CONFIRMED)) || {});
  const [orderId, setOrderId] = useState(() => localStorage.getItem(KEY_ORDER_ID) || "尚未匯入");
  const [errors, setErrors] = useState(() => JSON.parse(localStorage.getItem(KEY_ERRORS)) || []);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [flash, setFlash] = useState({ sku: null, type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlightedSku, setHighlightedSku] = useState(null);
  
  const barcodeInputRef = useRef(null);
  const itemRefs = useRef({});

  // useEffect hooks (保持不變)
  useEffect(() => { if (shipmentData.length > 0) localStorage.setItem(KEY_SHIPMENT, JSON.stringify(shipmentData)); else localStorage.removeItem(KEY_SHIPMENT); }, [shipmentData]);
  useEffect(() => { localStorage.setItem(KEY_SCANNED, JSON.stringify(scannedItems)); }, [scannedItems]);
  useEffect(() => { localStorage.setItem(KEY_CONFIRMED, JSON.stringify(confirmedItems)); }, [confirmedItems]);
  useEffect(() => { if (orderId && orderId !== "尚未匯入") localStorage.setItem(KEY_ORDER_ID, orderId); else localStorage.removeItem(KEY_ORDER_ID); }, [orderId]);
  useEffect(() => { localStorage.setItem(KEY_ERRORS, JSON.stringify(errors)); }, [errors]);
  useEffect(() => { barcodeInputRef.current?.focus(); }, [shipmentData]);
  useEffect(() => {
    if (errors.length > 0 && errors[0]?.isNew) {
      setErrorAnimation(true);
      const animationTimer = setTimeout(() => setErrorAnimation(false), 1000);
      const highlightTimer = setTimeout(() => { setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e)); }, 2000);
      return () => { clearTimeout(animationTimer); clearTimeout(highlightTimer); };
    }
  }, [errors]);
  
  // useMemo hooks (保持不變)
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

  // ✨✨✨ 這是一個全新的、修正後的檔案上傳函數 ✨✨✨
  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 使用 sonner 來顯示上傳狀態
    const promise = new Promise((resolve, reject) => {
      // 1. 建立 FormData 來打包檔案
      const formData = new FormData();
      formData.append('orderFile', file); // 'orderFile' 必須和後端 multer 的欄位名一致

      // 2. 設定後端 API 的 URL
      const backendUrl = 'https://moztech-wms-api.onrender.com';
      const apiUrl = `${backendUrl}/api/orders/import`;

      // 3. 使用 axios 發送 POST 請求來上傳檔案
      axios.post(apiUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data', // 這是上傳檔案必須的標頭
        },
      }).then(response => {
        // 4. 當後端成功處理後，我們在前端也做一次解析和合併，以更新畫面
        // 這是為了立即看到合併後的效果
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // 在前端也執行一次合併邏輯，以求畫面與資料庫一致
            const items = {};
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
            const headerIndex = jsonData.findIndex((row) => String(row[0]) === '品項編碼');
            if (headerIndex === -1) {
                throw new Error("找不到 '品項編碼' 欄位。請檢查Excel格式。");
            }
            const detailRows = jsonData.slice(headerIndex + 1);

            detailRows.forEach(row => {
                const productCodeValue = row[0];
                const quantityValue = row[2];
                if (!productCodeValue || !quantityValue) return;

                const productCode = String(productCodeValue).replace(/\s/g, '');
                const quantity = parseInt(String(quantityValue), 10) || 0;
                
                if (quantity > 0) {
                    if (items[productCode]) {
                        items[productCode].quantity += quantity;
                    } else {
                        items[productCode] = {
                            sku: productCode,
                            barcode: productCode,
                            itemName: String(row[1] || '').trim(),
                            quantity: quantity,
                        };
                    }
                }
            });

            const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼'));
            const parsedOrderId = orderIdRow ? String(orderIdRow[0]).split(/[:：]/)[1]?.trim() ?? 'N/A' : 'N/A';
            const parsedData = Object.values(items);
            
            // 更新 React state
            setShipmentData(parsedData);
            setScannedItems({});
            setConfirmedItems({});
            setOrderId(parsedOrderId);
            setErrors([]);
        };
        reader.readAsArrayBuffer(file);
        
        // 將後端的成功訊息傳遞給 toast
        resolve(response.data.message);

      }).catch(err => {
        // 捕獲網路或伺服器錯誤
        console.error("檔案上傳失敗", err);
        const errorMessage = err.response?.data?.message || err.message || "發生未知錯誤";
        reject(errorMessage);
      });
    });
    
    // sonner 的 Promise toast
    toast.promise(promise, {
      loading: '正在上傳並處理訂單...',
      success: (message) => `${message}`,
      error: (errorMessage) => `上傳失敗: ${errorMessage}`,
    });

    // 清空 input 的值，這樣才能再次上傳同一個檔案
    e.target.value = null;
  };
  
  // 其他所有函數 (handleLogout, handleExportReport, handleQuantityChange, 等) 保持不變...
  // ... 為了簡潔，這裡省略，請保留你檔案中原有的這些函數 ...
  const handleLogout = () => {
    localStorage.removeItem(KEY_SHIPMENT);
    localStorage.removeItem(KEY_SCANNED);
    localStorage.removeItem(KEY_CONFIRMED);
    localStorage.removeItem(KEY_ORDER_ID);
    localStorage.removeItem(KEY_ERRORS);
    onLogout();
  };
  
  const handleExportReport = () => {
    if (shipmentData.length === 0) {
        toast.error("無法匯出", { description: "目前沒有任何訂單資料。" });
        return;
    }
    try {
      const wb = XLSX.utils.book_new();
      const overviewData = [ ["訂單號碼", orderId], ["操作員", `${user.name} (${user.id})`], ["匯出時間", new Date().toLocaleString()], [], ["總品項數 (SKU)", progressStats.totalSkus], ["總計應出貨數量", progressStats.totalQuantity], ["總計揀貨數量", progressStats.totalPickedQty], ["總計裝箱數量", progress.totalPackedQty], ];
      const overviewWs = XLSX.utils.aoa_to_sheet(overviewData);
      XLSX.utils.book_append_sheet(wb, overviewWs, "作業總覽");
      const detailsData = shipmentData.map(item => ({ "品項編碼 (SKU)": item.sku, "品項名稱": item.itemName, "應出貨數": item.quantity, "已揀貨數": scannedItems[item.sku] || 0, "已裝箱數": confirmedItems[item.sku] || 0, "狀態": getItemStatus(item, scannedItems[item.sku] || 0, confirmedItems[item.sku] || 0).label, }));
      const detailsWs = XLSX.utils.json_to_sheet(detailsData);
      XLSX.utils.book_append_sheet(wb, detailsWs, "品項明細");
      if (errors.length > 0) {
        const errorsData = errors.map(err => ({ "錯誤類型": err.type, "條碼/SKU": err.barcode, "品項名稱": err.itemName || "", "時間": err.time, "操作員": `${err.user} (${err.role})` }));
        const errorsWs = XLSX.utils.json_to_sheet(errorsData);
        XLSX.utils.book_append_sheet(wb, errorsWs, "錯誤紀錄");
      }
      XLSX.writeFile(wb, `作業報告_${orderId}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("報告匯出成功！");
    } catch (err) {
      console.error("匯出報告失敗:", err);
      toast.error("報告匯出失敗", { description: err.message });
    }
  };
  
  const handleQuantityChange = (sku, type, amount) => {
    const item = shipmentData.find(i => i.sku === sku);
    if (!item) return;
    if (type === 'pick') { setScannedItems(prev => { const currentQty = prev[sku] || 0; const newQty = Math.max(0, currentQty + amount); if (newQty > item.quantity && amount > 0) { toast.warning("已達應揀貨數量上限"); return prev; } return { ...prev, [sku]: newQty }; }); } 
    else if (type === 'pack') { setConfirmedItems(prev => { const currentQty = prev[sku] || 0; const newQty = Math.max(0, currentQty + amount); const pickedQty = scannedItems[sku] || 0; if ((newQty > item.quantity || newQty > pickedQty) && amount > 0) { toast.warning("已達裝箱數量上限"); return prev; } return { ...prev, [sku]: newQty }; }); }
  };
  
  const triggerFlash = (sku, type) => { setFlash({ sku, type }); setTimeout(() => setFlash({ sku: null, type: null }), 700); };
  const playSound = (type) => { try { const audioContext = new (window.AudioContext || window.webkitAudioContext)(); const oscillator = audioContext.createOscillator(); const gainNode = audioContext.createGain(); oscillator.connect(gainNode); gainNode.connect(audioContext.destination); if (type === 'error') { oscillator.type = 'square'; oscillator.frequency.setValueAtTime(150, audioContext.currentTime); gainNode.gain.setValueAtTime(0.2, audioContext.currentTime); } oscillator.start(); oscillator.stop(audioContext.currentTime + 0.15); } catch (e) { console.error("無法播放音效:", e); }};
  const handleError = (errorData) => { playSound('error'); const fullErrorData = { ...errorData, isNew: true, time: new Date().toLocaleString(), user: user.name, role: user.role }; setErrors(prev => [fullErrorData, ...prev]); if (errorData.sku) { triggerFlash(errorData.sku, 'yellow'); } MySwal.fire({ icon: 'error', title: `<span class="text-2xl font-bold">${errorData.toastTitle}</span>`, html: `<div class="text-left text-gray-700 space-y-2 mt-4"><p>${errorData.toastDescription}</p>${errorData.barcode ? `<p><strong>掃描條碼:</strong> <span class="font-mono bg-red-100 px-2 py-1 rounded">${errorData.barcode}</span></p>` : ''}${errorData.itemName ? `<p><strong>品項名稱:</strong> ${errorData.itemName}</p>` : ''}</div>`, confirmButtonText: '我知道了', confirmButtonColor: '#3B82F6', customClass: { popup: 'rounded-xl', confirmButton: 'px-6 py-2 font-semibold text-white rounded-lg shadow-md hover:bg-blue-600' } }); };

  const handleScan = () => {
    const normalizedInput = normalizeString(barcodeInput);
    if (!normalizedInput) { setBarcodeInput(''); return; }
    barcodeInputRef.current?.focus();
    const item = shipmentData.find((i) => normalizeString(i.barcode) === normalizedInput);
    if (!item) { handleError({ type: '未知條碼', barcode: barcodeInput.trim(), sku: barcodeInput.trim(), itemName: '', toastTitle: "掃描錯誤: 未知條碼", toastDescription: `條碼 "${barcodeInput.trim()}" 不在貨單上。` }); setBarcodeInput(''); return; }
    const itemSku = item.sku;
    const currentPacked = confirmedItems[itemSku] || 0;
    if (currentPacked >= item.quantity) {
        handleError({ type: '數量警告', barcode: item.barcode, sku: item.sku, itemName: item.itemName, toastTitle: "品項已完成", toastDescription: `${item.itemName} 已達應出貨數量，無需再次掃描。` });
        setBarcodeInput('');
        return;
    }
    const newQty = currentPacked + 1;
    setScannedItems(prev => ({...prev, [itemSku]: Math.max(prev[itemSku] || 0, newQty)})); // 揀貨數至少等於裝箱數
    setConfirmedItems(prev => ({ ...prev, [itemSku]: newQty }));
    toast.success(`掃描成功: ${item.itemName}`, { description: `數量: ${newQty}/${item.quantity}` });
    triggerFlash(itemSku, 'green');
    setBarcodeInput('');
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && barcodeInput.trim() !== '') { e.preventDefault(); handleScan(); } };
  const handleClick = () => { if (barcodeInput.trim() !== '') { handleScan(); } };
  const roleInfo = { picker: { name: '揀貨', icon: <Package /> }, packer: { name: '裝箱', icon: <PackageCheck /> }, admin: { name: '管理', icon: <PackageCheck /> }, };

  // 渲染 JSX (保持不變)
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user.role]?.icon || <Package size={32} />}<span>作業面板</span></h1><p className="text-gray-500 mt-1">操作員: {user.name} ({user.role})</p></div>
        <button onClick={handleLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
      </header>
      <ProgressDashboard stats={progressStats} onExport={handleExportReport} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2"/>1. 匯入出貨單</h2><input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" /></div>
          <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>2. 掃描區</h2><div className="flex gap-2"><input ref={barcodeInputRef} type="text" placeholder="掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={handleKeyDown} className="w-full px-4 py-2 border rounded-lg" disabled={shipmentData.length === 0} /><button onClick={handleClick} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300" disabled={shipmentData.length === 0}>確認</button></div></div>
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
                  const canAdjustPick = ['picker', 'admin'].includes(user.role);
                  const canAdjustPack = ['packer', 'admin'].includes(user.role) && pickedQty > 0;
                  return (
                    <div key={item.sku} ref={el => (itemRefs.current[item.sku] = el)} className={`border rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-all hover:shadow-lg ${animationClass} ${highlightClass} ${completedClass}`}>
                      <div className="flex items-center gap-4 flex-1"><div title={status.label}><status.Icon size={28} className={status.color}/></div><div><p className="font-semibold text-gray-800">{item.itemName}</p><p className="text-sm text-gray-500 font-mono">{item.barcode}</p></div></div>
                      <div className="w-full sm:w-auto flex items-center gap-2">
                        {/* 數量調整區塊 - 這邊我先註解掉以簡化，可以保留你原本的 */}
                        {/* <div className="flex items-center gap-1 w-36">...</div> */}
                        {/* <div className="flex items-center gap-1 w-36">...</div> */}
                         <div className="text-center font-mono text-lg">{packedQty} / {item.quantity}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : ( <div className="text-center py-16 text-gray-500"><p>請先從左側匯入出貨單以開始作業。</p></div> )}
          </div>
        </div>
      </div>
       {/* 錯誤紀錄區塊 - 保持不變 */}
       {errors.length > 0 && ( <div className={`mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200 transition-all ${errorAnimation ? 'animate-shake animate-flash-red-border' : ''}`}><h2 className="text-xl font-semibold text-red-700 mb-4 flex items-center gap-2"><AlertCircle /> 錯誤紀錄</h2><ul className="space-y-2">{errors.map((err, index) => { const highlightClass = err.isNew ? 'bg-red-200' : 'bg-white'; return ( <li key={index} className={`flex items-center flex-wrap gap-x-4 gap-y-1 p-3 rounded-md transition-colors duration-1000 ${highlightClass}`}><span className="font-semibold text-red-600 w-36">{err.type}</span><span className="font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">{err.barcode}</span><span className="text-gray-600 flex-grow">{err.itemName}</span><span className="text-sm text-gray-500">{err.time}</span><span className="text-sm text-gray-500">{err.user} ({err.role})</span></li> ); })}</ul></div> )}
    </div>
  );
}