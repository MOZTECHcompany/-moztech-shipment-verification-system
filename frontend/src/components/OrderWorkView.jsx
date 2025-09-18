// frontend/src/components/OrderWorkView.jsx

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { ArrowLeft, PackageCheck, CheckCircle2, Loader2, Circle, ListChecks, Minus, Plus, Building, User, ScanLine, FileUp } from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

// --- 輔助組件 (保持不變) ---
const getItemStatus = (item) => {
    const { quantity, picked_quantity, packed_quantity } = item;
    if (packed_quantity >= quantity) return { Icon: CheckCircle2, color: "text-green-500", label: "已完成" };
    if (picked_quantity >= quantity) return { Icon: PackageCheck, color: "text-blue-500", label: "待裝箱" };
    if (picked_quantity > 0 || packed_quantity > 0) return { Icon: Loader2, color: "text-yellow-500", label: "處理中", animate: true };
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
    if (totalSkus === 0) return null;
    return (
        <div className="bg-white p-6 rounded-xl shadow-md mb-8">
            <div className="flex justify-between items-start">
                 <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ListChecks className="mr-2" /> 任務總覽</h2>
                 <div className="flex items-center gap-2">
                    {user && user.role === 'admin' && (
                        <button onClick={onVoid} className="flex items-center text-sm px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700">作廢訂單</button>
                    )}
                    <button onClick={onExport} className="flex items-center text-sm px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600"><FileUp size={16} className="mr-1.5" /> 匯出本單明細</button>
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


// --- 主作業視圖組件 ---

export function OrderWorkView({ user }) {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const MySwal = withReactContent(Swal);

    const [currentOrder, setCurrentOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [barcodeInput, setBarcodeInput] = useState('');
    const barcodeInputRef = useRef(null);
    const errorSoundRef = useRef(null);

    useEffect(() => { errorSoundRef.current = new Audio('/sounds/error.mp3'); }, []);
    useEffect(() => { barcodeInputRef.current?.focus(); }, [currentOrder]);

    const fetchOrderDetails = useCallback(async (id) => {
        if (!id) return;
        try {
            setLoading(true);
            const response = await apiClient.get(`/api/orders/${id}`);
            setCurrentOrder(response.data);
        } catch (err) {
            toast.error('無法獲取訂單詳情', { description: err.response?.data?.message || '請返回任務列表重試' });
            navigate('/tasks');
        } finally {
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => { fetchOrderDetails(orderId); }, [orderId, fetchOrderDetails]);

    const updateItemQuantityOnServer = async (sku, type, amount) => {
        if (!currentOrder?.order) return;
        try {
            const response = await apiClient.post(`/api/orders/update_item`, { orderId: currentOrder.order.id, sku, type, amount });
            setCurrentOrder(response.data);
            if (response.data.order.status === 'picked' || response.data.order.status === 'completed') {
                const nextStep = response.data.order.status === 'picked' ? '訂單已完成揀貨！' : '訂單已完成所有作業！';
                 MySwal.fire({ title: '階段完成！', text: nextStep, icon: 'success', timer: 2000, showConfirmButton: false })
                    .then(() => navigate('/tasks'));
            }
        } catch (err) { 
            toast.error(`更新失敗`, { description: err.response?.data?.message || '發生未知錯誤' }); 
            errorSoundRef.current?.play();
        }
    };
    
    const handleQuantityChange = (sku, type, amount) => { updateItemQuantityOnServer(sku, type, amount); };

    const handleScan = () => {
        const skuToScan = barcodeInput.trim();
        if (!skuToScan || !currentOrder) return;
        const targetItem = currentOrder.items.find(item => item.product_code === skuToScan);
        if (!targetItem) { 
            toast.error('掃描錯誤', { description: '此產品不在此訂單中。' });
            errorSoundRef.current?.play();
            setBarcodeInput(''); 
            return; 
        }
        const { status } = currentOrder.order;
        const { role } = user;
        let operationType = null;
        if ((role === 'picker' || role === 'admin') && status === 'picking') operationType = 'pick';
        if ((role === 'packer' || role === 'admin') && status === 'packing') operationType = 'pack';
        if (!operationType) {
            toast.error('操作錯誤', { description: `目前狀態 (${status}) 或您的角色 (${role}) 不允許此操作`});
            errorSoundRef.current?.play();
            setBarcodeInput('');
            return;
        }
        updateItemQuantityOnServer(skuToScan, operationType, 1);
        setBarcodeInput('');
    };
    
    const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } };
    const handleClick = () => { handleScan(); };

    // 【关键修改】将所有函数和 hooks 移至函式元件内部
    const handleVoidOrder = async () => {
        if (!currentOrder?.order) return;
        const { value: reason } = await MySwal.fire({ title: '確定要作廢此訂單？', text: "此操作無法復原，請輸入作廢原因：", input: 'text', showCancelButton: true });
        if (reason) {
            const promise = apiClient.patch(`/api/orders/${currentOrder.order.id}/void`, { reason });
            toast.promise(promise, {
                loading: '正在作廢訂單...',
                success: (res) => { navigate('/tasks'); return res.data.message; },
                error: (err) => err.response?.data?.message || '操作失敗',
            });
        }
    };

    const handleExportReport = () => {
        if (!currentOrder?.items) return;
        const data = currentOrder.items.map(item => ({ "品項編碼": item.product_code, "品項名稱": item.product_name, "應出數量": item.quantity, "已揀数量": item.picked_quantity, "已装箱数量": item.packed_quantity }));
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "出貨報告");
        XLSX.writeFile(workbook, `出貨明細-${currentOrder.order.voucher_number}.xlsx`);
        toast.success('檔案已成功匯出');
    };
    
    const progressStats = useMemo(() => {
        if (!currentOrder?.items) return { totalSkus: 0, packedSkus: 0, totalQuantity: 0, totalPickedQty: 0, totalPackedQty: 0 };
        return {
            totalSkus: currentOrder.items.length,
            packedSkus: currentOrder.items.filter(item => item.packed_quantity >= item.quantity).length,
            totalQuantity: currentOrder.items.reduce((sum, item) => sum + (item.quantity || 0), 0),
            totalPickedQty: currentOrder.items.reduce((sum, item) => sum + (item.picked_quantity || 0), 0),
            totalPackedQty: currentOrder.items.reduce((sum, item) => sum + (item.packed_quantity || 0), 0),
        };
    }, [currentOrder]);

    const sortedShipmentData = useMemo(() => {
        if (!currentOrder?.items) return [];
        return [...currentOrder.items].sort((a, b) => (a.packed_quantity >= a.quantity) - (b.packed_quantity >= b.quantity));
    }, [currentOrder]);
    
    const handleReturnToTasks = () => navigate('/tasks');

    if (loading || !currentOrder) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin text-blue-500" size={48} /></div>;
    }

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen">
            <header className="flex justify-between items-center mb-8">
                <button onClick={handleReturnToTasks} className="flex items-center text-gray-600 hover:text-gray-900 font-semibold p-2 rounded-lg hover:bg-gray-200 transition-colors">
                    <ArrowLeft className="mr-2" /> 返回任務列表
                </button>
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 text-right">作業詳情</h1>
                    <p className="text-gray-500 mt-1 text-right">操作員: {user.name || user.username}</p>
                </div>
            </header>
            
            <ProgressDashboard stats={progressStats} onExport={handleExportReport} onVoid={handleVoidOrder} user={user} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                    <div className="bg-white p-6 rounded-xl shadow-md">
                        <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>掃描區</h2>
                        <div className="flex gap-2">
                            <input ref={barcodeInputRef} type="text" placeholder="掃描或輸入條碼..." value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={handleKeyDown} className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                            <button onClick={handleClick} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">確認</button>
                        </div>
                    </div>
                </div>
                <div className="lg:col-span-2">
                    <div className="bg-white p-6 rounded-xl shadow-md min-h-full">
                        <div className="mb-4">
                            <h2 className="text-xl font-semibold text-gray-700">作業清單 ({currentOrder.order.voucher_number})</h2>
                            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mt-2 border-t pt-3">
                                <span className="flex items-center gap-1.5"><User size={14} /> 客戶: <strong className="text-gray-800">{currentOrder.order.customer_name}</strong></span>
                                <span className="flex items-center gap-1.5"><Building size={14} /> 倉庫: <strong className="text-gray-800">{currentOrder.order.warehouse}</strong></span>
                            </div>
                        </div>
                        <div className="space-y-3">
                            {sortedShipmentData.map((item) => {
                                const status = getItemStatus(item);
                                const currentStatus = currentOrder.order.status;
                                const canAdjustPick = (user.role === 'picker' || user.role === 'admin') && currentStatus === 'picking';
                                const canAdjustPack = (user.role === 'packer' || user.role === 'admin') && currentStatus === 'packing';
                                return (
                                    <div key={item.product_code} className={`border rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 transition-all`}>
                                        <div className="flex items-center gap-4 flex-1">
                                            <div title={status.label}><status.Icon size={28} className={`${status.color} ${status.animate ? 'animate-spin' : ''}`}/></div>
                                            <div><p className="font-semibold text-gray-800">{item.product_name}</p><p className="text-sm text-gray-500 font-mono">{item.product_code}</p></div>
                                        </div>
                                        <div className="w-full sm:w-auto flex items-center gap-2 justify-end">
                                            <div className="flex items-center gap-1 w-36">
                                                <QuantityButton icon={Minus} onClick={() => handleQuantityChange(item.product_code, 'pick', -1)} disabled={!canAdjustPick || item.picked_quantity <= 0} />
                                                <div className="flex-1 text-center"><p className='text-xs text-blue-700'>揀貨</p><span className="font-bold text-lg text-blue-600">{item.picked_quantity}</span><span className="text-gray-500">/{item.quantity}</span><ProgressBar value={item.picked_quantity} max={item.quantity} colorClass="bg-blue-500" /></div>
                                                <QuantityButton icon={Plus} onClick={() => handleQuantityChange(item.product_code, 'pick', 1)} disabled={!canAdjustPick || item.picked_quantity >= item.quantity} />
                                            </div>
                                            <div className="flex items-center gap-1 w-36">
                                                <QuantityButton icon={Minus} onClick={() => handleQuantityChange(item.product_code, 'pack', -1)} disabled={!canAdjustPack || item.packed_quantity <= 0} />
                                                <div className="flex-1 text-center"><p className='text-xs text-green-700'>裝箱</p><span className="font-bold text-lg text-green-600">{item.packed_quantity}</span><span className="text-gray-500">/{item.picked_quantity}</span><ProgressBar value={item.packed_quantity} max={item.picked_quantity} colorClass="bg-green-500" /></div>
                                                <QuantityButton icon={Plus} onClick={() => handleQuantityChange(item.product_code, 'pack', 1)} disabled={!canAdjustPack || item.packed_quantity >= item.picked_quantity} />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}