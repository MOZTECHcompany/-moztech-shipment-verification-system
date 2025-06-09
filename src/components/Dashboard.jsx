// src/components/Dashboard.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import apiClient from '../api/api.js'; // ✨ 1. 引入 apiClient
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks, Minus, Plus, Building, User } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const getItemStatus = (item, pickedQty, packedQty) => { const expectedQty = item.quantity; if (packedQty >= expectedQty) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" }; if (pickedQty >= expectedQty) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" }; if (pickedQty > 0 || packedQty > 0) return { Icon: Loader2, color: "text-yellow-500 animate-spin", label: "處理中" }; return { Icon: Circle, color: "text-gray-400", label: "待處理" }; };
const ProgressBar = ({ value, max, colorClass }) => { const percentage = max > 0 ? (value / max) * 100 : 0; return ( <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div></div> ); };
const normalizeString = (str) => { if (!str) return ""; return String(str).replace(/[^a-zA-Z0-9]/g, ''); };
const QuantityButton = ({ onClick, icon: Icon, disabled }) => ( <button onClick={onClick} disabled={disabled} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"><Icon size={16} /></button> );
const ProgressDashboard = ({ stats, onExport, onVoid, user }) => { const { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats; if (totalSkus === 0) return null; const isAllPacked = packedSkus >= totalSkus; return ( <div className="bg-white p-6 rounded-xl shadow-md mb-8"><div className="flex justify-between items-start gap-4"><h2 className="text-xl font-semibold text-gray-700 flex items-center"><ListChecks className="mr-2" />任務總覽</h2><div className="flex gap-2">{user.role === 'admin' && <button onClick={onVoid} className="flex items-center text-sm px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300" disabled={totalSkus === 0}>作廢訂單</button>}<button onClick={onExport} className="flex items-center text-sm px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300" disabled={totalSkus === 0}><FileUp size={16} className="mr-1.5" />匯出報告</button></div></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center mt-4"><div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm text-gray-500">品項完成度</p><p className="text-2xl font-bold text-gray-800">{packedSkus}<span className="text-lg font-normal text-gray-500">/{totalSkus}</span></p></div><div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-700">總揀貨數</p><p className="text-2xl font-bold text-blue-600">{totalPickedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div><div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-green-700">總裝箱數</p><p className="text-2xl font-bold text-green-600">{totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div></div><div className="mt-4">{isAllPacked ? ( <div className="flex items-center justify-center p-2 bg-green-100 text-green-700 rounded-lg"><CheckCircle2 className="mr-2" /><span className="font-semibold">恭喜！所有品項已完成裝箱！</span></div> ) : ( <><p className="text-sm text-gray-600 mb-1">整體進度</p><ProgressBar value={totalPackedQty} max={totalQuantity} colorClass="bg-gradient-to-r from-green-400 to-emerald-500 h-2.5" /></> )}</div></div> ); };

export function Dashboard({ user, onLogout }) {
  const MySwal = withReactContent(Swal);
  const KEY_SHIPMENT = 'shipment_data';
  const KEY_SCANNED = 'scanned_items';
  const KEY_CONFIRMED = 'confirmed_items';
  const KEY_ORDER_ID = 'order_id';
  const KEY_ORDER_HEADER = 'order_header';
  const KEY_ERRORS = 'shipment_errors';
  const [shipmentData, setShipmentData] = useState(() => JSON.parse(localStorage.getItem(KEY_SHIPMENT)) || []);
  const [scannedItems, setScannedItems] = useState(() => JSON.parse(localStorage.getItem(KEY_SCanned)) || {});
  const [confirmedItems, setConfirmedItems] = useState(() => JSON.parse(localStorage.getItem(KEY_CONFIRMED)) || {});
  const [orderId, setOrderId] = useState(() => localStorage.getItem(KEY_ORDER_ID) || "尚未匯入");
  const [orderHeader, setOrderHeader] = useState(() => JSON.parse(localStorage.getItem(KEY_ORDER_HEADER)) || null);
  const [errors, setErrors] = useState(() => JSON.parse(localStorage.getItem(KEY_ERRORS)) || []);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [flash, setFlash] = useState({ sku: null, type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlightedSku, setHighlightedSku] = useState(null);
  const barcodeInputRef = useRef(null);
  const itemRefs = useRef({});
  useEffect(() => { localStorage.setItem(KEY_SHIPMENT, JSON.stringify(shipmentData)); }, [shipmentData]);
  useEffect(() => { localStorage.setItem(KEY_SCANNED, JSON.stringify(scannedItems)); }, [scannedItems]);
  useEffect(() => { localStorage.setItem(KEY_CONFIRMED, JSON.stringify(confirmedItems)); }, [confirmedItems]);
  useEffect(() => { localStorage.setItem(KEY_ORDER_ID, orderId); }, [orderId]);
  useEffect(() => { localStorage.setItem(KEY_ORDER_HEADER, JSON.stringify(orderHeader)); }, [orderHeader]);
  useEffect(() => { localStorage.setItem(KEY_ERRORS, JSON.stringify(errors)); }, [errors]);
  useEffect(() => { barcodeInputRef.current?.focus(); }, [shipmentData]);
  useEffect(() => { if (errors.length > 0 && errors[0]?.isNew) { setErrorAnimation(true); const animationTimer = setTimeout(() => setErrorAnimation(false), 1000); const highlightTimer = setTimeout(() => { setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e)); }, 2000); return () => { clearTimeout(animationTimer); clearTimeout(highlightTimer); }; } }, [errors]);
  const progressStats = useMemo(() => { const totalSkus = shipmentData.length; const totalQuantity = shipmentData.reduce((sum, item) => sum + item.quantity, 0); const packedSkus = shipmentData.filter(item => (confirmedItems[item.sku] || 0) >= item.quantity).length; const totalPickedQty = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0); const totalPackedQty = Object.values(confirmedItems).reduce((sum, qty) => sum + qty, 0); return { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty }; }, [shipmentData, scannedItems, confirmedItems]);
  const sortedShipmentData = useMemo(() => { if (!shipmentData.length) return []; const isItemComplete = (item) => (confirmedItems[item.sku] || 0) >= item.quantity; return [...shipmentData].sort((a, b) => isItemComplete(a) - isItemComplete(b)); }, [shipmentData, confirmedItems]);
  useEffect(() => { const firstUnfinished = sortedShipmentData.find(item => (confirmedItems[item.sku] || 0) < item.quantity); const newHighlightedSku = firstUnfinished ? firstUnfinished.sku : null; setHighlightedSku(newHighlightedSku); if (newHighlightedSku && itemRefs.current[newHighlightedSku]) { itemRefs.current[newHighlightedSku].scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, [sortedShipmentData]);

  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const promise = new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('orderFile', file);
        
        // ✨ 2. 使用 apiClient 來取代 axios，它會自動攜帶 Token
        apiClient.post('/api/orders/import', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        }).then(response => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const getCellValue = (cellAddress) => { const cell = worksheet[cellAddress]; if (!cell || !cell.v) return ''; const value = String(cell.v).trim(); if (value.includes('：')) return value.split('：')[1].trim(); if (value.includes(':')) return value.split(':')[1].trim(); return value; };
                    const parsedOrderId = getCellValue('A2');
                    const parsedCustomerName = getCellValue('A3');
                    const parsedWarehouse = getCellValue('A4');
                    const items = {};
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                    const headerIndex = jsonData.findIndex((row) => String(row[0]).includes('品項編碼'));
                    if (headerIndex === -1) { return reject(new Error("找不到 '品項編碼' 欄位。")); }
                    const detailRows = jsonData.slice(headerIndex + 1);

                    detailRows.forEach(row => {
                      const productCodeValue = row[0]; const quantityValue = row[2];
                      if (!productCodeValue || !quantityValue) return;
                      const productCode = String(productCodeValue).replace(/\s/g, '');
                      const quantity = parseInt(String(quantityValue), 10) || 0;
                      if (quantity > 0) {
                        if (items[productCode]) { items[productCode].quantity += quantity; } 
                        else { items[productCode] = { sku: productCode, barcode: productCode, itemName: String(row[1] || '').trim(), quantity: quantity }; }
                      }
                    });
                    
                    setShipmentData(Object.values(items));
                    setScannedItems({});
                    setConfirmedItems({});
                    setOrderId(parsedOrderId);
                    setOrderHeader({ customerName: parsedCustomerName, warehouse: parsedWarehouse });
                    setErrors([]);
                    resolve(response.data.message);
                } catch (readErr) {
                    reject(`前端解析檔案時發生錯誤: ${readErr.message}`);
                }
            };
            reader.readAsArrayBuffer(file);
        }).catch(err => {
            const errorMessage = err.response?.data?.message || err.message || "發生未知錯誤";
            reject(errorMessage);
        });
    });
    
    toast.promise(promise, { loading: '正在上傳並處理訂單...', success: (message) => `${message}`, error: (errorMessage) => `上傳失敗: ${errorMessage}` });
    e.target.value = null;
  };
  
  const handleLogout = () => { localStorage.clear(); onLogout(); };
  const handleExportReport = () => { /* ... 保持不變 ... */ };
  const handleQuantityChange = (sku, type, amount) => { /* ... 保持不變 ... */ };
  const triggerFlash = (sku, type) => { setFlash({ sku, type }); setTimeout(() => setFlash({ sku: null, type: null }), 700); };
  const playSound = (type) => { /* ... 保持不變 ... */ };
  const handleError = (errorData) => { /* ... 保持不變 ... */ };
  const handleScan = () => { /* ... 保持不變 ... */ };
  const handleKeyDown = (e) => { if (e.key === 'Enter' && barcodeInput.trim() !== '') { e.preventDefault(); handleScan(); } };
  const handleClick = () => { if (barcodeInput.trim() !== '') { handleScan(); } };
  const roleInfo = { picker: { name: '揀貨', icon: <Package /> }, packer: { name: '裝箱', icon: <PackageCheck /> }, admin: { name: '管理', icon: <PackageCheck /> }, };
  
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user.role]?.icon || <Package size={32} />}<span>作業面板</span></h1><p className="text-gray-500 mt-1">操作員: {user.name} ({user.role})</p></div>
        <button onClick={handleLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
      </header>
      <ProgressDashboard stats={progressStats} onExport={handleExportReport} user={user} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2"/>1. 匯入出貨單</h2><input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" /></div>
          <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>2. 掃描區</h2><div className="flex gap-2"><input ref={barcodeInputRef} type="text" placeholder="掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={handleKeyDown} className="w-full px-4 py-2 border rounded-lg" disabled={shipmentData.length === 0} /><button onClick={handleClick} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300" disabled={shipmentData.length === 0}>確認</button></div></div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-700">作業清單 ({orderId})</h2>
              {orderHeader && (
                <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mt-2 border-t pt-3">
                    <span className="flex items-center gap-1.5"><User size={14} /> 客戶: <strong className="text-gray-800">{orderHeader.customerName}</strong></span>
                    <span className="flex items-center gap-1.5"><Building size={14} /> 倉庫: <strong className="text-gray-800">{orderHeader.warehouse}</strong></span>
                </div>
              )}
            </div>
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
                        <div className="flex items-center gap-1 w-36">
                            <QuantityButton icon={Minus} onClick={() => handleQuantityChange(item.sku, 'pick', -1)} disabled={!canAdjustPick || pickedQty <= 0} />
                            <div className="flex-1 text-center"><span className="font-bold text-lg text-blue-600">{pickedQty}</span><span className="text-gray-500">/{item.quantity}</span><ProgressBar value={pickedQty} max={item.quantity} colorClass="bg-blue-500" /></div>
                            <QuantityButton icon={Plus} onClick={() => handleQuantityChange(item.sku, 'pick', 1)} disabled={!canAdjustPick} />
                        </div>
                        <div className="flex items-center gap-1 w-36">
                            <QuantityButton icon={Minus} onClick={() => handleQuantityChange(item.sku, 'pack', -1)} disabled={!canAdjustPack || packedQty <= 0} />
                            <div className="flex-1 text-center"><span className="font-bold text-lg text-green-600">{packedQty}</span><span className="text-gray-500">/{item.quantity}</span><ProgressBar value={packedQty} max={item.quantity} colorClass="bg-green-500" /></div>
                            <QuantityButton icon={Plus} onClick={() => handleQuantityChange(item.sku, 'pack', 1)} disabled={!canAdjustPack} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : ( <div className="text-center py-16 text-gray-500"><p>請先從左側匯入出貨單以開始作業。</p></div> )}
          </div>
        </div>
      </div>
       {errors.length > 0 && ( <div className={`mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200 transition-all ${errorAnimation ? 'animate-shake animate-flash-red-border' : ''}`}><h2 className="text-xl font-semibold text-red-700 mb-4 flex items-center gap-2"><AlertCircle /> 錯誤紀錄</h2><ul className="space-y-2">{errors.map((err, index) => ( <li key={index} className={`flex items-center flex-wrap gap-x-4 gap-y-1 p-3 rounded-md transition-colors duration-1000 ${err.isNew ? 'bg-red-200' : 'bg-white'}`}><span className="font-semibold text-red-600 w-36">{err.type}</span><span className="font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">{err.barcode}</span><span className="text-gray-600 flex-grow">{err.itemName}</span><span className="text-sm text-gray-500">{err.time}</span><span className="text-sm text-gray-500">{err.user} ({err.role})</span></li> ))}</ul></div> )}
    </div>
  );
}