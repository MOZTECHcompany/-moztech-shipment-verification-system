// src/components/Dashboard.jsx
import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { LogOut, Package, PackageCheck, AlertTriangle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, AlertCircle } from 'lucide-react';

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
        <div className="w-full bg-gray-200 rounded-full h-1.5 dark:bg-gray-700 mt-1">
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

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, [shipmentData]);

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      // ... (Excel 解析邏輯不變)
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼'));
      const parsedOrderId = orderIdRow ? String(orderIdRow[0]).replace('憑證號碼 :', '').trim() : 'N/A';
      setOrderId(parsedOrderId);
      const headerIndex = jsonData.findIndex((row) => row[0] === '品項編碼');
      const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]);
      const parsed = detailRows.map((row) => ({ orderId: parsedOrderId, itemName: row[1], sku: String(row[0]), barcode: String(row[0]), quantity: Number(row[2]) }));
      setShipmentData(parsed);
      setScannedItems({});
      setConfirmedItems({});
      setErrors([]);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null; // 允許再次上傳同一個檔案
  };

  const handleScan = () => {
    // ... (掃描邏輯不變)
    const trimmedBarcode = barcodeInput.trim();
    if (!trimmedBarcode) return;
    const item = shipmentData.find((i) => i.barcode === trimmedBarcode);
    if (!item) {
      setErrors((prev) => [{ type: '未知條碼', barcode: trimmedBarcode, time: new Date().toLocaleString(), user: user.id, role: user.role }, ...prev]);
    } else {
      if (user.role === 'picker') {
        const currentQty = scannedItems[trimmedBarcode] || 0;
        if (currentQty >= item.quantity) {
          setErrors((prev) => [{ type: '揀貨超量', barcode: trimmedBarcode, itemName: item.itemName, time: new Date().toLocaleString(), user: user.id, role: user.role }, ...prev]);
        } else {
          setScannedItems((prev) => ({ ...prev, [trimmedBarcode]: currentQty + 1 }));
        }
      } else if (user.role === 'packer') {
        const pickedQty = scannedItems[trimmedBarcode] || 0;
        const confirmedQty = confirmedItems[trimmedBarcode] || 0;
        if (confirmedQty >= pickedQty) {
          setErrors((prev) => [{ type: '裝箱超量(>揀貨)', barcode: trimmedBarcode, itemName: item.itemName, time: new Date().toLocaleString(), user: user.id, role: user.role }, ...prev]);
        } else {
          setConfirmedItems((prev) => ({ ...prev, [trimmedBarcode]: confirmedQty + 1 }));
        }
      }
    }
    setBarcodeInput('');
    barcodeInputRef.current?.focus();
  };

  const roleInfo = {
    picker: { name: '揀貨', icon: <Package className="inline-block" /> },
    packer: { name: '裝箱', icon: <PackageCheck className="inline-block" /> },
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
            {user.role === 'picker' ? <Package size={32} /> : <PackageCheck size={32} />}
            <span>{roleInfo[user.role].name}作業</span>
          </h1>
          <p className="text-gray-500 mt-1">操作員: {user.id} | 目前貨單: <span className="font-semibold text-gray-700">{orderId}</span></p>
        </div>
        <button onClick={onLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
          <LogOut className="mr-2 h-4 w-4" /> 登出
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左側控制面板 */}
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

        {/* 右側清單 */}
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">作業清單</h2>
            {shipmentData.length > 0 ? (
              <div className="space-y-3">
                {shipmentData.map((item) => {
                  const pickedQty = scannedItems[item.barcode] || 0;
                  const packedQty = confirmedItems[item.barcode] || 0;
                  const status = getItemStatus(item, pickedQty, packedQty);
                  return (
                    <div key={item.barcode} className="border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all hover:shadow-lg hover:border-blue-300">
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
              <div className="text-center py-16">
                <p className="text-gray-500">請先匯入出貨單以開始作業。</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200">
          <h2 className="text-xl font-semibold text-red-700 mb-4 flex items-center gap-2"><AlertCircle /> 錯誤紀錄</h2>
          <ul className="space-y-2">
            {errors.map((err, index) => (
              <li key={index} className="flex items-center gap-3 p-2 bg-white rounded-md">
                <span className="font-semibold text-red-600 w-36">{err.type}</span>
                <span className="font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">{err.barcode}</span>
                <span className="text-gray-600 flex-grow">{err.itemName || ''}</span>
                <span className="text-sm text-gray-500">{err.time}</span>
                <span className="text-sm text-gray-500">{err.user} ({err.role})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}