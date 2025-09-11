import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import apiClient from '../api/axios.js'; // 统一使用 axios.js
import { LogOut, Package, PackageCheck, AlertCircle, FileUp, ScanLine, CheckCircle2, Loader2, Circle, ListChecks, Minus, Plus, Building, User } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

// 辅助组件和函数 (无需修改)
const getItemStatus = (item) => {
    const { quantity, picked_quantity, packed_quantity } = item;
    if (packed_quantity >= quantity) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" };
    if (picked_quantity >= quantity) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" };
    if (picked_quantity > 0 || packed_quantity > 0) return { Icon: Loader2, color: "text-yellow-500 animate-spin", label: "處理中" };
    return { Icon: Circle, color: "text-gray-400", label: "待處理" };
};
const ProgressBar = ({ value, max, colorClass }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return ( <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div></div> );
};
const QuantityButton = ({ onClick, icon: Icon, disabled }) => (
    <button onClick={onClick} disabled={disabled} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors">
        <Icon size={16} />
    </button>
);

const ProgressDashboard = ({ stats, onExport, onVoid, user }) => {
    const { totalSkus, packedSkus, totalQuantity, totalPickedQty, totalPackedQty } = stats;
    // 修复 NaN 问题：在数据加载完成前显示 loading 状态
    if (typeof totalSkus !== 'number' || isNaN(totalSkus)) {
        return <div className="bg-white p-6 rounded-xl shadow-md mb-8">加载中...</div>;
    }
    if (totalSkus === 0) return null;
    return (
        <div className="bg-white p-6 rounded-xl shadow-md mb-8">
            <div className="flex justify-between items-start">
                 <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr-2" /> 任務總覽</h2>
                 <div className="flex items-center gap-2">
                    {user && user.role === 'admin' && (
                        <button onClick={onVoid} className="flex items-center text-sm px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700">作廢訂單</button>
                    )}
                    <button onClick={onExport} className="flex items-center text-sm px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600"><FileUp size={16} className="mr-1.5" /> 匯出報告</button>
                 </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm text-gray-500">品項完成度</p><p className="text-2xl font-bold text-gray-800">{packedSkus}<span className="text-lg font-normal text-gray-500">/{totalSkus}</span></p></div>
                <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-700">總揀貨數</p><p className="text-2xl font-bold text-blue-600">{totalPickedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
                <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-green-700">總裝箱數</p><p className="text-2xl font-bold text-green-600">{totalPackedQty}<span className="text-lg font-normal text-gray-500">/{totalQuantity}</span></p></div>
            </div>
        </div>
    );
};

