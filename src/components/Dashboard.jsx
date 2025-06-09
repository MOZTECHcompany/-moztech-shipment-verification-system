// src/components/Dashboard.jsx
import React, { useState, useRef,// 輔助函數區 (無變動)
const getItemStatus = (item, pickedQty, packedQty useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import axios from 'axios';
import { LogOut, Package, PackageCheck, AlertCircle, FileUp) => { const expectedQty = item.quantity; if (packedQty >= expectedQty) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" }; if (pickedQty >=, ScanLine, CheckCircle2, Loader2, Circle, ListChecks, Minus, Plus, Building, User } from expectedQty) return { Icon: PackageCheck, color: "text-blue-500", label: " 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert待裝箱" }; if (pickedQty > 0 || packedQty > 0) return { Icon: Loader2-react-content';

// 輔助函數 (保持不變)
const getItemStatus = (item2, color: "text-yellow-500 animate-spin", label: "處理中" }; return, pickedQty, packedQty) => {
    const expectedQty = item.quantity;
    if (packed { Icon: Circle, color: "text-gray-400", label: "待處理" }; };Qty >= expectedQty) return { Icon: CheckCircle2, color: "text-green-500",
const ProgressBar = ({ value, max, colorClass }) => { const percentage = max > 0 ? (value / max label: "已完成" };
    if (pickedQty >= expectedQty) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" };
    if (picked) * 100 : 0; return ( <div className="w-full bg-gray-2Qty > 0 || packedQty > 0) return { Icon: Loader2, color: "text-yellow00 rounded-full h-1.5 mt-1"><div className={`${colorClass} h-1.-500 animate-spin", label: "處理中" };
    return { Icon: Circle, color5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div></div> ); };: "text-gray-400", label: "待處理" };
};
const ProgressBar = ({
const normalizeString = (str) => { if (!str) return ""; return String(str).replace(/[^a-zA value, max, colorClass }) => {
    const percentage = max > 0 ? (value / max) * 1-Z0-9]/g, ''); };
const QuantityButton = ({ onClick, icon: Icon, disabled })00 : 0;
    return ( <div className="w-full bg-gray-200 rounded-full => ( <button onClick={onClick} disabled={disabled} className="p-1 rounded-full text-gray-500 h-1.5 mt-1"><div className={`${colorClass} h-1.5 rounded-full transition hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not--all duration-300`} style={{ width: `${percentage}%` }}></div></div> );
};
constallowed transition-colors"><Icon size={16} /></button> );
const ProgressDashboard = ({ stats, onExport }) normalizeString = (str) => {
  if (!str) return "";
  return String(str).replace => { const { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats; if(/[^a-zA-Z0-9]/g, '');
};
const QuantityButton = ({ onClick, (totalSkus === 0) return null; const isAllPacked = packedSkus >= totalSkus; icon: Icon, disabled }) => (
    <button onClick={onClick} disabled={disabled} className="p- return ( <div className="bg-white p-6 rounded-xl shadow-md mb-8"><div className="flex justify1 rounded-full text-gray-500 hover:bg-gray-200 disabled:text-gray-3-between items-start"><h2 className="text-xl font-semibold text-gray-700 mb00 disabled:cursor-not-allowed transition-colors">
        <Icon size={16} />
-4 flex items-center"><ListChecks className="mr-2" />任務總覽</h2><button onClick={onExport    </button>
);
const ProgressDashboard = ({ stats, onExport }) => {
  const { totalSkus,} className="flex items-center text-sm px-3 py-1.5 bg-blue-50 packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats;
  if (totalSk0 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-30us === 0) return null;
  const isAllPacked = packedSkus >= totalSkus;
0" disabled={totalSkus === 0}><FileUp size={16} className="mr-1  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-8.5" />匯出報告</button></div><div className="grid grid-cols-1 md:grid">
      <div className="flex justify-between items-start">
        <h2 className="text-xl-cols-3 gap-4 text-center"><div className="bg-gray-50 p-4 rounded font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr--lg"><p className="text-sm text-gray-500">品項完成度</p><2" />任務總覽</h2>
        <button onClick={onExport} className="flex items-center text-p className="text-2xl font-bold text-gray-800">{packedSkus}<span classNamesm px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:="text-lg font-normal text-gray-500">/{totalSkus}</span></p>bg-blue-600 disabled:bg-gray-300" disabled={totalSkus === </div><div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm0}>
          <FileUp size={16} className="mr-1.5" />匯出報告
         text-blue-700">總揀貨數</p><p className="text-2xl font-bold text</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols--blue-600">{totalPickedQty}<span className="text-lg font-normal text-gray-3 gap-4 text-center">
        <div className="bg-gray-50 p-4 rounded500">/{totalQuantity}</span></p></div><div className="bg-green-50 p-lg"><p className="text-sm text-gray-500">品項完成度</p><-4 rounded-lg"><p className="text-sm text-green-700">總裝箱數p className="text-2xl font-bold text-gray-800">{packedSkus}<span className</p><p className="text-2xl font-bold text-green-600">{totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalSkus}</span></p>="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div></div>
        <div className="bg-blue-50 p-4 rounded-lg"><p className="text</div><div className="mt-4">{isAllPacked ? ( <div className="flex items-center justify-center p--sm text-blue-700">總揀貨數</p><p className="text-2xl2 bg-green-100 text-green-700 rounded-lg"><CheckCircle2 className=" font-bold text-blue-600">{totalPickedQty}<span className="text-lg font-normalmr-2" /><span className="font-semibold">恭喜！所有品項已完成裝箱！</span> text-gray-500">/{totalQuantity}</span></p></div>
        <div className="bg</div> ) : ( <><p className="text-sm text-gray-600 mb-1">整體進度-green-50 p-4 rounded-lg"><p className="text-sm text-green-70</p><ProgressBar value={totalPackedQty} max={totalQuantity} colorClass="bg-gradient-to-0">總裝箱數</p><p className="text-2xl font-bold text-green-600">{r from-green-400 to-emerald-500 h-2.5" /></> )}totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity</div></div> ); };


// 主元件
export function Dashboard({ user, onLogout }) {
  const MySw}</span></p></div>
      </div>
      <div className="mt-4">{isAllPacked ? ( <div classNameal = withReactContent(Swal);
  const KEY_SHIPMENT = 'shipment_data';
  const KEY="flex items-center justify-center p-2 bg-green-100 text-green-70_SCANNED = 'scanned_items';
  const KEY_CONFIRMED = 'confirmed_items0 rounded-lg"><CheckCircle2 className="mr-2" /><span className="font-semibold">恭喜！所有';
  const KEY_ORDER_ID = 'order_id';
  const KEY_ORDER_HEADER = '品項已完成裝箱！</span></div> ) : ( <><p className="text-sm text-gray-60order_header'; // 新增 header 的 key
  const KEY_ERRORS = 'shipment_errors';

  0 mb-1">整體進度</p><ProgressBar value={totalPackedQty} max={totalQuantity} color// State 定義區
  const [shipmentData, setShipmentData] = useState(() => JSON.parseClass="bg-gradient-to-r from-green-400 to-emerald-500 h(localStorage.getItem(KEY_SHIPMENT)) || []);
  const [scannedItems, setScannedItems-2.5" /></> )}</div>
    </div>
  );
};

// 主元件
export function Dashboard] = useState(() => JSON.parse(localStorage.getItem(KEY_SCANNED)) || {});
  const({ user, onLogout }) {
  const MySwal = withReactContent(Swal);
  const [confirmedItems, setConfirmedItems] = useState(() => JSON.parse(localStorage.getItem(KEY_CONFIR KEY_SHIPMENT = 'shipment_data';
  const KEY_SCANNED = 'scanned_MED)) || {});
  const [orderId, setOrderId] = useState(() => localStorage.getItem(KEY_items';
  const KEY_CONFIRMED = 'confirmed_items';
  const KEY_ORDER_IDORDER_ID) || "尚未匯入");
  // ✨ 1. 新增這個 state 來儲存 = 'order_id';
  const KEY_ORDER_HEADER = 'order_header'; // 新增 header訂單頭部資訊 ✨
  const [orderHeader, setOrderHeader] = useState(() => JSON.parse 的 key
  const KEY_ERRORS = 'shipment_errors';

  // State
  const [ship(localStorage.getItem(KEY_ORDER_HEADER)) || null);
  const [errors, setErrors] =mentData, setShipmentData] = useState(() => JSON.parse(localStorage.getItem(KEY_SHIPMENT useState(() => JSON.parse(localStorage.getItem(KEY_ERRORS)) || []);
  const [barcodeInput)) || []);
  const [scannedItems, setScannedItems] = useState(() => JSON.parse(, setBarcodeInput] = useState('');
  const [flash, setFlash] = useState({ sku: null,localStorage.getItem(KEY_SCANNED)) || {});
  const [confirmedItems, setConfirmedItems] = type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlight useState(() => JSON.parse(localStorage.getItem(KEY_CONFIRMED)) || {});
  const [orderedSku, setHighlightedSku] = useState(null);
  
  const barcodeInputRef = useRef(nullId, setOrderId] = useState(() => localStorage.getItem(KEY_ORDER_ID) || "尚未匯入);
  const itemRefs = useRef({});

  // useEffect hooks 區
  useEffect(() => { if (ship");
  // ✨✨✨ 1. 新增這個 state ✨✨✨
  const [orderHeader, setOrderHeadermentData.length > 0) localStorage.setItem(KEY_SHIPMENT, JSON.stringify(shipmentData] = useState(() => JSON.parse(localStorage.getItem(KEY_ORDER_HEADER)) || null);
  )); else localStorage.removeItem(KEY_SHIPMENT); }, [shipmentData]);
  useEffect(() => { localStorage
  const [errors, setErrors] = useState(() => JSON.parse(localStorage.getItem(KEY_ERRORS.setItem(KEY_SCANNED, JSON.stringify(scannedItems)); }, [scannedItems]);
)) || []);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [flash, set  useEffect(() => { localStorage.setItem(KEY_CONFIRMED, JSON.stringify(confirmedItems)); }, [confirmedItems]);
  useEffect(() => { if (orderId && orderId !== "尚未匯入") localStorage.Flash] = useState({ sku: null, type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlightedSku, setHighlightedSku] = useState(null);
  
  constsetItem(KEY_ORDER_ID, orderId); else localStorage.removeItem(KEY_ORDER_ID); }, [orderId]);
  // ✨ 2. 新增這個 useEffect 來儲存 header 資訊 ✨
  useEffect(() barcodeInputRef = useRef(null);
  const itemRefs = useRef({});

  // useEffect hooks - 新增對 => { if (orderHeader) localStorage.setItem(KEY_ORDER_HEADER, JSON.stringify(orderHeader)); orderHeader 的存儲
  useEffect(() => { if (shipmentData.length > 0) localStorage. else localStorage.removeItem(KEY_ORDER_HEADER); }, [orderHeader]);
  useEffect(() => { localStorage.setItem(KEY_SHIPMENT, JSON.stringify(shipmentData)); else localStorage.removeItem(KEY_SHIPMENTsetItem(KEY_ERRORS, JSON.stringify(errors)); }, [errors]);
  useEffect(() => { barcode); }, [shipmentData]);
  useEffect(() => { localStorage.setItem(KEY_SCANNED, JSONInputRef.current?.focus(); }, [shipmentData]);
  useEffect(() => { if (errors.length > .stringify(scannedItems)); }, [scannedItems]);
  useEffect(() => { localStorage.setItem(KEY0 && errors[0]?.isNew) { setErrorAnimation(true); const animationTimer = setTimeout(() => setErrorAnimation(false),_CONFIRMED, JSON.stringify(confirmedItems)); }, [confirmedItems]);
  useEffect(() => { if 1000); const highlightTimer = setTimeout(() => { setErrors(currentErrors => currentErrors.map (orderId && orderId !== "尚未匯入") localStorage.setItem(KEY_ORDER_ID, orderId); else localStorage.removeItem(KEY_ORDER_ID); }, [orderId]);
  useEffect(() => { if((e, i) => i === 0 ? { ...e, isNew: false } : e)); }, (orderHeader) localStorage.setItem(KEY_ORDER_HEADER, JSON.stringify(orderHeader)); else localStorage. 2000); return () => { clearTimeout(animationTimer); clearTimeout(highlightTimer); }; } }, [errors]);removeItem(KEY_ORDER_HEADER); }, [orderHeader]);
  useEffect(() => { localStorage.setItem(KEY
  
  // useMemo hooks 區
  const progressStats = useMemo(() => { const totalSk_ERRORS, JSON.stringify(errors)); }, [errors]);
  useEffect(() => { barcodeInputRef.us = shipmentData.length; const totalQuantity = shipmentData.reduce((sum, item) => sum + item.quantitycurrent?.focus(); }, [shipmentData]);
  useEffect(() => {
    if (errors.length >, 0); const packedSkus = shipmentData.filter(item => (confirmedItems[item.sku] ||  0 && errors[0]?.isNew) {
      setErrorAnimation(true);
      const animationTimer =0) >= item.quantity).length; const totalPickedQty = Object.values(scannedItems).reduce(( setTimeout(() => setErrorAnimation(false), 1000);
      const highlightTimer = setTimeout(() => {sum, qty) => sum + qty, 0); const totalPackedQty = Object.values(confirmedItems). setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...ereduce((sum, qty) => sum + qty, 0); return { totalSkus, packedSkus,, isNew: false } : e)); }, 2000);
      return () => { clearTimeout( totalQuantity, totalPickedQty, totalPackedQty }; }, [shipmentData, scannedItems, confirmedItems]);
animationTimer); clearTimeout(highlightTimer); };
    }
  }, [errors]);
  
  // useMemo hooks (  const sortedShipmentData = useMemo(() => { if (!shipmentData.length) return []; const is保持不變)
  const progressStats = useMemo(() => {
    const totalSkus = shipmentDataItemComplete = (item) => (confirmedItems[item.sku] || 0) >= item.quantity;.length;
    const totalQuantity = shipmentData.reduce((sum, item) => sum + item.quantity return [...shipmentData].sort((a, b) => isItemComplete(a) - isItemComplete(b));, 0);
    const packedSkus = shipmentData.filter(item => (confirmedItems[item. }, [shipmentData, confirmedItems]);
  useEffect(() => { const firstUnfinished = sortedShipmentDatasku] || 0) >= item.quantity).length;
    const totalPickedQty = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
    const totalPackedQty.find(item => (confirmedItems[item.sku] || 0) < item.quantity); const newHighlightedSku = Object.values(confirmedItems).reduce((sum, qty) => sum + qty, 0);
     = firstUnfinished ? firstUnfinished.sku : null; setHighlightedSku(newHighlightedSku); if (newreturn { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty };
  },HighlightedSku && itemRefs.current[newHighlightedSku]) { itemRefs.current[newHighlightedSku].scrollInto [shipmentData, scannedItems, confirmedItems]);
  const sortedShipmentData = useMemo(() => {View({ behavior: 'smooth', block: 'center' }); } }, [sortedShipmentData]);

  //
    if (!shipmentData.length) return [];
    const isItemComplete = (item) => ( ✨✨✨ 檔案上傳函數 - 最終版 ✨✨✨
  const handleExcelImport = async (econfirmedItems[item.sku] || 0) >= item.quantity;
    return [...shipmentData].) => {
    const file = e.target.files[0];
    if (!file) return;sort((a, b) => isItemComplete(a) - isItemComplete(b));
  }, [

    const promise = new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.appendshipmentData, confirmedItems]);
  useEffect(() => {
    const firstUnfinished = sortedShipmentData('orderFile', file);
      
      const backendUrl = 'https://moztech-wms-api.find(item => (confirmedItems[item.sku] || 0) < item.quantity);
    const.onrender.com';
      const apiUrl = `${backendUrl}/api/orders/import`;

      axios newHighlightedSku = firstUnfinished ? firstUnfinished.sku : null;
    setHighlightedSku(newHighlighted.post(apiUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-dataSku);
    if (newHighlightedSku && itemRefs.current[newHighlightedSku]) {
      itemRefs' },
      }).then(response => {
        const reader = new FileReader();
        reader.onload =.current[newHighlightedSku].scrollIntoView({ behavior: 'smooth', block: 'center' });
     (event) => {
          try {
            const data = new Uint8Array(event.target.result}
  }, [sortedShipmentData]);

  // handleExcelImport 函數 (保持不變，因為);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName上一個版本已經是正確的)
  const handleExcelImport = async (e) => {
    const file = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            //  = e.target.files[0];
    if (!file) return;

    const promise = new Promise建立前端的 getCellValue 函數
            const getCellValue = (cellAddress) => {
              const cell = worksheet[cell((resolve, reject) => {
      const formData = new FormData();
      formData.append('orderFile',Address];
              if (!cell || !cell.v) return '';
              const value = String(cell. file);

      const backendUrl = 'https://moztech-wms-api.onrender.com';v).trim();
              if (value.includes('：')) return value.split('：')[1].trim();
              if (value.includes(':')) return value.split(':')[1].trim();
              return value;
      const apiUrl = `${backendUrl}/api/orders/import`;

      axios.post(apiUrl, formData
            };

            // 解析訂單頭和品項
            const parsedOrderId = getCellValue('A2');, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(response => {
        const reader = new FileReader();
        reader.onload = (event) => {

            const parsedCustomerName = getCellValue('A3');
            const parsedWarehouse = getCellValue('A4          try {
            const data = new Uint8Array(event.target.result);
            const workbook =');
            const items = {};
            const jsonData = XLSX.utils.sheet_to_json(worksheet XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[, { header: 1, defval: "" });
            const headerIndex = jsonData.findIndex((row)0];
            const worksheet = workbook.Sheets[sheetName];
            
            const getCellValue = (cell => String(row[0]).includes('品項編碼'));
            if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位。");
            const detailRows = jsonData.Address) => {
                const cell = worksheet[cellAddress];
                if (!cell || !cell.v) return '';
                const value = String(cell.v).trim();
                if (value.includes('slice(headerIndex + 1);

            detailRows.forEach(row => {
              const productCodeValue：')) return value.split('：')[1].trim();
                if (value.includes(':')) return value = row[0];
              const quantityValue = row[2];
              if (!productCodeValue || .split(':')[1].trim();
                return value;
            };

            const parsedOrderId = getCellValue('!quantityValue) return;
              const productCode = String(productCodeValue).replace(/\s/g, '');A2');
            const parsedCustomerName = getCellValue('A3');
            const parsedWarehouse = getCellValue
              const quantity = parseInt(String(quantityValue), 10) || 0;
              if (('A4');
            
            const items = {};
            const jsonData = XLSX.utils.sheet_toquantity > 0) {
                if (items[productCode]) {
                  items[productCode].quantity += quantity;_json(worksheet, { header: 1, defval: "" });
            const headerIndex = jsonData
                } else {
                  items[productCode] = { sku: productCode, barcode: productCode,.findIndex((row) => String(row[0]) === '品項編碼');
            if (header itemName: String(row[1] || '').trim(), quantity: quantity };
                }
              }
            Index === -1) {
                return reject("找不到 '品項編碼' 欄位。請檢查});
            const parsedData = Object.values(items);
            
            // 更新所有相關的 state
            setShipExcel格式。");
            }
            const detailRows = jsonData.slice(headerIndex + 1);

mentData(parsedData);
            setScannedItems({});
            setConfirmedItems({});
            setOrderId(            detailRows.forEach(row => {
                const productCodeValue = row[0];
                const quantityparsedOrderId);
            setOrderHeader({ customerName: parsedCustomerName, warehouse: parsedWarehouse });
            setValue = row[2];
                if (!productCodeValue || !quantityValue) return;

                const productErrors([]);
            
            resolve(response.data.message);
          } catch (readErr) {
Code = String(productCodeValue).replace(/\s/g, '');
                const quantity = parseInt(String(quantityValue),            reject(readErr);
          }
        };
        reader.readAsArrayBuffer(file);
      }). 10) || 0;
                
                if (quantity > 0) {
                    if (catch(err => {
        const errorMessage = err.response?.data?.message || err.message || "發生items[productCode]) {
                        items[productCode].quantity += quantity;
                    } else {
                        未知錯誤";
        reject(errorMessage);
      });
    });
    
    toast.promise(promiseitems[productCode] = { sku: productCode, barcode: productCode, itemName: String(row[1] ||, {
      loading: '正在上傳並處理訂單...',
      success: (message) => `${ '').trim(), quantity: quantity };
                    }
                }
            });

            // ✨✨✨ 2. 更新 Reactmessage}`,
      error: (errorMessage) => `上傳失敗: ${errorMessage}`,
    });

    e state (關鍵修改) ✨✨✨
            setShipmentData(Object.values(items));
            setScannedItems.target.value = null;
  };
  
  // 其他所有函數 (handleLogout, handleExport({});
            setConfirmedItems({});
            setOrderId(parsedOrderId);
            setOrderHeader({ customerName: parsedCustomerName, warehouse: parsedWarehouse });
            setErrors([]);
            resolve(response.data.message);
Report 等)
  const handleLogout = () => { localStorage.clear(); onLogout(); };
  const handleExportReport = () => { /* ... 保持不變 ... */ };
  const handleQuantityChange = (sku          } catch (readError) {
             reject(`前端解析檔案時發生錯誤: ${readError.message}`);
          , type, amount) => { /* ... 保持不變 ... */ };
  const triggerFlash = (sku}
        };
        reader.readAsArrayBuffer(file);
        
      }).catch(err => {, type) => { /* ... 保持不變 ... */ };
  const playSound = (type) =>
        console.error("檔案上傳失敗", err);
        const errorMessage = err.response?.data?.message || err { /* ... 保持不變 ... */ };
  const handleError = (errorData) => { /* ... .message || "發生未知錯誤";
        reject(errorMessage);
      });
    });
    
    保持不變 ... */ };
  const handleScan = () => { /* ... 保持不變 ... */ };toast.promise(promise, {
      loading: '正在上傳並處理訂單...',
      success: (message
  const handleKeyDown = (e) => { /* ... 保持不變 ... */ };
  const handleClick) => `${message}`,
      error: (errorMessage) => `上傳失敗: ${errorMessage}`,
    });

    e = () => { /* ... 保持不變 ... */ };
  const roleInfo = { picker: { name:.target.value = null;
  };
  
  // 其他所有函數保持不變...
  // ... ( '揀貨', icon: <Package /> }, packer: { name: '裝箱', icon: <PackageCheck /> },省略 handleLogout, handleExportReport 等)

  // 渲染 JSX
  return (
    <div className="p- admin: { name: '管理', icon: <PackageCheck /> }, };

  // 渲染 JSX
  return (4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div><h1 className sm:items-center mb-8">
        {/* ... 省略 header 內容 */}
      </header>
="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user      <ProgressDashboard stats={progressStats} onExport={() => {}} />
      <div className="grid grid-.role]?.icon || <Package size={32} />}<span>作業面板</span></h1><p className="text-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-gray-500 mt-1">操作員: {user.name} ({user.role})</pspan-1 space-y-6">
          <div className="bg-white p-6 rounded-xl></div>
        <button onClick={handleLogout} className="mt-4 sm:mt-0 flex items- shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg- flex items-center"><FileUp className="mr-2"/>1. 匯入出貨單</h2><input type="gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm text
      </header>
      <ProgressDashboard stats={progressStats} onExport={handleExportReport} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        -gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-semibold file:bg-blue-50 file:text-<div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-blue-700 hover:file:bg-blue-100" /></div>
          <div className="bggray-700 mb-4 flex items-center"><FileUp className="mr-2"/>1. 匯入-white p-6 rounded-xl shadow-md">{/* ... 省略掃描區 ... */}</div>
        </div>
        出貨單</h2><input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-<div className="lg:col-span-2">
          <div className="bg-white p-6full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file rounded-xl shadow-md min-h-full">
            
            {/* ✨✨✨ 3. 修改:rounded-lg file:border-0 file:font-semibold file:bg-blue-50 file:text-blue這一區塊來顯示新資訊 ✨✨✨ */}
            <div className="mb-4">
              <h2-700 hover:file:bg-blue-100" /></div>
          <div className="bg-white className="text-xl font-semibold text-gray-700">作業清單 ({orderId})</h2>
               p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-{orderHeader && (
                <div className="flex items-center gap-4 text-sm text-gray-6700 mb-4 flex items-center"><ScanLine className="mr-2"/>2. 掃描00 mt-2 border-t pt-3">
                    <span className="flex items-center gap-區</h2><div className="flex gap-2"><input ref={barcodeInputRef} type="text" placeholder="1.5"><User size={14} /> 客戶: <strong className="text-gray-800">{order掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.targetHeader.customerName}</strong></span>
                    <span className="flex items-center gap-1.5"><Building.value)} onKeyDown={handleKeyDown} className="w-full px-4 py-2 border rounded-lg size={14} /> 倉庫: <strong className="text-gray-800">{orderHeader.warehouse}" disabled={shipmentData.length === 0} /><button onClick={handleClick} className="px-5 py</strong></span>
                </div>
              )}
            </div>
            
            {sortedShipmentData.length > 0-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue- ? (
              <div className="space-y-3">
                {sortedShipmentData.map((item)700 disabled:bg-gray-300" disabled={shipmentData.length === 0}> => {
                  const pickedQty = scannedItems[item.sku] || 0;
                  const packedQty =確認</button></div></div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
 confirmedItems[item.sku] || 0;
                  const status = getItemStatus(item, pickedQty, packed            {/* ✨ 3. 修改這裡來顯示客戶和倉庫 ✨ */}
            <div className="mb-Qty);
                  return (
                    <div key={item.sku} /* ... attributes ... */>
                      <div4">
              <h2 className="text-xl font-semibold text-gray-700">作業 className="flex items-center gap-4 flex-1"><div title={status.label}><status.Icon size={清單 ({orderId})</h2>
              {orderHeader && (
                <p className="text-sm text-28} className={status.color}/></div><div><p className="font-semibold text-gray-800">{itemgray-500 mt-1">
                  客戶: <span className="font-semibold text-gray-.itemName}</p><p className="text-sm text-gray-500 font-mono">{item.600">{orderHeader.customerName}</span> | 倉庫: <span className="font-semibold text-barcode}</p></div></div>
                      <div className="w-full sm:w-auto flex items-center justifygray-600">{orderHeader.warehouse}</span>
                </p>
              )}
            </div>
-end">
                         <div className="text-center font-mono text-lg">{packedQty} / {item.quantity            {sortedShipmentData.length > 0 ? (
              <div className="space-y-3">}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : ( <div
                {sortedShipmentData.map((item) => {
                  const pickedQty = scannedItems[item. className="text-center py-16 text-gray-500"><p>請先從左側sku] || 0;
                  const packedQty = confirmedItems[item.sku] || 0;
匯入出貨單以開始作業。</p></div> )}
          </div>
        </div>
      </div>
      {/*                   const status = getItemStatus(item, pickedQty, packedQty);
                  const isCompleted = packedQty >= item.錯誤紀錄區塊 - 保持不變 */}
      {/* ... */}
    </div>
  );
}quantity;
                  const animationClass = flash.sku === item.sku ? (flash.type === 'green' ? 'animate-flash-green' : 'animate-flash-yellow') : '';
                  const highlightClass =