// src/components/Dashboard.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks } from 'lucide-react';

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
  const isAllPacked = totalPackedQty >= totalQuantity && packedSkus >= totalSkus;
  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-8">
      <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr-2" />任務總覽</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-500">品項完成度</p>
          <p className="text-2xl font-bold text-gray-800">
            {packedSkus}<span className="text-lg font-normal text-gray-500">/{totalSkus}</span>
          </p>
        </div>
        <div className="bg-blue-50 p-4 rounded-lg">
          <p className="text-sm text-blue-700">總揀貨數</p>
          <p className="text-2xl font-bold text-blue-600">
            {totalPickedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span>
          </p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <p className="text-sm text-green-700">總裝箱數</p>
          <p className="text-2xl font-bold text-green-600">
            {totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span>
          </p>
        </div>
      </div>
      <div className="mt-4">
        {isAllPacked ? (
          <div className="flex items-center justify-center p-2 bg-green-100 text-green-700 rounded-lg">
            <CheckCircle2 className="mr-2" />
            <span className="font-semibold">恭喜！所有品項已完成裝箱！</span>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-1">整體進度</p>
            <ProgressBar value={totalPackedQty} max={totalQuantity} colorClass="bg-gradient-to-r from-green-400 to-emerald-500 h-2.5" />
          </>
        )}
      </div>
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
  const [flash, setFlash] = useState({ sku: null, type: null });

  // 【升級新增】1. 狀態管理：記錄高亮的 SKU
  const [highlightedSku, setHighlightedSku] = useState(null);
  const itemRefs = useRef({});

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, [shipmentData]);

  // 【升級新增】2. DOM 操作：當高亮 SKU 改變時，自動滾動到該項目
  useEffect(() => {
    if (highlightedSku && itemRefs.current[highlightedSku]) {
      itemRefs.current[highlightedSku].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightedSku]);
  
  useEffect(() => {
    if (errors.length > 0 && errors[0].isNew) {
      const timer = setTimeout(() => {
        setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [errors]);
  
  const progressStats = useMemo(() => {
    const totalSkus = shipmentData.length;
    const totalQuantity = shipmentData.reduce((sum, item) => sum + item.quantity, 0);
    const packedSkus = shipmentData.filter(item => (confirmedItems[item.sku] || 0) >= item.quantity).length;
    const totalPickedQty = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0);
    const totalPackedQty = Object.values(confirmedItems).reduce((sum, qty) => sum + qty, 0);
    return { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty };
  }, [shipmentData, scannedItems, confirmedItems]);

  // 【升級新增】3. 列表排序邏輯：將已完成的項目置底
  const sortedShipmentData = useMemo(() => {
    const isItemComplete = (item) => (confirmedItems[item.sku] || 0) >= item.quantity;
    
    // 如果沒有貨單，返回空陣列
    if (!shipmentData.length) return [];
    
    // 排序：未完成的在前，已完成的在後
    const sorted = [...shipmentData].sort((a, b) => {
        return isItemComplete(a) - isItemComplete(b);
    });

    // 在頁面載入後自動高亮第一個未完成的項目
    const firstUnfinished = sorted.find(item => !isItemComplete(item));
    if (firstUnfinished) {
      setHighlightedSku(firstUnfinished.sku);
    } else {
      setHighlightedSku(null); // 如果全部完成，取消高亮
    }
    return sorted;
  }, [shipmentData, confirmedItems]);

  const handleExcelImport = (e) => {
    // ... 此函式內容完全不變 ...
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
        setOrderId(parsedOrderId);
        
        const headerIndex = jsonData.findIndex((row) => String(row[0]) === '品項編碼');
        if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位。請檢查Excel格式。");
        
        const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]);
        
        const parsed = detailRows.map((row) => ({
          orderId: parsedOrderId,
          itemName: String(row[1]),
          sku: String(row[0]),
          barcode: String(row[0]),
          quantity: Number(row[2])
        }));

        if (parsed.length === 0) { throw new Error("Excel 中沒有找到有效的品項資料。"); }

        setShipmentData(parsed);
        setScannedItems({});
        setConfirmedItems({});
        setErrors([]);
        toast.success("匯入成功", { description: `貨單 ${parsedOrderId} 已載入。` });
        console.log("解析後的出貨單資料:", parsed);
      } catch (err) {
        toast.error("Excel 匯入失敗", { description: err.message });
        console.error("捕獲到 Excel 匯入錯誤:", err);
        setShipmentData([]);
        setOrderId("尚未匯入");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = null;
  };

  const triggerFlash = (sku, type) => {
    setFlash({ sku, type });
    setTimeout(() => setFlash({ sku: null, type: null }), 700);
  };
  
  // 【升級修改】掃描成功後，加入智慧聚焦邏輯
  const handleScanSuccess = (scannedItem) => {
      const isComplete = (item, newConfirmedItems) => (newConfirmedItems[item.sku] || 0) >= item.quantity;
      const justCompleted = isComplete(scannedItem, confirmedItems);
  
      if (justCompleted) {
        // 找到下一個未完成的項目
        const nextUnfinishedItem = sortedShipmentData.find(item => item.sku !== scannedItem.sku && !isComplete(item, confirmedItems));
        
        if (nextUnfinishedItem) {
          setHighlightedSku(nextUnfinishedItem.sku);
        } else {
          // 所有項目都完成了
          setHighlightedSku(null); 
          toast.success("恭喜！所有品項已完成！");
        }
      } else {
        // 如果當前項目還未完成，保持高亮
        setHighlightedSku(scannedItem.sku);
      }
  };


  const handleScan = () => {
    // ... 此函式大部分不變，只在成功時調用 handleScanSuccess ...
    const normalizedInput = normalizeString(barcodeInput);
    if (!normalizedInput) {
      setBarcodeInput('');
      return;
    }
    setBarcodeInput('');
    barcodeInputRef.current?.focus();

    const item = shipmentData.find((i) => normalizeString(i.barcode) === normalizedInput);

    if (!item) {
      const newError = { type: '未知條碼', barcode: barcodeInput.trim(), time: new Date().toLocaleString(), user: user.name, role: user.role, isNew: true };
      setErrors((prev) => [newError, ...prev]);
      toast.error("掃描錯誤: 未知條碼", { description: `條碼 "${barcodeInput.trim()}" 不在貨單上。` });
      return;
    }

    const itemSku = item.sku;
    
    // 成功的回呼，用於統一處理智慧聚焦
    let scanSuccess = false; 

    if (user.role === 'admin') {
      const currentPacked = confirmedItems[itemSku] || 0;
      if (currentPacked >= item.quantity) {
        toast.warning("數量警告: 該品項已完成", { description: `${item.itemName} 已達應出貨數量。` });
        triggerFlash(itemSku, 'yellow');
      } else {
        const newQty = currentPacked + 1;
        setScannedItems((prev) => ({ ...prev, [itemSku]: newQty }));
        setConfirmedItems((prev) => ({ ...prev, [itemSku]: newQty }));
        toast.success(`管理員操作: ${item.itemName}`, { description: `數量: ${newQty}/${item.quantity}` });
        triggerFlash(itemSku, 'green');
        scanSuccess = true;
      }
    } else if (user.role === 'picker') {
        const currentQty = scannedItems[itemSku] || 0;
        if (currentQty >= item.quantity) {
             toast.warning("數量警告: 揀貨超量", { description: `${item.itemName} 已達預期。` });
             triggerFlash(itemSku, 'yellow');
        } else {
            const newQty = currentQty + 1;
            setScannedItems((prev) => ({ ...prev, [itemSku]: newQty }));
            triggerFlash(itemSku, 'green');
            toast.success(`揀貨成功: ${item.itemName}`, { description: `數量: ${newQty}/${item.quantity}` });
            scanSuccess = true;
        }
    } else if (user.role === 'packer') {
      const pickedQty = scannedItems[itemSku] || 0;
      const confirmedQty = confirmedItems[itemSku] || 0;
      if (pickedQty === 0) { 
        toast.error("流程錯誤: 請先揀貨", { description: `${item.itemName} 尚未揀貨。` });
      } else if (confirmedQty >= pickedQty) {
        toast.warning("數量警告: 裝箱超量", { description: `裝箱數已達揀貨數。` });
        triggerFlash(itemSku, 'yellow');
      } else {
        const newQty = confirmedQty + 1;
        setConfirmedItems((prev) => ({ ...prev, [itemSku]: newQty }));
        triggerFlash(itemSku, 'green');
        toast.success(`裝箱成功: ${item.itemName}`, { description: `數量: ${newQty}/${item.quantity}` });
        scanSuccess = true;
      }
    }
    
    if (scanSuccess) {
        handleScanSuccess(item);
    }
  };
  
  const roleInfo = {
    picker: { name: '揀貨', icon: <Package /> },
    packer: { name: '裝箱', icon: <PackageCheck /> },
    admin: { name: '管理', icon: <PackageCheck /> },
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
        <button onClick={onLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
          <LogOut className="mr-2 h-4 w-4" /> 登出
        </button>
      </header>
      
      <ProgressDashboard stats={progressStats} />
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2"/>1. 匯入出貨單</h2>
            <input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>2. 掃描區</h2>
            <div className="flex gap-2">
              <input ref={barcodeInputRef} type="text" placeholder="掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleScan()} className="w-full px-4 py-2 border rounded-lg" disabled={shipmentData.length === 0} />
              <button onClick={handleScan} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300" disabled={shipmentData.length === 0}>確認</button>
            </div>
          </div>
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
                  const highlightClass = highlightedSku === item.sku ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-white';
                  const completedClass = isCompleted ? 'opacity-50 hover:opacity-100' : '';
                  
                  return (
                    <div 
                      key={item.sku}
                      ref={el => itemRefs.current[item.sku] = el}
                      className={`border rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-all hover:shadow-lg ${animationClass} ${highlightClass} ${completedClass}`}
                    >
                      <div className="flex items-center gap-4">
                        <div title={status.label}><status.Icon size={28} className={status.color}/></div>
                        <div>
                          <p className="font-semibold text-gray-800">{item.itemName}</p>
                          <p className="text-sm text-gray-500 font-mono">{item.barcode}</p>
                        </div>
                      </div>
                      <div className="w-full sm:w-auto flex items-center gap-4">
                         <div className="w-28 text-center">
                            <span className="font-bold text-lg text-blue-600">{pickedQty}</span><span className="text-gray-500">/{item.quantity}</span>
                            <ProgressBar value={pickedQty} max={item.quantity} colorClass="bg-blue-500" />
                         </div>
                         <div className="w-28 text-center">
                            <span className="font-bold text-lg text-green-600">{packedQty}</span><span className="text-gray-500">/{item.quantity}</span>
                            <ProgressBar value={packedQty} max={item.quantity} colorClass="bg-green-500" />
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
      {errors.length > 0 && (
        <div className="mt-8 bg-red-50 p-6 rounded-xl shadow-md border border-red-200">
          <h2 className="text-xl font-semibold text-red-700 mb-4 flex items-center gap-2"><AlertCircle /> 錯誤紀錄</h2>
          {/* ... 錯誤紀錄列表 ... */}
        </div>
      )}
    </div>
  );
}