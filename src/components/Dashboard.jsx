// src/components/Dashboard.jsx
import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { LogOut, Package, PackageCheck, AlertTriangle } from 'lucide-react';

export function Dashboard({ user, onLogout }) {
  const [shipmentData, setShipmentData] = useState([]);
  const [scannedItems, setScannedItems] = useState({});
  const [confirmedItems, setConfirmedItems] = useState({});
  const [errors, setErrors] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const barcodeInputRef = useRef(null);

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, [shipmentData]);

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼'));
      const orderId = orderIdRow ? String(orderIdRow[0]).replace('憑證號碼 :', '').trim() : 'N/A';
      const headerIndex = jsonData.findIndex((row) => row[0] === '品項編碼');
      const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]);
      const parsed = detailRows.map((row) => ({
        orderId, itemName: row[1], sku: String(row[0]), barcode: String(row[0]), quantity: Number(row[2])
      }));
      setShipmentData(parsed);
      setScannedItems({});
      setConfirmedItems({});
      setErrors([]);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleScan = () => {
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
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex justify-between items-center mb-6 pb-4 border-b">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">{roleInfo[user.role].icon} {roleInfo[user.role].name}作業</h1>
          <p className="text-gray-500">操作員: {user.id}</p>
        </div>
        <button onClick={onLogout} className="flex items-center px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="p-4 border rounded-lg bg-white shadow-sm">
          <h2 className="font-bold mb-2">1. 匯入出貨單</h2>
          <input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
        </div>
        <div className="p-4 border rounded-lg bg-white shadow-sm md:col-span-2">
          <h2 className="font-bold mb-2">2. 掃描區</h2>
          <div className="flex gap-2">
            <input ref={barcodeInputRef} type="text" placeholder={`掃描條碼以${roleInfo[user.role].name}...`} value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} className="w-full px-4 py-2 border rounded-md" disabled={shipmentData.length === 0} />
            <button onClick={handleScan} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400" disabled={shipmentData.length === 0}>確認</button>
          </div>
        </div>
      </div>

      {shipmentData.length > 0 && (
        <div className="overflow-x-auto bg-white p-4 rounded-lg shadow-sm">
          <h2 className="text-xl font-bold mb-4">作業清單</h2>
          <table className="min-w-full border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="py-2 px-4 border text-left">品項</th>
                <th className="py-2 px-4 border text-left">條碼</th>
                <th className="py-2 px-4 border text-center">預期</th>
                <th className="py-2 px-4 border text-center">揀貨數</th>
                <th className="py-2 px-4 border text-center">裝箱數</th>
              </tr>
            </thead>
            <tbody>
              {shipmentData.map((item) => {
                const pickedQty = scannedItems[item.barcode] || 0;
                const packedQty = confirmedItems[item.barcode] || 0;
                const isPickComplete = pickedQty >= item.quantity;
                const isPackComplete = packedQty >= item.quantity;
                let rowClass = 'transition-colors duration-300';
                if (isPackComplete) rowClass += ' bg-green-100';
                else if (isPickComplete) rowClass += ' bg-blue-100';
                return (
                  <tr key={item.barcode} className={rowClass}>
                    <td className="py-2 px-4 border">{item.itemName}</td>
                    <td className="py-2 px-4 border font-mono">{item.barcode}</td>
                    <td className="py-2 px-4 border text-center font-bold">{item.quantity}</td>
                    <td className="py-2 px-4 border text-center font-bold text-blue-600">{pickedQty}</td>
                    <td className="py-2 px-4 border text-center font-bold text-green-600">{packedQty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-6 bg-white p-4 rounded-lg shadow-sm">
          <h2 className="text-xl font-bold text-red-600 mb-2 flex items-center gap-2"><AlertTriangle /> 錯誤紀錄</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-gray-100">
                <tr>
                  <th className="py-2 px-4 border text-left">類型</th>
                  <th className="py-2 px-4 border text-left">條碼</th>
                  <th className="py-2 px-4 border text-left">時間</th>
                  <th className="py-2 px-4 border text-left">人員(身份)</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((err, index) => (
                  <tr key={index} className="bg-red-50">
                    <td className="py-2 px-4 border text-red-500 font-semibold">{err.type}</td>
                    <td className="py-2 px-4 border font-mono">{err.barcode}</td>
                    <td className="py-2 px-4 border">{err.time}</td>
                    <td className="py-2 px-4 border">{err.user} ({err.role})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}