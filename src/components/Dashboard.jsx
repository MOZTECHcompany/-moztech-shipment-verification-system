import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks, Minus, Plus } from 'lucide-react';
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
    return ( <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div></div> );
};
const normalizeString = (str) => {
  if (!str) return "";
  return String(str).replace(/[^a-zA-Z0-9]/g, '');
};

const QuantityButton = ({ onClick, icon: Icon, disabled }) => (
    <button onClick={onClick} disabled={disabled} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"><Icon size={16} /></button>
);

const ProgressDashboard = ({ stats, onExport }) => {
  const { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats;
  if (totalSkus === 0) return null;
  const isAllPacked = packedSkus >= totalSkus;
  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-8">
      <div className="flex justify-between items-start">
        <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr-2" />任務總覽</h2>
        <button onClick={onExport} className="flex items-center text-sm px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300" disabled={totalSkus === 0}><FileUp size={16} className="mr-1.5" />匯出報告</button>
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

export function Dashboard({ user, onLogout }) {
  const MySwal = withReactContent(Swal);
  const [shipmentData, setShipmentData] = useState(() => JSON.parse(localStorage.getItem('shipment_data')) || []);
  const [scannedItems, setScannedItems] = useState(() => JSON.parse(localStorage.getItem('scanned_items')) || {});
  const [confirmedItems, setConfirmedItems] = useState(() => JSON.parse(localStorage.getItem('confirmed_items')) || {});
  const [orderId, setOrderId] = useState(() => localStorage.getItem('order_id') || "尚未匯入");
  const [errors, setErrors] = useState(() => JSON.parse(localStorage.getItem('shipment_errors')) || []);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [flash, setFlash] = useState({ sku: null, type: null });
  const [errorAnimation, setErrorAnimation] = useState(false);
  const [highlightedSku, setHighlightedSku] = useState(null);
  const barcodeInputRef = useRef(null);
  const itemRefs = useRef({});

  useEffect(() => { localStorage.setItem('shipment_data', JSON.stringify(shipmentData)); }, [shipmentData]);
  useEffect(() => { localStorage.setItem('scanned_items', JSON.stringify(scannedItems)); }, [scannedItems]);
  useEffect(() => { localStorage.setItem('confirmed_items', JSON.stringify(confirmedItems)); }, [confirmedItems]);
  useEffect(() => { localStorage.setItem('order_id', orderId); }, [orderId]);
  useEffect(() => { localStorage.setItem('shipment_errors', JSON.stringify(errors)); }, [errors]);
  useEffect(() => { barcodeInputRef.current?.focus(); }, [shipmentData]);
  useEffect(() => { if (errors.length > 0 && errors[0]?.isNew) { setErrorAnimation(true); const animationTimer = setTimeout(() => setErrorAnimation(false), 1000); const highlightTimer = setTimeout(() => { setErrors(currentErrors => currentErrors.map((e, i) => i === 0 ? { ...e, isNew: false } : e)); }, 2000); return () => { clearTimeout(animationTimer); clearTimeout(highlightTimer); }; } }, [errors]);
  const progressStats = useMemo(() => { const totalSkus = shipmentData.length; const totalQuantity = shipmentData.reduce((sum, item) => sum + item.quantity, 0); const packedSkus = shipmentData.filter(item => (confirmedItems[item.sku] || 0) >= item.quantity).length; const totalPickedQty = Object.values(scannedItems).reduce((sum, qty) => sum + qty, 0); const totalPackedQty = Object.values(confirmedItems).reduce((sum, qty) => sum + qty, 0); return { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty }; }, [shipmentData, scannedItems, confirmedItems]);
  const sortedShipmentData = useMemo(() => { if (!shipmentData.length) return []; const isItemComplete = (item) => (confirmedItems[item.sku] || 0) >= item.quantity; return [...shipmentData].sort((a, b) => isItemComplete(a) - isItemComplete(b)); }, [shipmentData, confirmedItems]);
  useEffect(() => { const firstUnfinished = sortedShipmentData.find(item => (confirmedItems[item.sku] || 0) < item.quantity); const newHighlightedSku = firstUnfinished ? firstUnfinished.sku : null; setHighlightedSku(newHighlightedSku); if (newHighlightedSku && itemRefs.current[newHighlightedSku]) { itemRefs.current[newHighlightedSku].scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, [sortedShipmentData]);
  const handleExcelImport = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { try { const data = new Uint8Array(event.target.result); const workbook = XLSX.read(data, { type: 'array' }); const sheetName = workbook.SheetNames[0]; const worksheet = workbook.Sheets[sheetName]; const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }); const orderIdRow = jsonData.find((row) => String(row[0]).includes('憑證號碼')); const parsedOrderId = orderIdRow ? String(row[0]).replace('憑證號碼 :', '').trim() : 'N/A'; const headerIndex = jsonData.findIndex((row) => String(row[0]) === '品項編碼'); if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位。"); const detailRows = jsonData.slice(headerIndex + 1).filter((row) => row[0] && row[1] && row[2]); const parsed = detailRows.map((row) => ({ orderId: parsedOrderId, itemName: String(row[1]), sku: String(row[0]), barcode: String(row[0]), quantity: Number(row[2]) })); if (parsed.length === 0) throw new Error("Excel 中沒有找到有效的品項資料。"); setShipmentData(parsed); setScannedItems({}); setConfirmedItems({}); setOrderId(parsedOrderId); setErrors([]); toast.success("匯入成功", { description: `貨單 ${parsedOrderId} 已載入。` }); } catch (err) { MySwal.fire({ icon: 'error', title: 'Excel 匯入失敗', text: err.message }); } }; reader.readAsArrayBuffer(file); e.target.value = null; };
  const handleExportReport = () => { /* ... */ };
  const handleQuantityChange = (sku, type, amount) => { /* ... */ };
  const triggerFlash = (sku, type) => { /* ... */ };
  const playSound = (type) => { /* ... */ };
  const handleError = (errorData) => { /* ... */ };
  const handleScan = () => { /* ... */ };
  const handleKeyDown = (e) => { if (e.key === 'Enter' && barcodeInput.trim() !== '') { e.preventDefault(); handleScan(); } };
  const handleClick = () => { if (barcodeInput.trim() !== '') { handleScan(); } };
  const roleInfo = { picker: { name: '揀貨', icon: <Package /> }, packer: { name: '裝箱', icon: <PackageCheck /> }, admin: { name: '管理', icon: <PackageCheck /> }, };
  
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user.role]?.icon || <Package size={32} />}<span>{roleInfo[user.role]?.name || user.role}作業</span></h1><p className="text-gray-500 mt-1">操作員: {user.name} ({user.id})</p></div>
        <button onClick={onLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
      </header>
      <ProgressDashboard stats={progressStats} onExport={handleExportReport} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">{/* ... */}</div>
      {errors.length > 0 && ( <div className={`mt-8 ...`}>{/* ... */}</div> )}
    </div>
  );
}