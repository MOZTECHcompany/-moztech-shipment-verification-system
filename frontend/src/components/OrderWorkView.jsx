// frontend/src/components/OrderWorkView.jsx
// 訂單作業視圖 - Apple 風格現代化版本 (Focus Mode & Enhanced UI)

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { 
    Loader2, ArrowLeft, Check, ScanLine, Package, 
    Plus, Minus, FileDown, XCircle, User, AlertTriangle, ChevronDown,
    ChevronUp, ShoppingCart, Box, Camera, MessageSquare,
    Maximize2, Minimize2, CheckCircle2
} from 'lucide-react';
import { PageHeader, Button, Card, CardContent, CardHeader, CardTitle, CardDescription, EmptyState, SkeletonText, Badge } from '@/ui';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import apiClient from '@/api/api';
import { socket } from '@/api/socket';
import soundNotification from '@/utils/soundNotification';
import voiceNotification from '@/utils/voiceNotification';
import desktopNotification from '@/utils/desktopNotification';
import { CameraScanner } from './CameraScanner';
import TaskComments from './TaskComments-modern';
import FloatingChatPanel from './FloatingChatPanel';
import { ShippingLabel, PickingList } from './LabelPrinter';
import ErrorBoundary from './ErrorBoundary';
import DefectReportModal from './DefectReportModal';

// --- 小型组件 ---
const ProgressBar = ({ value, max, colorClass = "bg-blue-500", height = "h-1.5" }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return (
        <div className={`w-full bg-gray-100 rounded-full ${height} overflow-hidden`}>
            <div 
                className={`${colorClass} h-full rounded-full transition-all duration-500 ease-out relative`} 
                style={{ width: `${Math.min(percentage, 100)}%` }}
            >
                <div className="absolute inset-0 bg-white/30 w-full h-full animate-shimmer" style={{ backgroundSize: '200% 100%' }}></div>
            </div>
        </div>
    );
};

const QuantityButton = ({ icon: Icon, onClick, disabled, isUpdating }) => (
    <button onClick={onClick} disabled={disabled || isUpdating} 
        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-200 hover:bg-gray-50 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-sm active:scale-95 active:bg-gray-100">
        <Icon size={14} className="text-gray-700" />
    </button>
);

