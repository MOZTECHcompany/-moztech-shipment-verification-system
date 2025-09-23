// frontend/src/pages/OrderWorkView.jsx - v4.1 混合模式 (SN + Barcode)

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { 
    ArrowLeft, PackageCheck, CheckCircle2, Loader2, Circle, ListChecks, Minus, Plus, 
    Building, User, ScanLine, FileUp, XCircle, Barcode, Tag, ChevronDown, ChevronUp 
} from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

// --- 辅助组件 ---
const ProgressBar = ({ value, max, colorClass }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return ( <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className={`${colorClass} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div></div> );
};

const QuantityButton = ({ onClick, icon: Icon, disabled, isUpdating }) => (
    <button onClick={onClick} disabled={disabled || isUpdating} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors">
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

// --- 新增：SN 码模式的品项卡片 ---
const SNItemCard = ({ item, instances }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const pickedInstances = instances.filter(i => i.status === 'picked' || i.status === 'packed');
    const packedInstances = instances.filter(i => i.status === 'packed');
    
    return (
        <div className="border rounded-lg bg-white shadow-sm">
            <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4 cursor-pointer hover:bg-gray-50" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex items-center gap-4 flex-1 w-full">
                    <div>
                        <p className="font-semibold text-gray-800">{item.product_name}</p>
                        <p className="text-sm text-gray-500 font-mono flex items-center gap-2 mt-1"><Tag size={14} className="text-gray-400"/>{item.product_code}</p>
                        <p className="text-sm text-blue-600 font-mono flex items-center gap-2"><Barcode size={14} className="text-gray-400"/>{item.barcode}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                    <div className="text-center w-28">
                        <p className='text-xs text-blue-700'>已揀 (SN)</p>
                        <span className="font-bold text-lg text-blue-600">{pickedInstances.length}</span>
                        <span className="text-gray-500">/{item.quantity}</span>
                        <ProgressBar value={pickedInstances.length} max={item.quantity} colorClass="bg-blue-500" />
                    </div>
                     <div className="text-center w-28">
                        <p className='text-xs text-green-700'>已裝箱 (SN)</p>
                        <span className="font-bold text-lg text-green-600">{packedInstances.length}</span>
                        <span className="text-gray-500">/{item.quantity}</span>
                        <ProgressBar value={packedInstances.length} max={item.quantity} colorClass="bg-green-500" />
                    </div>
                    <button className="p-2 text-gray-500">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                </div>
            </div>
            {isExpanded && (
                <div className="border-t bg-gray-50/50 p-4 max-h-60 overflow-y-auto">
                    <h4 className="font-semibold mb-2 text-gray-600">序號 (SN) 列表</h4>
                    <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                        {instances.map(inst => (
                            <li key={inst.id} className="font-mono flex items-center" title={`狀態: ${inst.status}`}>
                                {inst.status === 'packed' && <CheckCircle2 size={16} className="text-green-500 mr-2 flex-shrink-0" />}
                                {inst.status === 'picked' && <PackageCheck size={16} className="text-blue-500 mr-2 flex-shrink-0" />}
                                {inst.status === 'pending' && <Circle size={16} className="text-gray-400 mr-2 flex-shrink-0" />}
                                <span className={inst.status !== 'pending' ? 'text-gray-400 line-through' : 'text-gray-800'}>{inst.serial_number}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// --- 新增：数量模式的品项卡片 ---
const QuantityItemCard = ({ item, onUpdate, user, orderStatus, isUpdating }) => {
    const canAdjustPick = (user.role === 'picker' || user.role === 'admin') && orderStatus === 'picking';
    const canAdjustPack = (user.role === 'packer' || user.role === 'admin') && orderStatus === 'packing';
    
    return (
        <div className="border rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white shadow-sm">
            <div className="flex items-center gap-4 flex-1 w-full">
                <div>
                    <p className="font-semibold text-gray-800">{item.product_name}</p>
                    <p className="text-sm text-gray-500 font-mono flex items-center gap-2 mt-1"><Tag size={14} className="text-gray-400"/>{item.product_code}</p>
                    <p className="text-sm text-blue-600 font-mono flex items-center gap-2"><Barcode size={14} className="text-gray-400"/>{item.barcode}</p>
                </div>
            </div>
            <div className="w-full sm:w-auto flex items-center gap-2 justify-end">
                <div className="flex items-center gap-1 w-36">
                    <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pick', -1)} disabled={!canAdjustPick || item.picked_quantity <= 0} isUpdating={isUpdating} />
                    <div className="flex-1 text-center"><p className='text-xs text-blue-700'>揀貨</p><span className="font-bold text-lg text-blue-600">{item.picked_quantity}</span><span className="text-gray-500">/{item.quantity}</span><ProgressBar value={item.picked_quantity} max={item.quantity} colorClass="bg-blue-500" /></div>
                    <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pick', 1)} disabled={!canAdjustPick || item.picked_quantity >= item.quantity} isUpdating={isUpdating} />
                </div>
                <div className="flex items-center gap-1 w-36">
                    <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pack', -1)} disabled={!canAdjustPack || item.packed_quantity <= 0} isUpdating={isUpdating} />
                    <div className="flex-1 text-center"><p className='text-xs text-green-700'>裝箱</p><span className="font-bold text-lg text-green-600">{item.packed_quantity}</span><span className="text-gray-500">/{item.picked_quantity}</span><ProgressBar value={item.packed_quantity} max={item.picked_quantity} colorClass="bg-green-500" /></div>
                    <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pack', 1)} disabled={!canAdjustPack || item.packed_quantity >= item.picked_quantity} isUpdating={isUpdating} />
                </div>
            </div>
        </div>
    );
};


// --- 主作业视图组件 ---
export function OrderWorkView({ user }) {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const MySwal = withReactContent(Swal);

    const [currentOrderData, setCurrentOrderData] = useState({ order: null, items: [], instances: [] });
    const [loading, setLoading] = useState(true);
    const [barcodeInput, setBarcodeInput] = useState('');
    const [scanError, setScanError] = useState(null);
    const [isUpdating, setIsUpdating] = useState(false);

    const barcodeInputRef = useRef(null);
    const errorSoundRef = useRef(null);

    useEffect(() => { errorSoundRef.current = new Audio('/sounds/error.mp3'); }, []);
    useEffect(() => { barcodeInputRef.current?.focus(); }, [currentOrderData.order]);

    const fetchOrderDetails = useCallback(async (id) => {
        if (!id) return;
        try {
            setLoading(true);
            const response = await apiClient.get(`/api/orders/${id}`);
            setCurrentOrderData(response.data);
        } catch (err) {
            toast.error('無法獲取訂單詳情', { description: err.response?.data?.message || '請返回任務列表重試' });
            navigate('/tasks');
        } finally {
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => { fetchOrderDetails(orderId); }, [orderId, fetchOrderDetails]);

    const updateItemState = async (scanValue, type, amount = 1) => {
        if (isUpdating || !currentOrderData.order) return;
        setIsUpdating(true);
        try {
            const response = await apiClient.post(`/api/orders/update_item`, {
                orderId: currentOrderData.order.id,
                scanValue,
                type,
                amount
            });
            setCurrentOrderData(response.data);
            toast.success(`掃描成功: ${scanValue}`);
        } catch (err) {
            setScanError(err.response?.data?.message || '發生未知錯誤');
            errorSoundRef.current?.play();
            setTimeout(() => setScanError(null), 1500);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleScan = () => {
        const scanValue = barcodeInput.trim();
        if (!scanValue) return;
        setScanError(null);

        const { status } = currentOrderData.order;
        let operationType = null;
        if ((user.role === 'picker' || user.role === 'admin') && status === 'picking') operationType = 'pick';
        else if ((user.role === 'packer' || user.role === 'admin') && status === 'packing') operationType = 'pack';
        
        if (operationType) {
            updateItemState(scanValue, operationType, 1);
        } else {
            setScanError(`操作錯誤：目前狀態 (${status}) 不允許此操作`);
            errorSoundRef.current?.play();
            setTimeout(() => setScanError(null), 1500);
        }
        setBarcodeInput('');
    };

    const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } };
    const handleClick = () => { handleScan(); };

    const handleVoidOrder = async () => {
        if (!currentOrderData.order) return;
        const { value: reason } = await MySwal.fire({ title: '確定要作廢此訂單？', text: "此操作無法復原，請輸入作廢原因：", input: 'text', showCancelButton: true, confirmButtonText: '確認作廢', cancelButtonText: '取消' });
        if (reason) {
            const promise = apiClient.patch(`/api/orders/${currentOrderData.order.id}/void`, { reason });
            toast.promise(promise, {
                loading: '正在作廢訂單...',
                success: (res) => { navigate('/tasks'); return res.data.message; },
                error: (err) => err.response?.data?.message || '操作失敗',
            });
        }
    };

    const handleExportReport = () => {
        if (!currentOrderData.items) return;
        const data = currentOrderData.items.map(item => ({ 
            "國際條碼": item.barcode, 
            "品項型號": item.product_code, 
            "品項名稱": item.product_name, 
            "應出數量": item.quantity, 
            "已揀数量": item.picked_quantity, 
            "已装箱数量": item.packed_quantity,
            "SN列表": currentOrderData.instances.filter(i => i.order_item_id === item.id).map(i => i.serial_number).join(', ')
        }));
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "出貨報告");
        XLSX.writeFile(workbook, `出貨明細-${currentOrderData.order.voucher_number}.xlsx`);
        toast.success('檔案已成功匯出');
    };

    const handleReturnToTasks = () => navigate('/tasks');

    const progressStats = useMemo(() => {
        const { items, instances } = currentOrderData;
        if (!items || items.length === 0) return { totalSkus: 0, packedSkus: 0, totalQuantity: 0, totalPickedQty: 0, totalPackedQty: 0 };
        
        let totalQty = 0, pickedQty = 0, packedQty = 0, packedSkus = 0;

        items.forEach(item => {
            const itemInstances = instances.filter(i => i.order_item_id === item.id);
            totalQty += item.quantity;
            if (itemInstances.length > 0) {
                const itemPickedCount = itemInstances.filter(i => i.status === 'picked' || i.status === 'packed').length;
                const itemPackedCount = itemInstances.filter(i => i.status === 'packed').length;
                pickedQty += itemPickedCount;
                packedQty += itemPackedCount;
                if(itemPackedCount >= item.quantity) packedSkus++;
            } else {
                pickedQty += item.picked_quantity;
                packedQty += item.packed_quantity;
                if(item.packed_quantity >= item.quantity) packedSkus++;
            }
        });

        return {
            totalSkus: items.length,
            packedSkus: packedSkus,
            totalQuantity: totalQty,
            totalPickedQty: pickedQty,
            totalPackedQty: packedQty,
        };
    }, [currentOrderData]);

    const sortedItems = useMemo(() => {
        const { items, instances } = currentOrderData;
        if (!items) return [];
        return [...items].sort((a, b) => {
            const getPackedRatio = (item) => {
                const itemInstances = instances.filter(i => i.order_item_id === item.id);
                if (itemInstances.length > 0) {
                    return itemInstances.filter(i => i.status === 'packed').length / item.quantity;
                }
                return item.packed_quantity / item.quantity;
            };
            return getPackedRatio(a) - getPackedRatio(b);
        });
    }, [currentOrderData]);

    if (loading || !currentOrderData.order) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin text-blue-500" size={48} /></div>;
    }

    return (
        <div className={`p-4 md:p-8 max-w-7xl mx-auto bg-gray-50 min-h-screen`}>
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
                    <div className="bg-white p-6 rounded-xl shadow-md sticky top-8">
                        <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><ScanLine className="mr-2"/>掃描區</h2>
                        <div className="flex gap-2">
                            <input
                                ref={barcodeInputRef}
                                type="text"
                                placeholder="掃描 SN 碼或國際條碼..."
                                value={barcodeInput}
                                onChange={(e) => setBarcodeInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 transition-all ${scanError ? 'border-red-500 ring-red-500 animate-shake' : 'border-gray-300'}`}
                            />
                            <button onClick={handleClick} disabled={isUpdating} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
                                {isUpdating ? <Loader2 className="animate-spin" /> : '確認'}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="lg:col-span-2">
                    <div className="bg-white p-6 rounded-xl shadow-md min-h-full relative">
                        {scanError && (
                            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col justify-center items-center z-10 rounded-xl">
                                <XCircle className="text-red-500 h-16 w-16" />
                                <p className="mt-4 text-xl font-bold text-red-600 text-center px-4">{scanError}</p>
                            </div>
                        )}
                        <div className="mb-4">
                            <h2 className="text-xl font-semibold text-gray-700">作業清單 ({currentOrderData.order.voucher_number})</h2>
                            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mt-2 border-t pt-3">
                                <span className="flex items-center gap-1.5"><User size={14} /> 客戶: <strong className="text-gray-800">{currentOrderData.order.customer_name}</strong></span>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {sortedItems.map((item) => {
                                const itemInstances = currentOrderData.instances.filter(i => i.order_item_id === item.id);
                                const hasSN = itemInstances.length > 0;

                                if (hasSN) {
                                    return <SNItemCard key={item.id} item={item} instances={itemInstances} orderStatus={currentOrderData.order.status} user={user} />;
                                } else {
                                    return <QuantityItemCard key={item.id} item={item} onUpdate={updateItemState} user={user} orderStatus={currentOrderData.order.status} isUpdating={isUpdating} />;
                                }
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}