// 主组件
export function Dashboard({ user, onLogout }) {
    const MySwal = withReactContent(Swal);
    const [currentOrder, setCurrentOrder] = useState(null);
    const [barcodeInput, setBarcodeInput] = useState('');
    
    const barcodeInputRef = useRef(null);
    useEffect(() => { barcodeInputRef.current?.focus(); }, [currentOrder]);

    const handleLogout = useCallback(() => { onLogout(); }, [onLogout]);
    
    const fetchOrderDetails = useCallback(async (orderId) => {
        try {
            const response = await apiClient.get(`/api/orders/${orderId}`);
            setCurrentOrder(response.data);
        } catch (err) {
            toast.error('错误', { description: err.response?.data?.message || '无法获取订单详情' });
        }
    }, []);

    const handleExcelImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('orderFile', file);
        const promise = apiClient.post('/api/orders/import', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.promise(promise, {
            loading: '正在上传并处理订单...',
            success: (response) => {
                fetchOrderDetails(response.data.orderId);
                return response.data.message;
            },
            error: (err) => `上传失败: ${err.response?.data?.message || err.message}`,
        });
        e.target.value = null; // 允许重复上传同一个文件
    };

    const updateItemQuantityOnServer = async (sku, type, amount) => {
        if (!currentOrder || !currentOrder.order) return;
        try {
            const response = await apiClient.post(`/api/orders/update_item`, {
                orderId: currentOrder.order.id, sku, type, amount
            });
            setCurrentOrder(prev => ({
                ...prev,
                items: prev.items.map(item => item.product_code === sku ? response.data.item : item)
            }));
        } catch (err) {
            toast.error(`更新失败`, { description: err.response?.data?.message || '发生未知错误' });
        }
    };
    
    const handleQuantityChange = (sku, type, amount) => {
        updateItemQuantityOnServer(sku, type, amount);
    };

    const handleScan = () => {
        const skuToScan = barcodeInput.trim();
        if (!skuToScan || !currentOrder) return;
        const targetItem = currentOrder.items.find(item => item.product_code === skuToScan);
        if (!targetItem) {
            toast.error('扫描错误', { description: '此产品不在此订单中。' });
            setBarcodeInput('');
            return;
        }
        if (['picker', 'admin'].includes(user.role)) {
            updateItemQuantityOnServer(skuToScan, 'pick', 1);
        } else {
            toast.error('权限不足', { description: '您没有拣货权限' });
        }
        setBarcodeInput('');
    };
    
    const handleVoidOrder = async () => {
        if (!currentOrder || !currentOrder.order) return;
        const { value: reason } = await MySwal.fire({ title: '确定要作废此订单？', text: "此操作无法复原，请输入作废原因：", input: 'text', showCancelButton: true });
        if (reason) {
            const promise = apiClient.patch(`/api/orders/${currentOrder.order.id}/void`, { reason });
            toast.promise(promise, {
                loading: '正在作废订单...',
                success: (res) => { setCurrentOrder(null); return res.data.message; },
                error: (err) => err.response?.data?.message || '操作失败',
            });
        }
    };

    const handleExportReport = () => {
        if (!currentOrder || !currentOrder.items) return;
        const data = currentOrder.items.map(item => ({
            "品项编码": item.product_code,
            "品项名称": item.product_name,
            "应出数量": item.quantity,
            "已拣数量": item.picked_quantity,
            "已装箱数量": item.packed_quantity
        }));
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "出货报告");
        XLSX.writeFile(workbook, `出货报告-${currentOrder.order.voucher_number}.xlsx`);
    };

    const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } };
    const handleClick = () => { handleScan(); };

    const progressStats = useMemo(() => {
        if (!currentOrder || !currentOrder.items) return { totalSkus: 0, packedSkus: 0, totalQuantity: 0, totalPickedQty: 0, totalPackedQty: 0 };
        const items = currentOrder.items;
        return {
            totalSkus: items.length,
            packedSkus: items.filter(item => item.packed_quantity >= item.quantity).length,
            totalQuantity: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
            totalPickedQty: items.reduce((sum, item) => sum + (item.picked_quantity || 0), 0),
            totalPackedQty: items.reduce((sum, item) => sum + (item.packed_quantity || 0), 0),
        };
    }, [currentOrder]);

    const sortedShipmentData = useMemo(() => {
        if (!currentOrder || !currentOrder.items) return [];
        return [...currentOrder.items].sort((a, b) => {
            const isAComplete = a.packed_quantity >= a.quantity;
            const isBComplete = b.packed_quantity >= b.quantity;
            return isAComplete - isBComplete;
        });
    }, [currentOrder]);
    
    const roleInfo = { picker: { name: '拣货', icon: <Package /> }, packer: { name: '装箱', icon: <PackageCheck /> }, admin: { name: '管理', icon: <PackageCheck /> } };
  
    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
             <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
                <div><h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">{roleInfo[user.role]?.icon || <Package size={32} />}<span>作業面板</span></h1><p className="text-gray-500 mt-1">操作員: {user.name || user.username} ({user.role})</p></div>
                <button onClick={handleLogout} className="mt-4 sm:mt-0 flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"><LogOut className="mr-2 h-4 w-4" /> 登出</button>
            </header>
            
            <ProgressDashboard stats={progressStats} onExport={handleExportReport} onVoid={handleVoidOrder} user={user} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><FileUp className="mr-2"/>1. 匯入出貨單</h2><input type="file" accept=".xlsx, .xls" onChange={handleExcelImport} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" /></div>
                    <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>2. 掃描區</h2><div className="flex gap-2"><input ref={barcodeInputRef} type="text" placeholder="掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={handleKeyDown} className="w-full px-4 py-2 border rounded-lg" disabled={!currentOrder} /><button onClick={handleClick} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300" disabled={!currentOrder}>確認</button></div></div>
                </div>
                <div className="lg:col-span-2">
                    <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
                        <div className="mb-4">
                            <h2 className="text-xl font-semibold text-gray-700">作業清單 ({currentOrder ? currentOrder.order.voucher_number : "尚未匯入"})</h2>
                            {currentOrder && ( <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mt-2 border-t pt-3"><span className="flex items-center gap-1.5"><User size={14} /> 客戶: <strong className="text-gray-800">{currentOrder.order.customer_name}</strong></span><span className="flex items-center gap-1.5"><Building size={14} /> 倉庫: <strong className="text-gray-800">{currentOrder.order.warehouse}</strong></span></div> )}
                        </div>
                        {sortedShipmentData.length > 0 ? (
                            <div className="space-y-3">
                                {sortedShipmentData.map((item) => {
                                    const status = getItemStatus(item);
                                    const canAdjustPick = ['picker', 'admin'].includes(user.role);
                                    const canAdjustPack = ['packer', 'admin'].includes(user.role) && item.picked_quantity > item.packed_quantity;
                                    return (
                                        <div key={item.product_code} className={`border rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-all`}>
                                            <div className="flex items-center gap-4 flex-1"><div title={status.label}><status.Icon size={28} className={status.color}/></div><div><p className="font-semibold text-gray-800">{item.product_name}</p><p className="text-sm text-gray-500 font-mono">{item.product_code}</p></div></div>
                                            <div className="w-full sm:w-auto flex items-center gap-2">
                                                <div className="flex items-center gap-1 w-36">
                                                    <QuantityButton icon={Minus} onClick={() => handleQuantityChange(item.product_code, 'pick', -1)} disabled={!canAdjustPick || item.picked_quantity <= 0} />
                                                    <div className="flex-1 text-center"><span className="font-bold text-lg text-blue-600">{item.picked_quantity}</span><span className="text-gray-500">/{item.quantity}</span><ProgressBar value={item.picked_quantity} max={item.quantity} colorClass="bg-blue-500" /></div>
                                                    <QuantityButton icon={Plus} onClick={() => handleQuantityChange(item.product_code, 'pick', 1)} disabled={!canAdjustPick || item.picked_quantity >= item.quantity} />
                                                </div>
                                                <div className="flex items-center gap-1 w-36">
                                                    <QuantityButton icon={Minus} onClick={() => handleQuantityChange(item.product_code, 'pack', -1)} disabled={!canAdjustPack || item.packed_quantity <= 0} />
                                                    <div className="flex-1 text-center"><span className="font-bold text-lg text-green-600">{item.packed_quantity}</span><span className="text-gray-500">/{item.picked_quantity}</span><ProgressBar value={item.packed_quantity} max={item.picked_quantity} colorClass="bg-green-500" /></div>
                                                    <QuantityButton icon={Plus} onClick={() => handleQuantityChange(item.product_code, 'pack', 1)} disabled={!canAdjustPack || item.packed_quantity >= item.picked_quantity} />
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
        </div>
    );
}