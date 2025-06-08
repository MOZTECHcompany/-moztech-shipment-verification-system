// src/components/Dashboard.jsx
import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle } from 'lucide-react';

// 小幫手函式：根據狀態返回圖示和顏色
const getItemStatus = (item, pickedQty, packedQty) => {
    const expectedQty = item.quantity;
    if (packedQty >= expectedQty) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" };
    if (pickedQty >= expectedQty) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" };
    if (pickedQty > 0 || packedQty > 0) return { Icon: Loader2, color: "text-yellow-500 animate-spin", label: "處理中" };
    return { Icon: Circle, color: "text-gray-400", label: "待處理" };
};

// 小幫手元件：進度條
const ProgressBar = ({ value, max, colorClass }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return (
        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
            <div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div>
        </div>
    );
};

export function Dashboard({ user, onLogout }) {
  const [shipmentData, setShipmentData] = useState([]);
  const [scannedItems, setScannedItems] = useState({});
  const [confirmedItems, setConfirmedItems] = useState({});
  const [errors, setErrors] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const barcodeInputRef = useRef(null);
  const [orderId, setOrderId] = useState("尚未匯入");
  const [flash, setFlash] = useState({ barcode: null, type: null });

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, [shipmentData]);
  
  useEffect(() => {
    if (errors.length > 0 && errors[0].isNew) {
      const timer = setTimeout(() => {
        setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [errors]);

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
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false }); 
        
        const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼'));
        const parsedOrderId = orderIdRow ? String(row[0]).replace('憑證號碼 :', '').trim() : 'N/A';
        setOrderId(parsedOrderId);
        
        const headerIndex = jsonData.findIndex((row) => row[0] === '品項編碼');
        if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位，請檢查 Excel 格式。");
        
        const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]);
        const parsed = detailRows.map((row) => ({
          orderId: parsedOrderId,
          itemName: String(row[1]),
          sku: String(row[0]),
          barcode: String(row[0]),
          quantity: Number(row[2])
        }));

        setShipmentData(parsed);
        setScannedItems({});
        setConfirmedItems({});
        setErrors([]);
        toast.success("匯入成功", { description: `貨單 ${parsedOrderId} 已載入，共 ${parsed.length} 種品項。` });
      } catch (err) {
        toast.error("Excel 匯入失敗", { description: err.message });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };

  const triggerFlash = (barcode, type) => {
    setFlash({ barcode, type });
    setTimeout(() => setFlash({ barcode: null, type: null }), 700);
  };

  const handleScan = () => {
    // 【已修正】使用正規表示式，移除所有空白字元（包括空格、換行、tab等）
    const cleanedBarcode = barcodeInput.replace(/\s/g, '');

    if (!cleanedBarcode) {
      setBarcodeInput('');
      return;
    }
    
    setBarcodeInput('');
    barcodeInputRef.current?.focus();

    // 【已修正】在比較時，也對資料庫中的條碼做同樣的清理
    const item = shipmentData.find(
      (i) => String(i.barcode).replace(/\s/g, '') === cleanedBarcode
    );

    if (!item) {
      const newError = { type: '未知條碼', barcode: barcodeInput.trim(), time: new Date().toLocaleString(), user: user.name, role: user.role, isNew: true };
      setErrors((prev) => [newError, ...prev]);
      toast.error("掃描錯誤: 未知條碼", { description: `條碼 "${barcodeInput.trim()}" 不在貨單上。` });
      return;
    }

    if (user.role === 'picker') {
      const currentQty = scannedItems[item.barcode] || 0;
      if (currentQty >= item.quantity) {
        const newError = { type: '揀貨超量', barcode: item.barcode, itemName: item.itemName, time: new Date().toLocaleString(), user: user.name, role: user.role, isNew: true };
        setErrors((prev) => [newError, ...prev]);
        triggerFlash(item.barcode, 'yellow');
        toast.warning("數量警告: 揀貨超量", { description: `${item.itemName} 已達預期數量 ${item.quantity}。` });
      } else {
        const newQty = currentQty + 1;
        setScannedItems((prev) => ({ ...prev, [item.barcode]: newQty }));
        triggerFlash(item.barcode, 'green');
        toast.success(`揀貨成功: ${item.itemName}`, { description: `數量: ${newQty} / ${item.quantity}` });
      }
    } else if (user.role === 'packer') {
      const pickedQty = scannedItems[item.barcode] || 0;
      if(pickedQty === 0) {
        const newError = { type: '錯誤流程', barcode: item.barcode, itemName: item.itemName, time: new Date().toLocaleString(), user: user.name, role: user.role, isNew: true };
        setErrors((prev) => [newError, ...prev]);
        toast.error("流程錯誤: 請先揀貨", { description: `${item.itemName} 尚未被揀貨，無法裝箱。` });
        return;
      }
      const confirmedQty = confirmedItems[item.barcode] || 0;
      if (confirmedQty >= pickedQty) {
        const newError = { type: '裝箱超量(>揀貨)', barcode: item.barcode, itemName: item.itemName, time: new Date().toLocaleString(), user: user.name, role: user.role, isNew: true };
        setErrors((prev) => [newError, ...prev]);
        triggerFlash(item.barcode, 'yellow');
        toast.warning("數量警告: 裝箱超量", { description: `裝箱數已達揀貨數 ${pickedQty}。` });
      } else {
        const newQty = confirmedQty + 1;
        setConfirmedItems((prev) => ({ ...prev, [item.barcode]: newQty }));
        triggerFlash(item.barcode, 'green');
        toast.success(`裝箱成功: ${item.itemName}`, { description: `數量: ${newQty} / ${item.quantity}` });
      }
    }
  };


  const roleInfo = {
    picker: { name: '揀貨', icon: <Package className="inline-block" /> },
    packer: { name: '裝箱', icon: <PackageCheck className="inline-block" /> },
    admin: { name: '管理', icon: <PackageCheck className="inline-block" /> },
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
            {roleInfo[user.role]?.icon || <Package size={32} />}
            <span>{roleInfo[user.role]?.name || user.role}作業</span>
          </h1>
          <p className="text-gray-500 mt-1">操作員: {user.name} ({user.id})</p>
        </div>
        <button onClick={onLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
          <LogOut className="mr-2 h-4 w-4" /> 登出
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2"/>1. 匯入出貨單</h2>
            <input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
          </div>

          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>2. 掃描區</h2>
            <div className="flex gap-2">
              <input ref={barcodeInputRef} type="text" placeholder="掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow" disabled={shipmentData.length === 0} />
              <button onClick={handleScan} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors" disabled={shipmentData.length === 0}>確認</button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">作業清單</h2>
            {shipmentData.length > 0 ? (
              <div className="space-y-3">
                {shipmentData.map((item) => {
                  const pickedQty = scannedItems[item.barcode] || 0;
                  const packedQty = confirmedItems[item.barcode] || 0;
                  const status = getItemStatus(item, pickedQty, packedQty);
                  
                  const animationClass = flash.barcode === item.barcode
                    ? (flash.type === 'green' ? 'animate-flash-green' : 'animate-flash-yellow')
                    : '';

                  return (
                    <div key={item.barcode} className={`border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all hover:shadow-lg hover:border-blue-300 ${animationClass}`}>
                      <div className="flex items-center gap-4">
                        <div title={status.label}><status.Icon size={28} className={status.color}/></div>
                        <div>
                          <p className="font-semibold text-gray-800">{item.itemName}</p>
                          <p className="text-sm text-gray-500 font-mono">{item.barcode}</p>
                        </div>
                      </div>
                      <div className="w-full sm:w-auto flex items-center gap-4">
                         <div className="w-28 text-center">
                            <span className="font-bold text-lg text-blue-600">{pickedQty}</span>
                            <span className="text-gray-500"> / {item.quantity}</span>
                            <ProgressBar value={pickedQty} max={item.quantity} colorClass="bg-blue-500" />
                         </div>
                         <div className="w-28 text-center">
                            <span className="font-bold text-lg text-green-600">{packedQty}</span>
                            <span className="text-gray-500"> / {item.quantity}</span>
                            <ProgressBar value={packedQty} max={item.quantity} colorClass="bg-green-500" />
                         </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 text-gray-500">
                <p>請先從左側匯入出貨單以開始作業。</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {errors.length > 0 && (
        <div className="mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200">
          <h2 className="text-xl font-semibold text-red-700 mb-4 flex items-center gap-2"><AlertCircle /> 錯誤紀錄</h2>
          <ul className="space-y-2">
            {errors.map((err, index) => {
              const highlightClass = err.isNew ? 'bg-red-200' : 'bg-white';
              return (
                <li key={index} className={`flex items-center flex-wrap gap-x-4 gap-y-1 p-3 rounded-md transition-colors duration-1000 ${highlightClass}`}>
                  <span className="font-semibold text-red-600 w-36">{err.type}</span>
                  <span className="font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">{err.barcode}</span>
                  <span className="text-gray-600 flex-grow">{err.itemName || ''}</span>
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