const StatusBadge = ({ status }) => {
    const statusStyles = {
        pending: { color: 'text-gray-600', bg: 'bg-gray-100 border-gray-200', label: '待處理', icon: Package },
        picking: { color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', label: '揀貨中', icon: ShoppingCart },
        picked: { color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', label: '已揀貨', icon: CheckCircle2 },
        packing: { color: 'text-green-600', bg: 'bg-green-50 border-green-200', label: '裝箱中', icon: Box },
        completed: { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: '已完成', icon: Check },
        void: { color: 'text-red-600', bg: 'bg-red-50 border-red-200', label: '已作廢', icon: XCircle }
    };
    const style = statusStyles[status] || statusStyles.pending;
    const Icon = style.icon;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${style.bg} ${style.color} text-xs font-bold shadow-sm`}>
            <Icon size={12} />
            {style.label}
        </span>
    );
};

// --- 进度仪表板 ---
const ProgressDashboard = ({ stats, onExport, onVoid, user, onOpenCamera, onOpenDefectModal, activeSessions, order, items, isFocusMode, toggleFocusMode }) => {
    const completionPercentage = stats.totalSkus > 0 ? (stats.packedSkus / stats.totalSkus) * 100 : 0;
    
    return (
        <div className="mb-6 animate-fade-in">
            {/* 頂部控制列 */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
                        任務總覽
                        {activeSessions.length > 0 && (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                {activeSessions.length} 人在線
                            </span>
                        )}
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">管理與追蹤目前的訂單進度</p>
                </div>

                <div className="flex flex-wrap gap-2 w-full lg:w-auto">
                    {/* 專注模式切換 */}
                    <button
                        onClick={toggleFocusMode}
                        className={`px-3 py-2 rounded-lg transition-all duration-200 flex items-center gap-2 text-sm font-medium border ${
                            isFocusMode 
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' 
                                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                        {isFocusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        <span>{isFocusMode ? '退出專注' : '專注模式'}</span>
                    </button>

                    <div className="w-px h-8 bg-gray-200 mx-1 hidden sm:block"></div>

                    {/* 相機掃描按鈕 */}
                    <button 
                        onClick={onOpenCamera}
                        className="px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium transition-all duration-200 shadow-md shadow-gray-200 active:scale-95 flex items-center gap-2"
                    >
                        <Camera size={16} />
                        <span>掃描</span>
                    </button>

                    {/* 新品不良 SN 更換 - 快捷入口 */}
                    <button
                        onClick={() => onOpenDefectModal?.()}
                        className="px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-all duration-200 shadow-md shadow-red-200 active:scale-95 flex items-center gap-2"
                        title="新品不良 SN 更換"
                    >
                        <AlertTriangle size={16} />
                        <span>新品不良更換</span>
                    </button>
                    
                    {/* 列印按鈕群組 */}
                    <div className="flex items-center gap-2">
                        <ShippingLabel 
                            order={order} 
                            items={items} 
                            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all duration-200 shadow-md shadow-blue-200 active:scale-95 flex items-center gap-2"
                        />
                        <PickingList 
                            order={order} 
                            items={items} 
                            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-all duration-200 shadow-md shadow-emerald-200 active:scale-95 flex items-center gap-2"
                        />
                    </div>

                    {/* 更多操作 */}
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={onExport} 
                            className="p-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 transition-all duration-200 hover:shadow-sm active:scale-95"
                            title="匯出報告"
                        >
                            <FileDown size={18} />
                        </button>
                        
                        {user.role === 'admin' && (
                            <button 
                                onClick={onVoid} 
                                className="p-2 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-600 transition-all duration-200 hover:shadow-sm active:scale-95"
                                title="作廢訂單"
                            >
                                <XCircle size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
            
            {!isFocusMode && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* SKU Progress */}
                    <div className="glass-panel p-4 rounded-xl flex flex-col justify-between h-24 relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Package size={48} className="text-blue-600" />
                        </div>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider z-10">SKU 完成度</p>
                        <div className="z-10">
                            <div className="flex items-baseline gap-1 mb-1">
                                <span className="text-2xl font-bold text-gray-900">{stats.packedSkus}</span>
                                <span className="text-xs text-gray-400">/{stats.totalSkus}</span>
                            </div>
                            <ProgressBar value={stats.packedSkus} max={stats.totalSkus} colorClass="bg-blue-500" />
                        </div>
                    </div>

                    {/* Total Quantity */}
                    <div className="glass-panel p-4 rounded-xl flex flex-col justify-between h-24 relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Box size={48} className="text-gray-600" />
                        </div>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider z-10">總件數</p>
                        <div className="z-10">
                            <div className="flex items-baseline gap-1 mb-1">
                                <span className="text-2xl font-bold text-gray-900">{stats.totalQuantity}</span>
                                <span className="text-xs text-gray-400">件</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5"></div>
                        </div>
                    </div>

                    {/* Picked Quantity */}
                    <div className="glass-panel p-4 rounded-xl flex flex-col justify-between h-24 relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <ShoppingCart size={48} className="text-orange-600" />
                        </div>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider z-10">已揀貨</p>
                        <div className="z-10">
                            <div className="flex items-baseline gap-1 mb-1">
                                <span className="text-2xl font-bold text-gray-900">{stats.totalPickedQty}</span>
                                <span className="text-xs text-gray-400">/{stats.totalQuantity}</span>
                            </div>
                            <ProgressBar value={stats.totalPickedQty} max={stats.totalQuantity} colorClass="bg-orange-500" />
                        </div>
                    </div>

                    {/* Packed Quantity */}
                    <div className="glass-panel p-4 rounded-xl flex flex-col justify-between h-24 relative overflow-hidden group">
                        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Check size={48} className="text-green-600" />
                        </div>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider z-10">已裝箱</p>
                        <div className="z-10">
                            <div className="flex items-baseline gap-1 mb-1">
                                <span className="text-2xl font-bold text-gray-900">{stats.totalPackedQty}</span>
                                <span className="text-xs text-gray-400">/{stats.totalQuantity}</span>
                            </div>
                            <ProgressBar value={stats.totalPackedQty} max={stats.totalQuantity} colorClass="bg-green-500" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- SN模式的品项卡片 ---
const SNItemCard = ({ item, instances, isFocusMode }) => {
    const [expanded, setExpanded] = useState(false);
    
    const pickedCount = instances.filter(i => i.status === 'picked' || i.status === 'packed').length;
    const packedCount = instances.filter(i => i.status === 'packed').length;
    const isComplete = packedCount >= item.quantity;
    
    if (isFocusMode && isComplete && !expanded) return null;

    return (
        <div className={`group relative glass-panel rounded-xl overflow-hidden transition-all duration-300 ${
            isComplete 
                ? '!border-green-500/30 shadow-sm opacity-75 hover:opacity-100' 
                : 'shadow-sm hover:shadow-md hover:-translate-y-0.5'
        }`}>
            <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className={`font-bold text-base truncate ${isComplete ? 'text-green-700' : 'text-gray-900'}`}>
                                {item.product_name}
                            </h3>
                            {isComplete && <Check size={16} className="text-green-600" />}
                        </div>
                        <div className="flex flex-wrap gap-2 mb-3">
                            <span className="text-xs font-mono text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                {item.product_code}
                            </span>
                            <span className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                {item.barcode}
                            </span>
                        </div>
                        
                        {/* 進度條 */}
                        <div className="w-full max-w-md">
                            <div className="flex justify-between text-[10px] text-gray-400 mb-1 uppercase font-bold tracking-wider">
                                <span>進度</span>
                                <span>{Math.round((packedCount / item.quantity) * 100)}%</span>
                            </div>
                            <ProgressBar value={packedCount} max={item.quantity} colorClass={isComplete ? "bg-green-500" : "bg-blue-500"} height="h-1.5" />
                        </div>
                    </div>
                    
                    <div className="flex gap-2 flex-shrink-0">
                        <div className="text-center px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100 min-w-[60px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">揀貨</p>
                            <div className="flex items-baseline justify-center gap-0.5">
                                <span className={`text-lg font-bold ${pickedCount >= item.quantity ? 'text-blue-600' : 'text-gray-900'}`}>{pickedCount}</span>
                                <span className="text-[10px] text-gray-400">/{item.quantity}</span>
                            </div>
                        </div>
                        <div className="text-center px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100 min-w-[60px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">裝箱</p>
                            <div className="flex items-baseline justify-center gap-0.5">
                                <span className={`text-lg font-bold ${packedCount >= item.quantity ? 'text-green-600' : 'text-gray-900'}`}>{packedCount}</span>
                                <span className="text-[10px] text-gray-400">/{item.quantity}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                {instances.length > 0 && (
                    <button onClick={() => setExpanded(!expanded)} 
                        className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 py-1.5 rounded hover:bg-gray-50 transition-colors">
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {expanded ? '收起序號' : `查看序號 (${instances.length})`}
                    </button>
                )}
            </div>
            
            {expanded && instances.length > 0 && (
                <div className="border-t border-gray-100 bg-gray-50/50 p-3 animate-slide-up">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                        {instances.map((inst, idx) => (
                            <div key={idx} 
                                className={`px-2 py-1.5 rounded text-xs font-mono border flex items-center justify-between ${
                                    inst.status === 'packed' 
                                        ? 'bg-green-50 border-green-200 text-green-700' 
                                        : inst.status === 'picked' 
                                            ? 'bg-blue-50 border-blue-200 text-blue-700' 
                                            : 'bg-white border-gray-200 text-gray-500'
                                }`}>
                                <span className="truncate">{inst.serial_number}</span>
                                {inst.status === 'packed' && <Check size={12} />}
                                {inst.status === 'picked' && <ShoppingCart size={12} />}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- 数量模式的品项卡片 ---
const QuantityItemCard = ({ item, onUpdate, user, orderStatus, isUpdating, isFocusMode }) => {
    const canAdjustPick = (user.role === 'picker' || user.role === 'admin') && orderStatus === 'picking';
    const canAdjustPack = (user.role === 'packer' || user.role === 'admin') && orderStatus === 'packing';
    const isComplete = item.packed_quantity >= item.quantity;
    
    if (isFocusMode && isComplete) return null;

    return (
        <div className={`group relative glass-panel rounded-xl p-4 transition-all duration-300 ${
            isComplete 
                ? '!border-green-500/30 shadow-sm opacity-75 hover:opacity-100' 
                : 'shadow-sm hover:shadow-md hover:-translate-y-0.5'
        }`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-bold text-base truncate ${isComplete ? 'text-green-700' : 'text-gray-900'}`}>
                            {item.product_name}
                        </h3>
                        {isComplete && <Check size={16} className="text-green-600" />}
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                        <span className="text-xs font-mono text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                            {item.product_code}
                        </span>
                        <span className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                            {item.barcode}
                        </span>
                    </div>

                    {/* 進度條 */}
                    <div className="w-full max-w-md">
                        <div className="flex justify-between text-[10px] text-gray-400 mb-1 uppercase font-bold tracking-wider">
                            <span>進度</span>
                            <span>{Math.round((item.packed_quantity / item.quantity) * 100)}%</span>
                        </div>
                        <ProgressBar value={item.packed_quantity} max={item.quantity} colorClass={isComplete ? "bg-green-500" : "bg-blue-500"} height="h-1.5" />
                    </div>
                </div>
                
                <div className="w-full sm:w-auto flex items-center gap-3">
                    {/* Pick Controls */}
                    <div className={`flex items-center gap-2 p-1.5 rounded-lg border transition-all ${
                        item.picked_quantity >= item.quantity ? 'bg-blue-50 border-blue-100' : 'bg-white border-gray-100'
                    }`}>
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pick', -1)} 
                            disabled={!canAdjustPick || item.picked_quantity <= 0} isUpdating={isUpdating} />
                        
                        <div className="flex flex-col items-center min-w-[50px]">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">揀貨</span>
                            <div className="flex items-baseline gap-0.5">
                                <span className={`text-lg font-bold ${item.picked_quantity >= item.quantity ? 'text-blue-600' : 'text-gray-900'}`}>
                                    {item.picked_quantity}
                                </span>
                                <span className="text-[10px] text-gray-400">/{item.quantity}</span>
                            </div>
                        </div>

                        <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pick', 1)} 
                            disabled={!canAdjustPick || item.picked_quantity >= item.quantity} isUpdating={isUpdating} />
                    </div>
                    
                    {/* Pack Controls */}
                    <div className={`flex items-center gap-2 p-1.5 rounded-lg border transition-all ${
                        item.packed_quantity >= item.quantity ? 'bg-green-50 border-green-100' : 'bg-white border-gray-100'
                    }`}>
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pack', -1)} 
                            disabled={!canAdjustPack || item.packed_quantity <= 0} isUpdating={isUpdating} />
                        
                        <div className="flex flex-col items-center min-w-[50px]">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">裝箱</span>
                            <div className="flex items-baseline gap-0.5">
                                <span className={`text-lg font-bold ${item.packed_quantity >= item.quantity ? 'text-green-600' : 'text-gray-900'}`}>
                                    {item.packed_quantity}
                                </span>
                                <span className="text-[10px] text-gray-400">/{item.picked_quantity}</span>
                            </div>
                        </div>

                        <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pack', 1)} 
                            disabled={!canAdjustPack || item.packed_quantity >= item.picked_quantity} isUpdating={isUpdating} />
                    </div>
                </div>
            </div>
        </div>
    );
};


// 操作提示組件
const OperationHint = ({ order, scanError, isUpdating }) => {
    // 如果有錯誤，顯示錯誤（由外部組件處理），但這裡我們也可以選擇顯示提示
    // 為了避免空白，如果沒有錯誤，我們顯示提示
    if (scanError) return null;
    
    let hint = "等待掃描輸入...";
    let subHint = "請掃描商品條碼或 SN 碼";
    let icon = <ScanLine size={20} className="text-blue-400" />;

    if (isUpdating) {
        hint = "正在處理...";
        subHint = "請稍候";
        icon = <Loader2 size={20} className="text-blue-400 animate-spin" />;
    } else if (order?.status === 'completed') {
        hint = "訂單已完成";
        subHint = "所有品項已處理完畢";
        icon = <CheckCircle2 size={20} className="text-green-400" />;
    } else if (order?.status === 'picking') {
        hint = "揀貨作業中";
        subHint = "請掃描商品進行揀貨";
    } else if (order?.status === 'picked') {
        hint = "揀貨完成";
        subHint = "請掃描商品進行裝箱";
        icon = <Box size={20} className="text-orange-400" />;
    } else if (order?.status === 'packing') {
        hint = "裝箱作業中";
        subHint = "請掃描商品進行裝箱";
    }

    return (
        <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm animate-fade-in">
            <div className="flex items-start gap-3">
                <div className="mt-1">{icon}</div>
                <div>
                    <p className="text-sm font-bold text-white">{hint}</p>
                    <p className="text-xs text-gray-400">{subHint}</p>
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

    // 安全檢查：如果 user 為空，顯示載入中或重導向
    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    const [currentOrderData, setCurrentOrderData] = useState({ order: null, items: [], instances: [] });
    const [loading, setLoading] = useState(true);
    const [barcodeInput, setBarcodeInput] = useState('');
    const [scanError, setScanError] = useState(null);
    const [isUpdating, setIsUpdating] = useState(false);
    
    // 新功能狀態
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const [activeSessions, setActiveSessions] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [isFocusMode, setIsFocusMode] = useState(false); // 專注模式狀態
    const [defectModalOpen, setDefectModalOpen] = useState(false);

    const barcodeInputRef = useRef(null);
    // 移除對外部 mp3 的依賴，統一使用 WebAudio 產生提示音，避免 404 或自動播放限制
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

    // 載入所有用戶（用於評論@功能）
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                // 優先使用非管理員也可取得的精簡清單
                const response = await apiClient.get('/api/users/basic');
                setAllUsers(response.data || []);
            } catch (error) {
                // 舊後台端點作為備援（若目前使用者為管理員）
                try {
                    const fallback = await apiClient.get('/api/admin/users');
                    setAllUsers(fallback.data || []);
                } catch (e) {
                    console.error('載入用戶列表失敗:', e);
                    setAllUsers([]);
                }
            }
        };
        fetchUsers();
    }, []);

    // 即時協作功能
    useEffect(() => {
        if (!orderId) return;

        // 更新當前會話狀態
        const updateSession = () => {
            apiClient.post(`/api/tasks/${orderId}/session`, {
                session_type: 'viewing'
            }).catch(err => console.error('更新會話失敗:', err));
        };

        // 立即更新一次
        updateSession();
        
        // 每30秒更新一次心跳
        const interval = setInterval(updateSession, 30000);

        // 監聽即時協作事件
        socket.on('active_sessions_update', (data) => {
            if (data.orderId === parseInt(orderId)) {
                setActiveSessions(data.sessions.filter(s => s.user_id !== user.id));
            }
        });

        socket.on('new_comment', (data) => {
            if (data.orderId === parseInt(orderId)) {
                toast.info('💬 新評論', { description: '有人發表了新評論' });
            }
        });

        // 監聽任務狀態變更 (自動跳轉或更新 UI)
        socket.on('task_status_changed', (data) => {
            if (data.orderId === parseInt(orderId)) {
                // 如果狀態變為 completed，顯示完成動畫並跳轉
                if (data.newStatus === 'completed') {
                    MySwal.fire({
                        title: '🎉 訂單已完成！',
                        text: '所有品項已裝箱完畢，即將返回任務列表...',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    }).then(() => {
                        navigate('/tasks', { state: { view: 'completed' } });
                    });
                } 
                // 如果狀態變為 picked (揀貨完成)，且當前用戶是 picker，提示完成
                else if (data.newStatus === 'picked' && user.role === 'picker') {
                    MySwal.fire({
                        title: '✅ 揀貨完成！',
                        text: '此訂單已完成揀貨，即將返回任務列表...',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    }).then(() => {
                        navigate('/tasks', { state: { view: 'completed' } });
                    });
                }
                // 其他狀態變更則重新載入資料
                else {
                    fetchOrderDetails(orderId);
                }
            }
        });

        return () => {
            clearInterval(interval);
            socket.off('active_sessions_update');
            socket.off('new_comment');
            socket.off('task_status_changed');
        };
    }, [orderId, user.id, user.role, navigate, fetchOrderDetails]);

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

            // 不只依賴 socket：若回應已更新狀態，直接提示並導回任務列表
            const newStatus = response.data?.order?.status;
            if (newStatus === 'completed') {
                MySwal.fire({
                    title: '🎉 訂單已完成！',
                    text: '所有品項已裝箱完畢，即將返回任務列表...',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                }).then(() => {
                    navigate('/tasks', { state: { view: 'completed' } });
                });
                return;
            }
            if (newStatus === 'picked' && user.role === 'picker') {
                MySwal.fire({
                    title: '✅ 揀貨完成！',
                    text: '此訂單已完成揀貨，即將返回任務列表...',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                }).then(() => {
                    navigate('/tasks', { state: { view: 'completed' } });
                });
                return;
            }
            
            // 正確計算已掃描和剩餘數量（包含 instances）
            let totalScanned = 0;
            let totalRequired = 0;
            
            response.data.items.forEach(item => {
                totalRequired += item.quantity;
                
                // 檢查是否有 instances
                const itemInstances = response.data.instances.filter(i => i.order_item_id === item.id);
                if (itemInstances.length > 0) {
                    // 有 SN 碼的商品，計算已掃描的 instances
                    if (type === 'pick') {
                        totalScanned += itemInstances.filter(i => i.status === 'picked' || i.status === 'packed').length;
                    } else if (type === 'pack') {
                        totalScanned += itemInstances.filter(i => i.status === 'packed').length;
                    }
                } else {
                    // 無 SN 碼的商品，使用 picked_quantity 或 packed_quantity
                    totalScanned += (type === 'pick' ? item.picked_quantity : item.packed_quantity);
                }
            });
            
            const remaining = totalRequired - totalScanned;
            
            // 語音播報
            voiceNotification.speakScanSuccess(totalScanned, remaining);
            
            toast.success(`掃描成功: ${scanValue}`);
        } catch (err) {
            const errorMsg = err.response?.data?.message || '發生未知錯誤';
            setScanError(errorMsg);
            
            // 播放錯誤音效（WebAudio）
            soundNotification.play('error');
            
            // 語音播報
            voiceNotification.speakScanError();
            
            // 桌面通知
            desktopNotification.notifyScanError(errorMsg);
            
            // 震動提示 (如果支援)
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }
            
            // 顯示 Toast 提醒
            toast.error('條碼不符！', { 
                description: errorMsg,
                duration: 3000
            });
            
            setTimeout(() => setScanError(null), 3000);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleScan = () => {
        const scanValue = barcodeInput.trim();
        if (!scanValue) return;
        setScanError(null);

        const status = currentOrderData.order?.status;
        if (!status) {
            setScanError('訂單尚未載入，請稍候再試');
            return;
        }
        let operationType = null;
        if ((user.role === 'picker' || user.role === 'admin') && status === 'picking') operationType = 'pick';
        else if ((user.role === 'packer' || user.role === 'admin') && (status === 'packing' || status === 'picked')) operationType = 'pack';
        
        if (operationType) {
            updateItemState(scanValue, operationType, 1);
        } else {
            const errorMsg = `操作錯誤：目前狀態 (${status}) 不允許此操作`;
            setScanError(errorMsg);
            
            // 播放錯誤音效（WebAudio）
            soundNotification.play('error');
            
            // 語音播報
            voiceNotification.speakOperationError('操作不允許');
            
            // 桌面通知
            desktopNotification.notifyScanError(errorMsg);
            
            // 震動提示
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }
            
            // Toast 提醒
            toast.error('操作不允許！', { 
                description: errorMsg,
                duration: 3000 
            });
            
            setTimeout(() => setScanError(null), 3000);
        }
        setBarcodeInput('');
    };

    const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } };
    const handleClick = () => { handleScan(); };
    
    // 相機掃描處理
    const handleCameraScan = (code) => {
        setBarcodeInput(code);
        setTimeout(() => handleScan(), 100);
    };

    const handleVoidOrder = async () => {
        if (!currentOrderData.order) return;
        const { value: reason } = await MySwal.fire({ 
            title: '確定要作廢此訂單？', 
            text: "此操作無法復原，請輸入作廢原因：", 
            input: 'text', 
            showCancelButton: true, 
            confirmButtonText: '確認作廢', 
            cancelButtonText: '取消',
            customClass: {
                popup: 'glass',
                confirmButton: 'btn-apple bg-gradient-to-r from-red-500 to-red-600',
                cancelButton: 'btn-apple bg-gradient-to-r from-gray-400 to-gray-500'
            }
        });
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
            "已揀数量(計數)": item.picked_quantity, 
            "已装箱数量(計數)": item.packed_quantity,
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
                    if(item.quantity === 0) return 1;
                    return itemInstances.filter(i => i.status === 'packed').length / item.quantity;
                }
                if(item.quantity === 0) return 1;
                return item.packed_quantity / item.quantity;
            };
            return getPackedRatio(a) - getPackedRatio(b);
        });
    }, [currentOrderData]);

    return (
        <div className="min-h-screen bg-transparent pb-20">
            <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {/* 頂部導航 (已整合至 Dashboard) */}
                <div className="mb-6">
                    <Button variant="ghost" size="sm" onClick={handleReturnToTasks} leadingIcon={ArrowLeft} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100">
                        返回看板
                    </Button>
                </div>

                { (loading || !currentOrderData.order) && (
                  <Card className="mb-6 border-0 shadow-sm"><CardContent className="p-6"><SkeletonText lines={4} /></CardContent></Card>
                )}
                
                { !(loading || !currentOrderData.order) && (
                  <ErrorBoundary>
                    <ProgressDashboard 
                        stats={progressStats} 
                        onExport={handleExportReport} 
                        onVoid={handleVoidOrder} 
                        user={user}
                        onOpenCamera={() => setShowCameraScanner(true)}
                        onOpenDefectModal={() => setDefectModalOpen(true)}
                        activeSessions={activeSessions}
                        order={currentOrderData.order}
                        items={currentOrderData.items}
                        isFocusMode={isFocusMode}
                        toggleFocusMode={() => setIsFocusMode(!isFocusMode)}
                    />
                  </ErrorBoundary>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* 左側：掃描與討論 (在專注模式下隱藏討論) */}
                    <div className={`lg:col-span-4 xl:col-span-3 space-y-6 ${isFocusMode ? 'hidden lg:block lg:opacity-50 lg:pointer-events-none' : ''}`}>
                        {/* 掃描區 - 重新設計為深色主題以突顯 */}
                        <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-xl shadow-black/20 text-white relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <ScanLine size={80} />
                            </div>
                            
                            <div className="relative z-10">
                                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                                    <ScanLine size={20} className="text-blue-400"/>
                                    掃描作業
                                </h3>
                                <p className="text-gray-400 text-sm mb-4">請掃描商品條碼或 SN 碼</p>
                                
                                <div className="relative mb-3">
                                    <input
                                        ref={barcodeInputRef}
                                        type="text"
                                        placeholder="點擊掃描..."
                                        value={barcodeInput}
                                        onChange={(e) => setBarcodeInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        className={`w-full pl-4 pr-12 py-3.5 rounded-xl bg-gray-800 border-2 text-white placeholder-gray-500 focus:outline-none transition-all ${
                                            scanError 
                                                ? 'border-red-500 animate-shake' 
                                                : 'border-gray-700 focus:border-blue-500 focus:bg-gray-800'
                                        }`}
                                    />
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                        <button 
                                            onClick={handleClick}
                                            disabled={isUpdating}
                                            className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
                                        >
                                            {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeft size={16} className="rotate-180" />}
                                        </button>
                                    </div>
                                </div>

                                {scanError && (
                                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2 animate-fade-in">
                                        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                                        <span>{scanError}</span>
                                    </div>
                                )}
                                
                                <OperationHint 
                                    order={currentOrderData.order} 
                                    scanError={scanError} 
                                    isUpdating={isUpdating} 
                                />
                            </div>
                        </div>

                        {/* 討論區塊 */}
                        <div className="bg-white/30 backdrop-blur-md rounded-2xl shadow-sm border border-white/20 overflow-hidden flex flex-col h-[600px]">
                            <div className="flex-1 overflow-hidden relative">
                                <ErrorBoundary>
                                    <TaskComments orderId={orderId} currentUser={user} allUsers={allUsers} mode="embedded" />
                                </ErrorBoundary>
                            </div>
                        </div>
                    </div>

                    {/* 右側：作業清單 */}
                    <div className={`lg:col-span-8 xl:col-span-9 transition-all duration-500`}>
                        <div className="min-h-[600px]">
                            <div className="p-6 mb-4 rounded-2xl glass-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-0 z-20">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                        作業清單
                                        {currentOrderData.order && <StatusBadge status={currentOrderData.order.status} />}
                                    </h3>
                                    <p className="text-gray-500 text-sm mt-1">
                                        {isFocusMode ? '專注模式：僅顯示未完成項目' : '顯示所有訂單品項'}
                                    </p>
                                </div>
                                
                                {currentOrderData.order && (
                                    <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
                                        <User size={14} />
                                        <span className="font-medium">{currentOrderData.order.customer_name}</span>
                                        <span className="text-gray-300">|</span>
                                        <span className="font-mono">{currentOrderData.order.voucher_number}</span>
                                    </div>
                                )}
                            </div>
                            
                            <div className="min-h-full">
                                                                <ErrorBoundary>
                                {currentOrderData.order ? (
                                  <>
                                    <div className="space-y-3">
                                        {sortedItems.map((item, index) => {
                                            const itemInstances = currentOrderData.instances.filter(i => i.order_item_id === item.id);
                                            const hasSN = itemInstances.length > 0;
                                            return (
                                                <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
                                                    {hasSN ? (
                                                        <SNItemCard item={item} instances={itemInstances} isFocusMode={isFocusMode} />
                                                    ) : (
                                                        <QuantityItemCard item={item} onUpdate={updateItemState} user={user} orderStatus={currentOrderData.order?.status} isUpdating={isUpdating} isFocusMode={isFocusMode} />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    
                                    {sortedItems.length === 0 && !loading && (
                                        <EmptyState 
                                            icon={Package}
                                            title="尚無品項" 
                                            description="此訂單目前沒有可處理的品項" 
                                        />
                                    )}

                                    {/* 專注模式下的完成提示 */}
                                    {isFocusMode && sortedItems.every(item => item.packed_quantity >= item.quantity) && (
                                        <div className="text-center py-12 animate-fade-in">
                                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                                                <Check size={32} className="text-green-600" />
                                            </div>
                                            <h3 className="text-lg font-bold text-gray-900 mb-1">太棒了！</h3>
                                            <p className="text-gray-500 text-sm">所有項目都已完成</p>
                                            <Button onClick={() => setIsFocusMode(false)} variant="secondary" size="sm" className="mt-4">
                                                退出專注模式
                                            </Button>
                                        </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="space-y-4">
                                    <SkeletonText lines={2} className="h-20" />
                                    <SkeletonText lines={4} className="h-32" />
                                    <SkeletonText lines={4} className="h-32" />
                                  </div>
                                )}
                                                                </ErrorBoundary>
                            </div>
                        </div>
                    </div>
                </div>
            
                {/* 相機掃描器 */}
                {showCameraScanner && (
                    <CameraScanner
                        onScan={handleCameraScan}
                        onClose={() => setShowCameraScanner(false)}
                        mode="single"
                    />
                )}

                <DefectReportModal
                    isOpen={defectModalOpen}
                    onClose={() => setDefectModalOpen(false)}
                    orderId={currentOrderData.order?.id}
                    voucherNumber={currentOrderData.order?.voucher_number}
                    onSuccess={() => fetchOrderDetails(orderId)}
                />
            </div>
        </div>
    );
}
