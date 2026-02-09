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
    Maximize2, Minimize2, CheckCircle2, Pencil
} from 'lucide-react';
import { PageHeader, Button, Card, CardContent, CardHeader, CardTitle, CardDescription, EmptyState, SkeletonText, Badge, Modal } from '@/ui';
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
                        
                        {(user.role === 'admin' || user.role === 'superadmin') && (
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
const SNItemCard = ({ item, instances, isFocusMode, lineInfo }) => {
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
                            {lineInfo && (
                                <span className="text-xs font-medium text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                    同條碼第 {lineInfo.index}/{lineInfo.total} 行
                                </span>
                            )}
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
const QuantityItemCard = ({ item, onUpdate, user, orderStatus, isUpdating, isFocusMode, lineInfo }) => {
    const canAdjustPick = (user.role === 'picker' || user.role === 'admin' || user.role === 'superadmin') && orderStatus === 'picking';
    const canAdjustPack = (user.role === 'packer' || user.role === 'admin' || user.role === 'superadmin') && orderStatus === 'packing';
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
                        {lineInfo && (
                            <span className="text-xs font-medium text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                同條碼第 {lineInfo.index}/{lineInfo.total} 行
                            </span>
                        )}
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
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pick', -1, item.id)} 
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

                        <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pick', 1, item.id)} 
                            disabled={!canAdjustPick || item.picked_quantity >= item.quantity} isUpdating={isUpdating} />
                    </div>
                    
                    {/* Pack Controls */}
                    <div className={`flex items-center gap-2 p-1.5 rounded-lg border transition-all ${
                        item.packed_quantity >= item.quantity ? 'bg-green-50 border-green-100' : 'bg-white border-gray-100'
                    }`}>
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pack', -1, item.id)} 
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

                        <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pack', 1, item.id)} 
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

    // 例外事件（open/ack/resolved）
    const [orderExceptions, setOrderExceptions] = useState([]);
    const [exceptionsLoading, setExceptionsLoading] = useState(false);

    // 例外附件（證據鏈）
    const [exceptionAttachmentsById, setExceptionAttachmentsById] = useState({});
    const [attachmentsLoadingById, setAttachmentsLoadingById] = useState({});
    
    // 新功能狀態
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const [activeSessions, setActiveSessions] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [isFocusMode, setIsFocusMode] = useState(false); // 專注模式狀態
    const [defectModalOpen, setDefectModalOpen] = useState(false);

    // 例外清單 meta（責任人/拋單員）
    const [exceptionsMeta, setExceptionsMeta] = useState({
        responsibleUserId: null,
        responsibleRole: null,
        responsibleName: null
    });

    // 例外處理：現場回報（建立 open 例外）
    const [createExceptionOpen, setCreateExceptionOpen] = useState(false);
    const [createExceptionType, setCreateExceptionType] = useState('stockout');
    const [createExceptionReason, setCreateExceptionReason] = useState('');
    const [createExceptionSubmitting, setCreateExceptionSubmitting] = useState(false);

    // 例外處理：拋單員提交處理內容（待管理員審核）
    const [proposalOpen, setProposalOpen] = useState(false);
    const [proposalException, setProposalException] = useState(null);
    const [proposalAction, setProposalAction] = useState('exchange');
    const [proposalNote, setProposalNote] = useState('');
    const [proposalNewSn, setProposalNewSn] = useState('');
    const [proposalCorrectBarcode, setProposalCorrectBarcode] = useState('');
    const [proposalSubmitting, setProposalSubmitting] = useState(false);

    // 訂單異動申請（order_change）：拋單員送審，主管核可後才放行
    const [orderChangeOpen, setOrderChangeOpen] = useState(false);
    const [orderChangeReason, setOrderChangeReason] = useState('');
    const [orderChangeSubmitting, setOrderChangeSubmitting] = useState(false);
    const [orderChangeStep, setOrderChangeStep] = useState('edit'); // edit | confirm
    const [orderChangeDraftItems, setOrderChangeDraftItems] = useState([]);
    const orderChangeNewIdRef = useRef(1);

    // 例外附件預覽
    const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState(false);
    const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
    const [attachmentPreviewName, setAttachmentPreviewName] = useState('');
    const [attachmentPreviewMime, setAttachmentPreviewMime] = useState('');
    const [attachmentPreviewLoading, setAttachmentPreviewLoading] = useState(false);

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

    const fetchOrderExceptions = useCallback(async (id) => {
        if (!id) return;
        try {
            setExceptionsLoading(true);
            const res = await apiClient.get(`/api/orders/${id}/exceptions`);
            setOrderExceptions(res.data?.items || []);
            setExceptionsMeta(res.data?.meta || { responsibleUserId: null, responsibleRole: null, responsibleName: null });
        } catch (err) {
            // 例外清單不阻斷主要作業
            console.error('載入例外清單失敗:', err);
            setOrderExceptions([]);
            setExceptionsMeta({ responsibleUserId: null, responsibleRole: null, responsibleName: null });
        } finally {
            setExceptionsLoading(false);
        }
    }, []);

    const fetchExceptionAttachments = useCallback(async (exceptionId) => {
        if (!orderId || !exceptionId) return;
        try {
            setAttachmentsLoadingById((prev) => ({ ...prev, [exceptionId]: true }));
            const res = await apiClient.get(`/api/orders/${orderId}/exceptions/${exceptionId}/attachments`);
            const list = res.data?.items || [];
            setExceptionAttachmentsById((prev) => ({ ...prev, [exceptionId]: list }));
        } catch (err) {
            toast.error('載入附件失敗', { description: err.response?.data?.message || err.message });
            setExceptionAttachmentsById((prev) => ({ ...prev, [exceptionId]: [] }));
        } finally {
            setAttachmentsLoadingById((prev) => ({ ...prev, [exceptionId]: false }));
        }
    }, [orderId]);

    const downloadExceptionAttachment = useCallback(async (exceptionId, attachment) => {
        if (!orderId || !exceptionId || !attachment?.id) return;
        try {
            const res = await apiClient.get(
                `/api/orders/${orderId}/exceptions/${exceptionId}/attachments/${attachment.id}/download`,
                { responseType: 'blob' }
            );
            const blob = new Blob([res.data], { type: attachment.mime_type || 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = attachment.original_name || `attachment-${attachment.id}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            toast.error('下載附件失敗', { description: err.response?.data?.message || err.message });
        }
    }, [orderId]);

    const previewExceptionAttachment = useCallback(async (exceptionId, attachment) => {
        if (!orderId || !exceptionId || !attachment?.id) return;
        setAttachmentPreviewLoading(true);
        try {
            const res = await apiClient.get(
                `/api/orders/${orderId}/exceptions/${exceptionId}/attachments/${attachment.id}/download?inline=1`,
                { responseType: 'blob' }
            );
            const blob = new Blob([res.data], { type: attachment.mime_type || 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            setAttachmentPreviewUrl(url);
            setAttachmentPreviewMime(attachment.mime_type || '');
            setAttachmentPreviewName(attachment.original_name || `attachment-${attachment.id}`);
            setAttachmentPreviewOpen(true);
        } catch (err) {
            toast.error('預覽附件失敗', { description: err.response?.data?.message || err.message });
        } finally {
            setAttachmentPreviewLoading(false);
        }
    }, [orderId]);

    const uploadExceptionAttachments = useCallback(async (exceptionId) => {
        if (!orderId || !exceptionId) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/jpeg,image/png,image/webp,application/pdf';
        input.onchange = async () => {
            const files = Array.from(input.files || []);
            if (!files.length) return;

            const formData = new FormData();
            files.forEach((f) => formData.append('files', f));

            try {
                await apiClient.post(
                    `/api/orders/${orderId}/exceptions/${exceptionId}/attachments`,
                    formData,
                    { headers: { 'Content-Type': 'multipart/form-data' } }
                );
                toast.success('附件已上傳');
                fetchExceptionAttachments(exceptionId);
            } catch (err) {
                toast.error('上傳附件失敗', { description: err.response?.data?.message || err.message });
            }
        };
        input.click();
    }, [orderId, fetchExceptionAttachments]);

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
                    soundNotification.play('taskCompleted');
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
                    soundNotification.play('taskCompleted');
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

        socket.on('order_exception_changed', (data) => {
            if (data.orderId === parseInt(orderId)) {
                fetchOrderExceptions(orderId);
            }
        });

        return () => {
            clearInterval(interval);
            socket.off('active_sessions_update');
            socket.off('new_comment');
            socket.off('task_status_changed');
            socket.off('order_exception_changed');
        };
    }, [orderId, user.id, user.role, navigate, fetchOrderDetails, fetchOrderExceptions]);

    useEffect(() => {
        fetchOrderDetails(orderId);
        fetchOrderExceptions(orderId);
    }, [orderId, fetchOrderDetails, fetchOrderExceptions]);

    const typeLabel = (type) => {
        const map = {
            stockout: '缺貨',
            damage: '破損',
            over_scan: '多掃',
            under_scan: '少掃',
            sn_replace: 'SN更換',
            order_change: '訂單異動',
            other: '其他'
        };
        return map[type] || type;
    };

    const statusBadge = (status) => {
        if (status === 'open') return <Badge variant="warning">Open</Badge>;
        if (status === 'ack') return <Badge variant="info">Ack</Badge>;
        if (status === 'resolved') return <Badge variant="success">Resolved</Badge>;
        if (status === 'rejected') return <Badge variant="danger">Rejected</Badge>;
        return <Badge variant="neutral">{status}</Badge>;
    };

    const isAdminLike = user?.role === 'admin' || user?.role === 'superadmin';
    const isDispatcher = user?.role === 'dispatcher';
    const canDispatcherPropose = useMemo(() => {
        if (!isDispatcher) return false;
        const role = exceptionsMeta?.responsibleRole ? String(exceptionsMeta.responsibleRole).toLowerCase() : '';
        const responsibleUserId = exceptionsMeta?.responsibleUserId;
        if (role !== 'dispatcher' || !responsibleUserId) return false;
        return String(responsibleUserId) === String(user?.id);
    }, [exceptionsMeta?.responsibleRole, exceptionsMeta?.responsibleUserId, isDispatcher, user?.id]);

    const canProposeOrderChange = isAdminLike || canDispatcherPropose;

    const resolutionActionLabel = (action) => {
        const map = { short_ship: '少出', restock: '補貨', exchange: '換貨', void: '作廢', other: '其他' };
        return map[action] || action || '-';
    };

        const escapeHtml = (value) => {
                return String(value ?? '')
                        .replaceAll('&', '&amp;')
                        .replaceAll('<', '&lt;')
                        .replaceAll('>', '&gt;')
                        .replaceAll('"', '&quot;')
                        .replaceAll("'", '&#039;');
        };

        const toSnLines = (value) => {
                if (!value) return [];
                if (Array.isArray(value)) return value.filter(Boolean).map((x) => String(x));
                return String(value)
                        .split(/\r?\n/)
                        .map((x) => x.trim())
                        .filter((x) => x.length > 0);
        };

        const buildAckPreviewHtml = (ex) => {
                if (!ex) return '';

                const type = String(ex?.type || '');
                const proposal = ex?.snapshot?.proposal || null;

                const renderSnButtons = (lines) => {
                        const safeLines = (lines || []).slice(0, 800);
                        const btns = safeLines
                                .map((sn, idx) => {
                                        const key = `${idx}-${String(sn).slice(0, 32)}`;
                            return `<button type="button" class="ack-sn-item" aria-pressed="false" data-key="${escapeHtml(key)}" data-sn="${escapeHtml(sn)}">${escapeHtml(sn)}</button>`;
                                })
                                .join('');
                        return `<div class="ack-sn-box">${btns}</div>`;
                };

                const wrap = (inner) => `
                    <div style="text-align:left">
                        <style>
                            .ack-details > summary { list-style:none; cursor:pointer; font-size:12px; color:#1f2937; display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid #e5e7eb; border-radius:10px; background:#fff; font-weight:700; }
                            .ack-details > summary::-webkit-details-marker { display:none; }
                            .ack-chev { display:inline-block; font-size:14px; line-height:1; color:#111827; transform:rotate(0deg); transition:transform 150ms ease; }
                            .ack-details[open] .ack-chev { transform:rotate(90deg); }
                            .ack-sn-box { margin-top:6px; max-height:220px; overflow:auto; background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:8px; }
                            .ack-sn-item { display:block; width:100%; text-align:left; padding:8px 10px; border-radius:10px; border:1px solid #e5e7eb; background:#f9fafb; font-size:12px; color:#111827; margin:0 0 8px 0; cursor:pointer; }
                            .ack-sn-item:last-child { margin-bottom:0; }
                            .ack-sn-item.is-checked { text-decoration:line-through; opacity:0.6; background:#f3f4f6; }
                        </style>
                        <div style="font-size:12px;color:#374151;margin-bottom:8px">
                            <div style="font-weight:700;color:#111827">待核可內容</div>
                            <div style="margin-top:4px">類型：${escapeHtml(typeLabel(type))}</div>
                            <div style="margin-top:4px;white-space:pre-wrap;word-break:break-word">原因：${escapeHtml(ex?.reason_text || '')}</div>
                        </div>
                        ${inner}
                    </div>
                `;

                if (!proposal) return wrap('<div style="font-size:12px;color:#6b7280">（無拋單員處理內容）</div>');

                if (type === 'order_change' && Array.isArray(proposal?.items)) {
                        const itemsHtml = (proposal.items || []).slice(0, 200).map((it) => {
                                const barcode = String(it?.barcode || '').trim();
                                const productName = String(it?.productName || '').trim();
                                const qty = Number(it?.quantityChange);
                                const isNoSn = !!it?.noSn;
                                const snAdded = toSnLines(it?.snList);
                                const snRemoved = toSnLines(it?.removedSnList);
                                const title = `${escapeHtml(productName || '-')}${barcode ? `（${escapeHtml(barcode)}）` : ''}`;

                                const snAddedHtml = (!isNoSn && qty > 0 && snAdded.length > 0)
                                        ? `
                                            <details class="ack-details" style="margin-top:8px">
                                                <summary><span class="ack-chev" aria-hidden="true">▸</span>新增 SN（共 ${snAdded.length}）</summary>
                                                ${renderSnButtons(snAdded)}
                                            </details>
                                        `
                                        : '';

                                const snRemovedHtml = (!isNoSn && qty < 0 && snRemoved.length > 0)
                                        ? `
                                            <details class="ack-details" style="margin-top:8px">
                                                <summary><span class="ack-chev" aria-hidden="true">▸</span>移除 SN（共 ${snRemoved.length}）</summary>
                                                ${renderSnButtons(snRemoved)}
                                            </details>
                                        `
                                        : '';

                                const qtyText = Number.isFinite(qty) ? (qty > 0 ? `+${qty}` : String(qty)) : '-';

                                return `
                                    <div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:12px;padding:10px;margin-top:10px">
                                        <div style="font-weight:700;color:#111827;font-size:12px;word-break:break-word">${title}</div>
                                        <div style="margin-top:4px;font-size:12px;color:#374151">
                                            數量異動：<span style="font-weight:700">${escapeHtml(qtyText)}</span>
                                            ${isNoSn ? ' · 無SN' : ' · SN'}
                                        </div>
                                        ${snAddedHtml}
                                        ${snRemovedHtml}
                                    </div>
                                `;
                        }).join('');

                        const noteHtml = proposal?.note
                                ? `<div style="font-size:12px;color:#374151;white-space:pre-wrap;word-break:break-word">異動原因：${escapeHtml(proposal.note)}</div>`
                                : '';

                        return wrap(`
                            ${noteHtml}
                            <div style="margin-top:10px">${itemsHtml}</div>
                        `);
                }

                const newSnLines = toSnLines(proposal?.newSn);
                const newSnHtml = newSnLines.length > 0
                        ? `
                            <details class="ack-details" style="margin-top:8px">
                                <summary><span class="ack-chev" aria-hidden="true">▸</span>異動 SN（共 ${newSnLines.length}）</summary>
                                ${renderSnButtons(newSnLines)}
                            </details>
                        `
                        : '';

                const correctBarcodeHtml = proposal?.correctBarcode
                        ? `<div style="margin-top:6px;font-size:12px;color:#374151">正確條碼：${escapeHtml(proposal.correctBarcode)}</div>`
                        : '';

                const noteHtml = proposal?.note
                        ? `<div style="margin-top:6px;font-size:12px;color:#374151;white-space:pre-wrap;word-break:break-word">備註：${escapeHtml(proposal.note)}</div>`
                        : '';

                return wrap(`
                    <div style="font-size:12px;color:#374151">處理方式：${escapeHtml(resolutionActionLabel(proposal?.resolutionAction))}</div>
                    ${newSnHtml}
                    ${correctBarcodeHtml}
                    ${noteHtml}
                `);
        };

    const openProposalModal = (ex) => {
        const proposal = ex?.snapshot?.proposal || null;
        setProposalException(ex);
        setProposalAction(proposal?.resolutionAction || 'exchange');
        setProposalNote(proposal?.note || '');
        setProposalNewSn(proposal?.newSn || '');
        setProposalCorrectBarcode(proposal?.correctBarcode || '');
        setProposalOpen(true);
    };

    const closeProposalModal = () => {
        if (proposalSubmitting) return;
        setProposalOpen(false);
        setProposalException(null);
        setProposalAction('exchange');
        setProposalNote('');
        setProposalNewSn('');
        setProposalCorrectBarcode('');
    };

    const submitProposal = async () => {
        if (!proposalException?.id) return;
        if (!proposalAction) {
            toast.error('請選擇處理方式');
            return;
        }

        const note = proposalNote.trim();
        const newSn = proposalNewSn.trim();
        const correctBarcode = proposalCorrectBarcode.trim();

        if (!note && !newSn && !correctBarcode) {
            toast.error('請至少填寫備註或異動 SN/條碼');
            return;
        }

        try {
            setProposalSubmitting(true);
            await apiClient.patch(`/api/orders/${orderId}/exceptions/${proposalException.id}/propose`, {
                resolutionAction: proposalAction,
                note: note || null,
                newSn: newSn || null,
                correctBarcode: correctBarcode || null,
            });
            toast.success('已送出處理內容，等待管理員審核');
            closeProposalModal();
            fetchOrderExceptions(orderId);
        } catch (err) {
            toast.error('送出失敗', { description: err.response?.data?.message || err.message });
        } finally {
            setProposalSubmitting(false);
        }
    };

    const hasOpenExceptions = useMemo(() => {
        return (orderExceptions || []).some((ex) => ex?.status === 'open');
    }, [orderExceptions]);

    const hasOpenOrderChange = useMemo(() => {
        return (orderExceptions || []).some((ex) => ex?.status === 'open' && String(ex?.type) === 'order_change');
    }, [orderExceptions]);

    const canPackNow = useMemo(() => {
        const status = currentOrderData.order?.status;
        const roleCanPack = user?.role === 'packer' || isAdminLike;
        return roleCanPack && (status === 'packing' || status === 'picked');
    }, [currentOrderData.order?.status, user?.role, isAdminLike]);

    const packBlockedByExceptions = canPackNow && hasOpenExceptions;
    const operationBlockedByOrderChange = hasOpenOrderChange;

    const parseSnText = (text) => {
        const raw = String(text || '');
        const parts = raw.split(/[\s,，、\n\r\/ㆍ·・•]+/).map((x) => x.trim()).filter(Boolean);
        const cleaned = parts.map((x) => x.replace(/^SN\s*[:：]/i, '').trim()).filter(Boolean);
        const seen = new Set();
        const unique = [];
        for (const sn of cleaned) {
            const k = sn.toUpperCase();
            if (seen.has(k)) continue;
            seen.add(k);
            unique.push(sn);
        }
        return unique;
    };

    const buildOrderChangeDraftFromOrder = useCallback(() => {
        const items = currentOrderData.items || [];
        const instances = currentOrderData.instances || [];

        const instancesByOrderItemId = new Map();
        for (const inst of instances) {
            const orderItemId = inst?.order_item_id;
            if (!orderItemId) continue;
            const list = instancesByOrderItemId.get(orderItemId) || [];
            list.push(inst);
            instancesByOrderItemId.set(orderItemId, list);
        }

        const groupMap = new Map();
        for (const row of items) {
            const barcode = String(row?.barcode || '').trim();
            if (!barcode) continue;
            const g = groupMap.get(barcode) || {
                id: `sku-${barcode}`,
                isNew: false,
                barcode,
                productName: String(row?.product_name || row?.productName || '').trim(),
                originalQty: 0,
                pickedQty: 0,
                packedQty: 0,
                orderItemIds: [],
                instances: []
            };

            g.originalQty += Number(row?.quantity ?? 0) || 0;
            g.pickedQty += Number(row?.picked_quantity ?? 0) || 0;
            g.packedQty += Number(row?.packed_quantity ?? 0) || 0;
            if (row?.id) g.orderItemIds.push(row.id);
            if (!g.productName) g.productName = String(row?.product_name || '').trim();
            groupMap.set(barcode, g);
        }

        for (const g of groupMap.values()) {
            for (const id of g.orderItemIds) {
                const list = instancesByOrderItemId.get(id) || [];
                g.instances.push(...list);
            }
        }

        const draft = Array.from(groupMap.values())
            .map((g) => {
                const inst = g.instances || [];
                const isSn = inst.length > 0;
                const pending = [];
                const picked = [];
                const packed = [];
                for (const i of inst) {
                    const st = String(i?.status || '').toLowerCase();
                    const sn = String(i?.serial_number || '').trim();
                    if (!sn) continue;
                    if (st === 'packed') packed.push(sn);
                    else if (st === 'picked') picked.push(sn);
                    else pending.push(sn);
                }

                return {
                    id: g.id,
                    isNew: false,
                    barcode: g.barcode,
                    productName: g.productName,
                    isSn,
                    originalQty: Math.max(0, Math.trunc(Number(g.originalQty) || 0)),
                    targetQty: Math.max(0, Math.trunc(Number(g.originalQty) || 0)),
                    pickedSnCount: picked.length,
                    packedSnCount: packed.length,
                    pendingSerials: pending,
                    addSnText: '',
                    removeSelected: [],
                    expanded: false
                };
            })
            .sort((a, b) => String(a.productName || a.barcode).localeCompare(String(b.productName || b.barcode), 'zh-Hant'));

        return draft;
    }, [currentOrderData.items, currentOrderData.instances]);

    const openOrderChangeEditor = useCallback(() => {
        setOrderChangeReason('');
        setOrderChangeStep('edit');
        setOrderChangeDraftItems(buildOrderChangeDraftFromOrder());
        setOrderChangeOpen(true);
    }, [buildOrderChangeDraftFromOrder]);

    const updateOrderChangeDraft = (id, patch) => {
        setOrderChangeDraftItems((prev) => (prev || []).map((it) => (it.id === id ? { ...it, ...patch } : it)));
    };

    const toggleOrderChangeExpanded = (id) => {
        setOrderChangeDraftItems((prev) => (prev || []).map((it) => (it.id === id ? { ...it, expanded: !it.expanded } : it)));
    };

    const addNewOrderChangeItem = () => {
        const nextId = orderChangeNewIdRef.current++;
        setOrderChangeDraftItems((prev) => [
            ...(prev || []),
            {
                id: `new-${nextId}`,
                isNew: true,
                barcode: '',
                productName: '',
                isSn: false,
                originalQty: 0,
                targetQty: 1,
                pickedSnCount: 0,
                packedSnCount: 0,
                pendingSerials: [],
                addSnText: '',
                removeSelected: [],
                expanded: true
            }
        ]);
    };

    const removeNewOrderChangeItem = (id) => {
        setOrderChangeDraftItems((prev) => (prev || []).filter((it) => it.id !== id));
    };

    const buildOrderChangeProposalFromDraft = () => {
        const reason = String(orderChangeReason || '').trim();
        if (!reason) {
            return { ok: false, message: '請填寫異動原因（必填）' };
        }

        const proposalItems = [];

        for (const row of (orderChangeDraftItems || [])) {
            const barcode = String(row?.barcode || '').trim();
            const productName = String(row?.productName || '').trim();
            const originalQty = Math.max(0, Math.trunc(Number(row?.originalQty) || 0));
            const rawTarget = Number(row?.targetQty);
            const targetQty = Number.isFinite(rawTarget) ? Math.max(0, Math.trunc(rawTarget)) : NaN;

            if (!barcode && !productName) continue;
            if (!barcode) return { ok: false, message: '品項條碼必填' };
            if (!productName) return { ok: false, message: `品項 ${barcode} 產品名稱必填` };
            if (!Number.isFinite(targetQty)) return { ok: false, message: `品項 ${barcode} 目標數量無效` };

            const isSn = !!row?.isSn;
            const delta = targetQty - originalQty;
            if (delta === 0) {
                // new item with 0 means ignore
                continue;
            }

            if (isSn && delta < 0) {
                const pickedPacked = (Number(row?.pickedSnCount) || 0) + (Number(row?.packedSnCount) || 0);
                if (targetQty < pickedPacked) {
                    return { ok: false, message: `品項 ${barcode} 目標數量不可小於已刷過的 SN（picked/packed=${pickedPacked}）` };
                }

                const removeCount = Math.abs(delta);
                const snTrackedQty = pickedPacked + (Array.isArray(row?.pendingSerials) ? row.pendingSerials.length : 0);
                const untrackedQty = Math.max(0, originalQty - snTrackedQty);
                const removeSnNeeded = Math.max(0, removeCount - untrackedQty);
                const pendingSet = new Set((row?.pendingSerials || []).map((x) => String(x).toUpperCase()));
                const removedList = Array.isArray(row?.removeSelected) ? row.removeSelected : [];
                const removed = parseSnText(removedList.join('\n'));
                const missing = removed.filter((sn) => !pendingSet.has(String(sn).toUpperCase()));
                if (missing.length > 0) {
                    return { ok: false, message: `品項 ${barcode} 有 SN 不存在或非 pending，無法移除：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}` };
                }
                if (removed.length !== removeSnNeeded) {
                    return { ok: false, message: `品項 ${barcode} 減少 ${removeCount}，需選取/貼上 ${removeSnNeeded} 支待移除 SN（目前 ${removed.length}）` };
                }

                proposalItems.push({
                    barcode,
                    productName,
                    quantityChange: delta,
                    noSn: false,
                    removedSnList: removed
                });
                continue;
            }

            if (isSn && delta > 0) {
                const addCount = delta;
                const added = parseSnText(row?.addSnText);
                if (added.length !== addCount) {
                    return { ok: false, message: `品項 ${barcode} 新增 ${addCount}，需提供同數量 SN（目前 ${added.length}）` };
                }
                proposalItems.push({
                    barcode,
                    productName,
                    quantityChange: delta,
                    noSn: false,
                    snList: added
                });
                continue;
            }

            // non-SN items
            proposalItems.push({
                barcode,
                productName,
                quantityChange: delta,
                noSn: true
            });
        }

        if (proposalItems.length === 0) {
            return { ok: false, message: '尚未修改任何品項，無法送出' };
        }

        return {
            ok: true,
            value: {
                reason,
                items: proposalItems
            }
        };
    };

    const goOrderChangeConfirm = () => {
        const built = buildOrderChangeProposalFromDraft();
        if (!built.ok) {
            toast.error(built.message);
            return;
        }
        setOrderChangeStep('confirm');
    };

    const submitOrderChange = async () => {
        const built = buildOrderChangeProposalFromDraft();
        if (!built.ok) {
            toast.error(built.message);
            return;
        }

        try {
            setOrderChangeSubmitting(true);
            await apiClient.post(`/api/orders/${orderId}/exceptions`, {
                type: 'order_change',
                reasonText: built.value.reason,
                snapshot: {
                    proposal: {
                        note: built.value.reason,
                        items: built.value.items
                    },
                    source: 'order_work_view'
                }
            });
            toast.success(
                isAdminLike
                    ? '已送出訂單異動，請在下方例外列表按「核可」套用（會留痕）'
                    : '已送出訂單異動申請，等待管理員核可'
            );

            setOrderChangeOpen(false);
            setOrderChangeReason('');
            setOrderChangeStep('edit');
            setOrderChangeDraftItems([]);
            fetchOrderExceptions(orderId);
        } catch (err) {
            toast.error('送出失敗', { description: err.response?.data?.message || err.message });
        } finally {
            setOrderChangeSubmitting(false);
        }
    };

    const handleCreateException = async () => {
        const reasonText = String(createExceptionReason || '').trim();
        if (!reasonText) {
            toast.error('請填寫原因說明');
            return;
        }

        try {
            setCreateExceptionSubmitting(true);
            await apiClient.post(`/api/orders/${orderId}/exceptions`, {
                type: createExceptionType,
                reasonText,
                snapshot: {
                    source: 'order_work_view'
                }
            });
            toast.success('例外已建立');
            setCreateExceptionOpen(false);
            setCreateExceptionReason('');
            fetchOrderExceptions(orderId);
        } catch (err) {
            toast.error('建立例外失敗', { description: err.response?.data?.message || err.message });
        } finally {
            setCreateExceptionSubmitting(false);
        }
    };

    const handleAckException = async (exceptionId) => {
        const ex = (orderExceptions || []).find((x) => String(x?.id) === String(exceptionId)) || null;
        const ackSnStorageKey = `ack_sn_checked:${String(orderId)}:${String(exceptionId)}`;
        const result = await MySwal.fire({
            title: '主管核可',
            html: ex ? buildAckPreviewHtml(ex) : undefined,
            input: 'textarea',
            inputLabel: '核可備註（可選）',
            inputPlaceholder: '例如：已確認缺貨，允許少出；或已確認破損，需換貨…',
            showCancelButton: true,
            confirmButtonText: '核可',
            cancelButtonText: '取消',
            didOpen: () => {
                const popup = (typeof MySwal.getPopup === 'function') ? MySwal.getPopup() : document.querySelector('.swal2-popup');
                if (!popup) return;

                const normalizeSn = (value) => String(value || '').trim().toUpperCase();
                const safeReadSet = () => {
                    try {
                        const raw = window.localStorage.getItem(ackSnStorageKey);
                        const arr = raw ? JSON.parse(raw) : [];
                        if (!Array.isArray(arr)) return new Set();
                        return new Set(arr.map(normalizeSn).filter(Boolean));
                    } catch {
                        return new Set();
                    }
                };
                const safeWriteSet = (set) => {
                    try {
                        const arr = Array.from(set || []);
                        window.localStorage.setItem(ackSnStorageKey, JSON.stringify(arr));
                    } catch {
                        // ignore
                    }
                };

                // 進彈窗時先套用已勾選狀態（支援關掉再開/重整保留）
                const checkedSet = safeReadSet();
                const allSnButtons = popup.querySelectorAll('button.ack-sn-item');
                allSnButtons.forEach((btn) => {
                    const sn = normalizeSn(btn.getAttribute('data-sn'));
                    const isChecked = sn && checkedSet.has(sn);
                    if (isChecked) btn.classList.add('is-checked');
                    btn.setAttribute('aria-pressed', isChecked ? 'true' : 'false');
                });

                // 點擊 SN 可切換「已核對」(刪除線)
                popup.addEventListener('click', (ev) => {
                    const target = ev.target;
                    const btn = target && typeof target.closest === 'function'
                        ? target.closest('button.ack-sn-item')
                        : null;
                    if (!btn) return;
                    ev.preventDefault();
                    ev.stopPropagation();

                    btn.classList.toggle('is-checked');
                    const pressed = btn.classList.contains('is-checked');
                    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');

                    const sn = normalizeSn(btn.getAttribute('data-sn'));
                    if (sn) {
                        const nextSet = safeReadSet();
                        if (pressed) nextSet.add(sn);
                        else nextSet.delete(sn);
                        safeWriteSet(nextSet);
                    }
                });
            }
        });

        if (!result.isConfirmed) return;
        const note = result.value;

        try {
            await apiClient.patch(`/api/orders/${orderId}/exceptions/${exceptionId}/ack`, { note: note || null });
            try { window.localStorage.removeItem(ackSnStorageKey); } catch { /* ignore */ }
            toast.success('已核可');
            fetchOrderExceptions(orderId);
        } catch (err) {
            toast.error('核可失敗', { description: err.response?.data?.message || err.message });
        }
    };

    const handleRejectException = async (exceptionId) => {
        const result = await MySwal.fire({
            title: '主管駁回',
            input: 'textarea',
            inputLabel: '駁回原因（可選）',
            inputPlaceholder: '例如：資料不足、SN 不一致、需重新檢查後再送…',
            showCancelButton: true,
            confirmButtonText: '駁回',
            cancelButtonText: '取消',
            confirmButtonColor: '#ef4444'
        });

        if (!result.isConfirmed) return;
        const note = result.value;

        try {
            await apiClient.patch(`/api/orders/${orderId}/exceptions/${exceptionId}/reject`, { note: note || null });
            toast.success('已駁回');
            fetchOrderExceptions(orderId);
        } catch (err) {
            toast.error('駁回失敗', { description: err.response?.data?.message || err.message });
        }
    };

    const handleResolveException = async (exceptionId) => {
        const { value } = await MySwal.fire({
            title: '結案',
            html: `
              <div style="text-align:left">
                <label style="display:block;font-size:12px;margin-bottom:6px;color:#6b7280">處置類型（必填）</label>
                <select id="resolution-action" class="swal2-input" style="margin:0 0 12px 0;width:100%">
                  <option value="short_ship">少出</option>
                  <option value="restock">補貨</option>
                  <option value="exchange">換貨</option>
                  <option value="void">作廢</option>
                  <option value="other">其他</option>
                </select>

                <label style="display:block;font-size:12px;margin-bottom:6px;color:#6b7280">結案備註（可選）</label>
                <textarea id="resolution-note" class="swal2-textarea" placeholder="例如：已補貨完成；已更換新品；已調整數量…" style="margin:0;width:100%"></textarea>
              </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: '結案',
            cancelButtonText: '取消',
            preConfirm: () => {
                const resolutionAction = document.getElementById('resolution-action')?.value;
                const note = document.getElementById('resolution-note')?.value;
                if (!resolutionAction) {
                    MySwal.showValidationMessage('請選擇處置類型');
                    return null;
                }
                return { resolutionAction, note: note ? String(note).trim() : '' };
            }
        });

        if (!value) return;

        try {
            await apiClient.patch(`/api/orders/${orderId}/exceptions/${exceptionId}/resolve`, {
                resolutionAction: value.resolutionAction,
                note: value.note || null
            });
            toast.success('已結案');
            fetchOrderExceptions(orderId);
        } catch (err) {
            toast.error('結案失敗', { description: err.response?.data?.message || err.message });
        }
    };

    const updateItemState = async (scanValue, type, amount = 1, orderItemId) => {
        if (isUpdating || !currentOrderData.order) return;
        setIsUpdating(true);
        try {
            const response = await apiClient.post(`/api/orders/update_item`, {
                orderId: currentOrderData.order.id,
                scanValue,
                type,
                amount,
                ...(orderItemId ? { orderItemId } : {})
            });
            setCurrentOrderData(response.data);

            // 不只依賴 socket：若回應已更新狀態，直接提示並導回任務列表
            const newStatus = response.data?.order?.status;
            if (newStatus === 'completed') {
                soundNotification.play('taskCompleted');
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
                soundNotification.play('taskCompleted');
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
            const statusCode = err.response?.status;

            const serverMsg = err.response?.data?.message;
            const isExceptionBlocking = statusCode === 409;
            const errorMsg = isExceptionBlocking
                ? (serverMsg || '此訂單存在未核可例外，請先主管核可（ack）後再進行裝箱作業。')
                : (serverMsg || '發生未知錯誤');

            setScanError(errorMsg);

            if (isExceptionBlocking) {
                // 盡量同步最新例外狀態，避免使用者一直碰到 409
                fetchOrderExceptions(orderId);
            }
            
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
            toast.error(isExceptionBlocking ? '需先主管核可' : '掃描失敗', {
                description: errorMsg,
                duration: 3500
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
        if ((user.role === 'picker' || user.role === 'admin' || user.role === 'superadmin') && status === 'picking') operationType = 'pick';
        else if ((user.role === 'packer' || user.role === 'admin' || user.role === 'superadmin') && (status === 'packing' || status === 'picked')) operationType = 'pack';
        
        if (operationType) {
            if (hasOpenOrderChange) {
                const errorMsg = '此訂單異動審核中，需先主管核可後才能繼續作業。';
                setScanError(errorMsg);
                soundNotification.play('error');
                voiceNotification.speakOperationError('需先主管核可');
                desktopNotification.notifyScanError(errorMsg);
                if (navigator.vibrate) {
                    navigator.vibrate([200, 100, 200]);
                }
                toast.error('需先主管核可', {
                    description: errorMsg,
                    duration: 3500
                });
                setTimeout(() => setScanError(null), 3000);
                setBarcodeInput('');
                return;
            }
            if (operationType === 'pack' && hasOpenExceptions) {
                const errorMsg = '此訂單存在未核可例外（Open），需先主管核可（ack）後才能裝箱/完成。請先在「例外處理」區塊處理。';
                setScanError(errorMsg);
                soundNotification.play('error');
                voiceNotification.speakOperationError('需先主管核可');
                desktopNotification.notifyScanError(errorMsg);
                if (navigator.vibrate) {
                    navigator.vibrate([200, 100, 200]);
                }
                toast.error('需先主管核可', {
                    description: errorMsg,
                    duration: 3500
                });
                setTimeout(() => setScanError(null), 3000);
                setBarcodeInput('');
                return;
            }
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

    const canOperate = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'picker' || user?.role === 'packer';

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

    // 同一張訂單內，若有相同條碼的多行品項，顯示「第 X/N 行」提示
    const barcodeLineInfoByItemId = useMemo(() => {
        const items = currentOrderData.items || [];
        const groups = new Map();

        for (const item of items) {
            const barcode = String(item?.barcode ?? '').trim();
            if (!barcode) continue;
            const list = groups.get(barcode) || [];
            list.push(item);
            groups.set(barcode, list);
        }

        const map = {};
        for (const [, list] of groups.entries()) {
            if (list.length <= 1) continue;
            const sorted = [...list].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
            sorted.forEach((item, idx) => {
                map[item.id] = { index: idx + 1, total: sorted.length };
            });
        }
        return map;
    }, [currentOrderData.items]);

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

                                {packBlockedByExceptions && (
                                    <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm flex items-start gap-2 animate-fade-in">
                                        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <div className="font-bold">需先主管核可</div>
                                            <div className="text-xs text-amber-200/80 mt-0.5 break-words">
                                                此訂單存在 Open 例外，請先在「例外處理」按「核可」後再進行裝箱掃描。
                                                {isAdminLike ? '（你是管理員，可直接核可，但會留痕）' : ''}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="relative mb-3">
                                    <input
                                        ref={barcodeInputRef}
                                        type="text"
                                        placeholder={!canOperate ? '僅檢視模式（不可掃描）' : (operationBlockedByOrderChange ? '訂單異動審核中（需先主管核可）' : (packBlockedByExceptions ? '需先主管核可（Open 例外）' : '點擊掃描...'))}
                                        value={barcodeInput}
                                        onChange={(e) => setBarcodeInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        disabled={!canOperate || packBlockedByExceptions || operationBlockedByOrderChange}
                                        className={`w-full pl-4 pr-12 py-3.5 rounded-xl bg-gray-800 border-2 text-white placeholder-gray-500 focus:outline-none transition-all ${
                                            scanError 
                                                ? 'border-red-500 animate-shake' 
                                                : 'border-gray-700 focus:border-blue-500 focus:bg-gray-800'
                                        }`}
                                    />
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                        <button 
                                            onClick={handleClick}
                                            disabled={isUpdating || !canOperate || packBlockedByExceptions || operationBlockedByOrderChange}
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

                        {/* 例外處理（可追蹤狀態：open/ack/resolved） */}
                        <Card className="border-0 shadow-sm">
                            <CardHeader className="pb-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <CardTitle className="text-base">例外處理</CardTitle>
                                        <CardDescription>缺貨 / 破損 / 多掃 / 少掃 / SN更換</CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                                setCreateExceptionType('stockout');
                                                setCreateExceptionReason('');
                                                setCreateExceptionOpen(true);
                                            }}
                                        >
                                            新增
                                        </Button>

                                        {canProposeOrderChange && (
                                            <Button
                                                size="sm"
                                                disabled={hasOpenOrderChange}
                                                onClick={openOrderChangeEditor}
                                            >
                                                申請異動
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0 max-h-[55vh] overflow-auto">
                                {exceptionsLoading && <SkeletonText lines={3} />}

                                {!exceptionsLoading && (orderExceptions || []).length === 0 && (
                                    <EmptyState
                                        title="尚無例外"
                                        description="需要時可先建立 open，待主管核可後再結案。"
                                    />
                                )}

                                {!exceptionsLoading && (orderExceptions || []).length > 0 && (
                                    <div className="space-y-2">
                                        {orderExceptions.slice(0, 8).map((ex) => (
                                            <div key={ex.id} className="rounded-xl border border-gray-200 bg-white/60 p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-sm font-bold text-gray-900">{typeLabel(ex.type)}</span>
                                                            {statusBadge(ex.status)}
                                                        </div>
                                                        <div className="text-xs text-gray-600 mt-1 break-words">{ex.reason_text}</div>

                                                        {String(ex?.type) === 'order_change' && ex?.snapshot?.proposal && (
                                                            <div className="mt-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
                                                                <div className="text-[11px] text-gray-700 font-semibold">異動內容（待審核）</div>
                                                                {ex.snapshot.proposal?.note && (
                                                                    <div className="text-[11px] text-gray-600 break-words mt-1">原因：{ex.snapshot.proposal.note}</div>
                                                                )}
                                                                {Array.isArray(ex.snapshot.proposal?.items) && ex.snapshot.proposal.items.length > 0 && (
                                                                    <div className="mt-2 space-y-1">
                                                                        {ex.snapshot.proposal.items.slice(0, 8).map((it, idx) => {
                                                                            const barcode = String(it?.barcode || '').trim();
                                                                            const delta = Math.trunc(Number(it?.quantityChange) || 0);
                                                                            const originalQty = (currentOrderData.items || [])
                                                                                .filter((x) => String(x?.barcode || '').trim() === barcode)
                                                                                .reduce((acc, x) => acc + (Number(x?.quantity ?? 0) || 0), 0);
                                                                            const targetQty = Math.max(0, Math.trunc(originalQty) + delta);
                                                                            const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
                                                                            const isNoSn = !!it?.noSn;
                                                                            const snAdded = !isNoSn && delta > 0 && Array.isArray(it?.snList) ? it.snList.length : 0;
                                                                            const snRemoved = !isNoSn && delta < 0 && Array.isArray(it?.removedSnList) ? it.removedSnList.length : 0;

                                                                            return (
                                                                                <div key={`${ex.id}-chg-${idx}`} className="text-[11px] text-gray-600 break-words">
                                                                                    {barcode} · {it.productName} · {originalQty}→{targetQty}（{deltaText}）
                                                                                    {isNoSn ? ' · 無SN' : ' · SN'}
                                                                                    {!isNoSn && snAdded > 0 ? ` · 新增SN ${snAdded}` : ''}
                                                                                    {!isNoSn && snRemoved > 0 ? ` · 移除SN ${snRemoved}` : ''}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {ex.snapshot.proposal.items.length > 8 && (
                                                                            <div className="text-[11px] text-gray-500">僅顯示前 8 筆</div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {String(ex?.type) !== 'order_change' && ex?.snapshot?.proposal && (
                                                            <div className="mt-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
                                                                <div className="text-[11px] text-gray-700 font-semibold">
                                                                    拋單員處理內容（待審核）
                                                                </div>
                                                                <div className="text-[11px] text-gray-600 mt-1">
                                                                    處理方式：{resolutionActionLabel(ex.snapshot.proposal?.resolutionAction)}
                                                                </div>
                                                                {ex.snapshot.proposal?.newSn && (
                                                                    <div className="text-[11px] text-gray-600 whitespace-pre-wrap break-words">異動 SN：{ex.snapshot.proposal.newSn}</div>
                                                                )}
                                                                {ex.snapshot.proposal?.correctBarcode && (
                                                                    <div className="text-[11px] text-gray-600">正確條碼：{ex.snapshot.proposal.correctBarcode}</div>
                                                                )}
                                                                {ex.snapshot.proposal?.note && (
                                                                    <div className="text-[11px] text-gray-600 break-words">備註：{ex.snapshot.proposal.note}</div>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => fetchExceptionAttachments(ex.id)}
                                                                disabled={!!attachmentsLoadingById[ex.id]}
                                                            >
                                                                查看附件
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => uploadExceptionAttachments(ex.id)}
                                                            >
                                                                上傳附件
                                                            </Button>
                                                            <Badge variant="neutral">
                                                                {(exceptionAttachmentsById[ex.id] || []).length} 個
                                                            </Badge>
                                                        </div>

                                                        {(exceptionAttachmentsById[ex.id] || []).length > 0 && (
                                                            <div className="mt-2 space-y-1">
                                                                {(exceptionAttachmentsById[ex.id] || []).slice(0, 3).map((att) => (
                                                                    <div key={att.id} className="flex items-center justify-between gap-2">
                                                                        <div className="text-[11px] text-gray-600 truncate">
                                                                            {att.original_name || `attachment-${att.id}`}
                                                                        </div>
                                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                                            <Button
                                                                                size="xs"
                                                                                variant="ghost"
                                                                                onClick={() => previewExceptionAttachment(ex.id, att)}
                                                                                disabled={attachmentPreviewLoading}
                                                                            >
                                                                                預覽
                                                                            </Button>
                                                                            <Button
                                                                                size="xs"
                                                                                variant="ghost"
                                                                                onClick={() => downloadExceptionAttachment(ex.id, att)}
                                                                            >
                                                                                下載
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                {(exceptionAttachmentsById[ex.id] || []).length > 3 && (
                                                                    <div className="text-[11px] text-gray-500">僅顯示最近 3 筆附件</div>
                                                                )}
                                                            </div>
                                                        )}
                                                        <div className="text-[11px] text-gray-400 mt-1">
                                                            建立：{ex.created_by_name || ex.created_by} · {ex.created_at ? new Date(ex.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : ''}
                                                        </div>
                                                        {ex.status === 'ack' && (
                                                            <div className="text-[11px] text-gray-400 mt-1">
                                                                核可：{ex.ack_by_name || ex.ack_by} · {ex.ack_at ? new Date(ex.ack_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : ''}
                                                            </div>
                                                        )}
                                                        {ex.status === 'rejected' && (
                                                            <div className="text-[11px] text-gray-400 mt-1">
                                                                駁回：{ex.rejected_by_name || ex.rejected_by} · {ex.rejected_at ? new Date(ex.rejected_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : ''}
                                                                {ex.rejected_note ? ` · ${ex.rejected_note}` : ''}
                                                            </div>
                                                        )}
                                                        {ex.status === 'resolved' && (
                                                            <div className="text-[11px] text-gray-400 mt-1">
                                                                結案：{ex.resolved_by_name || ex.resolved_by} · {ex.resolved_at ? new Date(ex.resolved_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : ''}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {isAdminLike && (
                                                        <div className="flex flex-col gap-2 flex-shrink-0">
                                                            {ex.status === 'open' && (
                                                                <>
                                                                    <Button size="sm" onClick={() => handleAckException(ex.id)}>
                                                                        核可
                                                                    </Button>
                                                                    <Button size="sm" variant="danger" onClick={() => handleRejectException(ex.id)}>
                                                                        駁回
                                                                    </Button>
                                                                </>
                                                            )}
                                                            {ex.status === 'ack' && (
                                                                <Button size="sm" onClick={() => handleResolveException(ex.id)}>
                                                                    結案
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {(!isAdminLike && canDispatcherPropose) && (
                                                        <div className="flex flex-col gap-2 flex-shrink-0">
                                                            {ex.status === 'open' && String(ex?.type) !== 'order_change' && (
                                                                <Button size="sm" variant="secondary" onClick={() => openProposalModal(ex)}>
                                                                    填處理
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {(orderExceptions || []).length > 8 && (
                                            <div className="text-xs text-gray-500">僅顯示最近 8 筆例外</div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

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
                                            const lineInfo = barcodeLineInfoByItemId[item.id];
                                            return (
                                                <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
                                                    {hasSN ? (
                                                        <SNItemCard item={item} instances={itemInstances} isFocusMode={isFocusMode} lineInfo={lineInfo} />
                                                    ) : (
                                                        <QuantityItemCard item={item} onUpdate={updateItemState} user={user} orderStatus={currentOrderData.order?.status} isUpdating={isUpdating} isFocusMode={isFocusMode} lineInfo={lineInfo} />
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

                <Modal
                    open={createExceptionOpen}
                    onClose={() => {
                        if (createExceptionSubmitting) return;
                        setCreateExceptionOpen(false);
                    }}
                    title="回報例外"
                    footer={
                        <>
                            <Button
                                variant="secondary"
                                onClick={() => setCreateExceptionOpen(false)}
                                disabled={createExceptionSubmitting}
                            >
                                取消
                            </Button>
                            <Button
                                onClick={handleCreateException}
                                disabled={createExceptionSubmitting}
                            >
                                {createExceptionSubmitting ? '建立中…' : '建立'}
                            </Button>
                        </>
                    }
                >
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">類型</label>
                            <select
                                value={createExceptionType}
                                onChange={(e) => setCreateExceptionType(e.target.value)}
                                className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3.5 text-gray-900"
                                disabled={createExceptionSubmitting}
                            >
                                <option value="stockout">缺貨</option>
                                <option value="damage">破損</option>
                                <option value="over_scan">多掃</option>
                                <option value="under_scan">少掃</option>
                                <option value="sn_replace">SN更換</option>
                                <option value="other">其他</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">原因說明（必填）</label>
                            <textarea
                                value={createExceptionReason}
                                onChange={(e) => setCreateExceptionReason(e.target.value)}
                                placeholder="請描述原因與現場狀況（必填）"
                                className="w-full min-h-[140px] rounded-xl bg-white/70 border border-gray-200 px-4 py-3 leading-6 text-gray-900 outline-none"
                                disabled={createExceptionSubmitting}
                            />
                        </div>

                        <div className="text-xs text-gray-500">
                            建立後可在例外卡片中上傳照片/附件。
                        </div>
                    </div>
                </Modal>

                <Modal
                    open={proposalOpen}
                    onClose={closeProposalModal}
                    title="例外處理：填寫處理內容（待審核）"
                    footer={
                        <>
                            <Button variant="secondary" onClick={closeProposalModal} disabled={proposalSubmitting}>取消</Button>
                            <Button onClick={submitProposal} disabled={proposalSubmitting}>
                                {proposalSubmitting ? '送出中…' : '送出審核'}
                            </Button>
                        </>
                    }
                >
                    <div className="space-y-3">
                        <div className="text-sm text-gray-700">
                            <div className="font-semibold">類型：{typeLabel(proposalException?.type)}</div>
                            <div className="text-xs text-gray-500 mt-1">管理員核可後才會放行（解除 Open 阻擋）。</div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">處理方式（必填）</label>
                            <select
                                value={proposalAction}
                                onChange={(e) => setProposalAction(e.target.value)}
                                className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3 text-gray-900"
                            >
                                <option value="short_ship">少出</option>
                                <option value="restock">補貨</option>
                                <option value="exchange">換貨</option>
                                <option value="void">作廢</option>
                                <option value="other">其他</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">異動 SN（可選）</label>
                            <input
                                type="text"
                                value={proposalNewSn}
                                onChange={(e) => setProposalNewSn(e.target.value)}
                                placeholder="例如：B19B52004754 或 52004754"
                                className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white placeholder:text-gray-400"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">正確條碼（可選）</label>
                            <input
                                type="text"
                                value={proposalCorrectBarcode}
                                onChange={(e) => setProposalCorrectBarcode(e.target.value)}
                                placeholder="若現場掃到錯條碼，可填正確值供管理員核准"
                                className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white placeholder:text-gray-400"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">處理備註（可選）</label>
                            <textarea
                                value={proposalNote}
                                onChange={(e) => setProposalNote(e.target.value)}
                                rows={3}
                                placeholder="請描述處理方式與原因，管理員會依此審核"
                                className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white placeholder:text-gray-400"
                            />
                        </div>
                    </div>
                </Modal>

                <Modal
                    open={orderChangeOpen}
                    onClose={() => {
                        if (orderChangeSubmitting) return;
                        setOrderChangeOpen(false);
                        setOrderChangeStep('edit');
                    }}
                    title="申請訂單異動（待主管核可）"
                    className="max-w-6xl"
                    footer={
                        <>
                            {orderChangeStep === 'edit' ? (
                                <>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setOrderChangeOpen(false)}
                                        disabled={orderChangeSubmitting}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        onClick={goOrderChangeConfirm}
                                        disabled={orderChangeSubmitting}
                                    >
                                        下一步核對
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setOrderChangeStep('edit')}
                                        disabled={orderChangeSubmitting}
                                    >
                                        返回修改
                                    </Button>
                                    <Button
                                        onClick={submitOrderChange}
                                        disabled={orderChangeSubmitting}
                                    >
                                        {orderChangeSubmitting ? '送出中…' : '確認送出'}
                                    </Button>
                                </>
                            )}
                        </>
                    }
                >
                    <div className="max-h-[70vh] overflow-y-auto pr-1">
                    {orderChangeStep === 'edit' ? (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">異動原因（必填）</label>
                                <textarea
                                    value={orderChangeReason}
                                    onChange={(e) => setOrderChangeReason(e.target.value)}
                                    placeholder="請描述異動原因（必填）"
                                    className="w-full min-h-[110px] rounded-xl bg-white/70 border border-gray-200 px-4 py-3 leading-6 text-gray-900 outline-none"
                                    disabled={orderChangeSubmitting}
                                />
                                <div className="text-xs text-gray-700 font-medium mt-2">請直接修改「目標數量」，系統會自動計算差異並送審。</div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-semibold text-gray-700">品項列表</div>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={addNewOrderChangeItem}
                                    disabled={orderChangeSubmitting}
                                >
                                    <Plus size={14} className="mr-1" />
                                    新增品項
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {(orderChangeDraftItems || []).map((row) => {
                                    const originalQty = Math.max(0, Math.trunc(Number(row?.originalQty) || 0));
                                    const targetQty = Math.max(0, Math.trunc(Number(row?.targetQty) || 0));
                                    const delta = targetQty - originalQty;
                                    const pickedPacked = (Number(row?.pickedSnCount) || 0) + (Number(row?.packedSnCount) || 0);
                                    const isSn = !!row?.isSn;
                                    const snTrackedQty = isSn ? (pickedPacked + (Array.isArray(row?.pendingSerials) ? row.pendingSerials.length : 0)) : 0;
                                    const untrackedQty = isSn ? Math.max(0, originalQty - snTrackedQty) : 0;
                                    const minTarget = isSn ? Math.max(0, Math.trunc(Number(pickedPacked) || 0)) : 0;
                                    const pendingSerials = Array.isArray(row?.pendingSerials) ? row.pendingSerials : [];
                                    const removeSelected = Array.isArray(row?.removeSelected) ? row.removeSelected : [];
                                    const removeCountNeeded = (isSn && delta < 0) ? Math.max(0, Math.abs(delta) - untrackedQty) : (delta < 0 ? Math.abs(delta) : 0);
                                    const addCountNeeded = delta > 0 ? delta : 0;
                                    const addedList = parseSnText(row?.addSnText);

                                    const removeSet = new Set(removeSelected.map((x) => String(x).toUpperCase()));
                                    const shownPending = pendingSerials;

                                    const deltaLabel = delta === 0 ? '未變更' : (delta > 0 ? `+${delta}` : `${delta}`);

                                    return (
                                        <div key={row.id} className="rounded-2xl border border-gray-200 bg-white/60 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <div className="text-sm font-bold text-gray-900 truncate">{row.productName || (row.isNew ? '（新增品項）' : '')}</div>
                                                        {isSn ? <Badge variant="info">SN</Badge> : <Badge variant="neutral">無SN</Badge>}
                                                        <Badge variant={delta === 0 ? 'neutral' : (delta > 0 ? 'success' : 'warning')}>{deltaLabel}</Badge>
                                                    </div>
                                                    <div className="text-xs text-gray-600 mt-1 break-words">條碼：{row.barcode || '（未填）'} · 原始 {originalQty} → 目標 {targetQty}</div>
                                                    {isSn && (
                                                        <div className="text-xs text-gray-500 mt-1">SN 狀態：pending {pendingSerials.length} / picked {row.pickedSnCount} / packed {row.packedSnCount}</div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    {row.isNew && (
                                                        <Button size="xs" variant="secondary" onClick={() => removeNewOrderChangeItem(row.id)} disabled={orderChangeSubmitting}>
                                                            <Minus size={14} className="mr-1" />
                                                            移除
                                                        </Button>
                                                    )}
                                                    <Button size="sm" variant="secondary" onClick={() => toggleOrderChangeExpanded(row.id)} disabled={orderChangeSubmitting}>
                                                        <Pencil size={14} className="mr-1" />
                                                        {row.expanded ? '收合' : '編輯'}
                                                    </Button>
                                                </div>
                                            </div>

                                            {row.expanded && (
                                                <div className="mt-4 space-y-3">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="block text-xs font-semibold text-gray-700 mb-1">條碼（必填）</label>
                                                            <input
                                                                type="text"
                                                                value={row.barcode}
                                                                onChange={(e) => updateOrderChangeDraft(row.id, { barcode: e.target.value })}
                                                                placeholder="例如：4712345678901"
                                                                className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white placeholder:text-gray-400"
                                                                disabled={orderChangeSubmitting || (!row.isNew && !!row.barcode)}
                                                            />
                                                            {!row.isNew && (
                                                                <div className="text-[11px] text-gray-400 mt-1">既有品項條碼不可修改</div>
                                                            )}
                                                        </div>

                                                        <div>
                                                            <label className="block text-xs font-semibold text-gray-700 mb-1">品名（必填）</label>
                                                            <input
                                                                type="text"
                                                                value={row.productName}
                                                                onChange={(e) => updateOrderChangeDraft(row.id, { productName: e.target.value })}
                                                                placeholder="例如：某某商品"
                                                                className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white placeholder:text-gray-400"
                                                                disabled={orderChangeSubmitting}
                                                            />
                                                        </div>

                                                        <div>
                                                            <label className="block text-xs font-semibold text-gray-700 mb-1">目標數量（≥ 0）</label>
                                                            <input
                                                                type="number"
                                                                min={minTarget}
                                                                value={row.targetQty}
                                                                onChange={(e) => {
                                                                    const raw = e.target.value;
                                                                    if (raw === '') {
                                                                        // 允許使用者先清空再輸入（避免被即時 clamp 回 minTarget）
                                                                        updateOrderChangeDraft(row.id, { targetQty: '', removeSelected: [] });
                                                                        return;
                                                                    }
                                                                    const n = Number(e.target.value);
                                                                    const next = Number.isFinite(n) ? Math.max(minTarget, Math.trunc(n)) : row.targetQty;
                                                                    // SN 減少：自動幫忙挑選/補齊要移除的 pending SN（可再手動點選調整）
                                                                    if (isSn) {
                                                                        const nextDelta = next - originalQty;
                                                                        const nextRemove = nextDelta < 0 ? Math.abs(nextDelta) : 0;
                                                                        const need = nextDelta < 0 ? Math.max(0, nextRemove - untrackedQty) : 0;

                                                                        if (need === 0) {
                                                                            updateOrderChangeDraft(row.id, { targetQty: next, removeSelected: [] });
                                                                            return;
                                                                        }

                                                                        const pendingUpper = pendingSerials.map((x) => String(x).toUpperCase());
                                                                        const pendingSet = new Set(pendingUpper);
                                                                        const current = parseSnText((Array.isArray(row?.removeSelected) ? row.removeSelected : []).join('\n'))
                                                                            .filter((sn) => pendingSet.has(String(sn).toUpperCase()));

                                                                        const currentSet = new Set(current.map((x) => String(x).toUpperCase()));
                                                                        const fill = [];
                                                                        for (let i = 0; i < pendingSerials.length && (current.length + fill.length) < need; i++) {
                                                                            const sn = pendingSerials[i];
                                                                            const key = String(sn).toUpperCase();
                                                                            if (currentSet.has(key)) continue;
                                                                            fill.push(sn);
                                                                            currentSet.add(key);
                                                                        }

                                                                        const nextSelected = [...current, ...fill].slice(0, need);
                                                                        updateOrderChangeDraft(row.id, { targetQty: next, removeSelected: nextSelected });
                                                                        return;
                                                                    }

                                                                    updateOrderChangeDraft(row.id, { targetQty: next, removeSelected: next < originalQty ? row.removeSelected : [] });
                                                                }}
                                                                onBlur={() => {
                                                                    // 若留空離開，回填最低值，避免卡在無效狀態
                                                                    if (row?.targetQty === '') {
                                                                        updateOrderChangeDraft(row.id, { targetQty: minTarget, removeSelected: [] });
                                                                    }
                                                                }}
                                                                className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white"
                                                                disabled={orderChangeSubmitting}
                                                            />
                                                            {isSn && pickedPacked > 0 && (
                                                                <div className="text-[11px] text-amber-700 mt-1">此品項已有刷過的 SN（picked/packed={pickedPacked}），目標數量不可小於 {pickedPacked}</div>
                                                            )}
                                                        </div>

                                                        {row.isNew && (
                                                            <div className="flex items-center gap-3 pt-5">
                                                                <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={!!row.isSn}
                                                                        onChange={(e) => updateOrderChangeDraft(row.id, { isSn: e.target.checked, addSnText: '', removeSelected: [] })}
                                                                        disabled={orderChangeSubmitting}
                                                                        className="h-4 w-4 rounded border-gray-300"
                                                                    />
                                                                    有 SN
                                                                </label>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {isSn && addCountNeeded > 0 && (
                                                        <div>
                                                            <label className="block text-xs font-semibold text-gray-700 mb-1">新增 SN 清單（需要 {addCountNeeded} 筆）</label>
                                                            <textarea
                                                                value={row.addSnText}
                                                                onChange={(e) => updateOrderChangeDraft(row.id, { addSnText: e.target.value })}
                                                                placeholder="可用換行/空白/逗號分隔；支援 SN: 前綴"
                                                                rows={3}
                                                                className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white placeholder:text-gray-400"
                                                                disabled={orderChangeSubmitting}
                                                            />
                                                            <div className="text-xs text-gray-500 mt-1">目前 {addedList.length} / 需要 {addCountNeeded}</div>
                                                        </div>
                                                    )}

                                                    {isSn && removeCountNeeded > 0 && (
                                                        <div>
                                                            <>
                                                                <label className="block text-xs font-semibold text-gray-700 mb-1">要移除的 SN（需要 {removeCountNeeded} 筆，僅限 pending）</label>
                                                                <textarea
                                                                    value={(removeSelected || []).join('\n')}
                                                                    onChange={(e) => updateOrderChangeDraft(row.id, { removeSelected: parseSnText(e.target.value) })}
                                                                    placeholder="貼上要移除的 SN（可用換行/空白/逗號分隔）"
                                                                    rows={3}
                                                                    className="w-full rounded-xl border-gray-300 focus:border-blue-500 focus:ring-blue-500 px-4 py-2 leading-6 text-gray-900 bg-white placeholder:text-gray-400"
                                                                    disabled={orderChangeSubmitting}
                                                                />
                                                                <div className="text-xs text-gray-500 mt-1">目前 {removeSelected.length} / 需要 {removeCountNeeded}</div>

                                                                {pendingSerials.length > 0 && (
                                                                    <div className="mt-2">
                                                                        <div className="text-xs text-gray-600 mb-2">可點選 pending SN 快速加入/移除</div>
                                                                        <div className="max-h-[240px] overflow-y-auto rounded-xl border border-gray-200 bg-white/50 p-2">
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {shownPending.map((sn) => {
                                                                                const key = String(sn).toUpperCase();
                                                                                const selected = removeSet.has(key);
                                                                                return (
                                                                                    <button
                                                                                        key={key}
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            const next = selected
                                                                                                ? removeSelected.filter((x) => String(x).toUpperCase() !== key)
                                                                                                : [...removeSelected, sn];
                                                                                            updateOrderChangeDraft(row.id, { removeSelected: parseSnText(next.join('\n')) });
                                                                                        }}
                                                                                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${selected ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                                                                                    >
                                                                                        {sn}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="rounded-xl border border-gray-200 bg-white/60 p-3">
                                <div className="text-sm font-semibold text-gray-900">二次核對</div>
                                <div className="text-sm font-bold text-red-700 mt-2">以下品項將被異動，請務必再次確認數量與 SN。</div>
                                <div className="text-xs text-gray-700 mt-3 break-words">原因：{String(orderChangeReason || '').trim() || '（未填）'}</div>
                            </div>

                            {(() => {
                                const built = buildOrderChangeProposalFromDraft();
                                if (!built.ok) {
                                    return <div className="text-sm text-red-600">{built.message}</div>;
                                }
                                return (
                                    <div className="space-y-2">
                                        {built.value.items.map((it, idx) => {
                                            const qty = Number(it.quantityChange);
                                            const deltaText = qty > 0 ? `+${qty}` : `${qty}`;
                                            const snList = Array.isArray(it?.snList) ? it.snList : [];
                                            const removedSnList = Array.isArray(it?.removedSnList) ? it.removedSnList : [];
                                            return (
                                                <div key={`preview-${idx}`} className="rounded-xl border border-gray-200 bg-white/60 p-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-base font-extrabold text-gray-900 break-words">{it.productName}</div>
                                                            <div className="text-sm text-gray-700 mt-1 break-words">{it.barcode}</div>
                                                            <div className="text-lg font-extrabold text-red-700 mt-2">異動：{deltaText}{it.noSn ? '（無SN）' : '（SN）'}</div>
                                                            {!it.noSn && qty > 0 && (
                                                                <div className="mt-2">
                                                                    <div className="text-sm text-red-700 font-semibold">新增 SN：{snList.length} 筆</div>
                                                                    <div className="mt-1 max-h-[180px] overflow-y-auto rounded-xl border border-gray-200 bg-white/70 p-2">
                                                                        {snList.length === 0 ? (
                                                                            <div className="text-xs text-gray-500">（無）</div>
                                                                        ) : (
                                                                            <div className="flex flex-wrap gap-2">
                                                                                {snList.map((sn, i) => (
                                                                                    <span
                                                                                        key={`${String(sn)}-${i}`}
                                                                                        className="text-xs px-2 py-1 rounded-full border bg-white text-gray-700 border-gray-300"
                                                                                    >
                                                                                        {sn}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {!it.noSn && qty < 0 && (
                                                                <div className="mt-2">
                                                                    <div className="text-sm text-red-700 font-semibold">移除 SN：{removedSnList.length} 筆</div>
                                                                    <div className="mt-1 max-h-[180px] overflow-y-auto rounded-xl border border-gray-200 bg-white/70 p-2">
                                                                        {removedSnList.length === 0 ? (
                                                                            <div className="text-xs text-gray-500">（無）</div>
                                                                        ) : (
                                                                            <div className="flex flex-wrap gap-2">
                                                                                {removedSnList.map((sn, i) => (
                                                                                    <span
                                                                                        key={`${String(sn)}-${i}`}
                                                                                        className="text-xs px-2 py-1 rounded-full border bg-white text-gray-700 border-gray-300"
                                                                                    >
                                                                                        {sn}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    </div>
                </Modal>

                <Modal
                    open={attachmentPreviewOpen}
                    onClose={() => {
                        if (attachmentPreviewUrl) {
                            try { window.URL.revokeObjectURL(attachmentPreviewUrl); } catch { /* ignore */ }
                        }
                        setAttachmentPreviewOpen(false);
                        setAttachmentPreviewUrl('');
                        setAttachmentPreviewName('');
                        setAttachmentPreviewMime('');
                    }}
                    title={attachmentPreviewName ? `附件預覽：${attachmentPreviewName}` : '附件預覽'}
                    footer={
                        <Button
                            variant="secondary"
                            onClick={() => {
                                if (attachmentPreviewUrl) {
                                    try { window.URL.revokeObjectURL(attachmentPreviewUrl); } catch { /* ignore */ }
                                }
                                setAttachmentPreviewOpen(false);
                                setAttachmentPreviewUrl('');
                                setAttachmentPreviewName('');
                                setAttachmentPreviewMime('');
                            }}
                        >
                            關閉
                        </Button>
                    }
                >
                    {!attachmentPreviewUrl ? (
                        <div className="text-sm text-gray-500">尚未載入預覽內容</div>
                    ) : (
                        <div className="w-full">
                            {String(attachmentPreviewMime || '').startsWith('image/') && (
                                <img
                                    src={attachmentPreviewUrl}
                                    alt={attachmentPreviewName || 'attachment'}
                                    className="w-full max-h-[70vh] object-contain rounded-xl border border-gray-200"
                                />
                            )}
                            {String(attachmentPreviewMime || '').toLowerCase() === 'application/pdf' && (
                                <iframe
                                    title={attachmentPreviewName || 'pdf'}
                                    src={attachmentPreviewUrl}
                                    className="w-full h-[70vh] rounded-xl border border-gray-200"
                                />
                            )}
                            {!String(attachmentPreviewMime || '').startsWith('image/') && String(attachmentPreviewMime || '').toLowerCase() !== 'application/pdf' && (
                                <div className="text-sm text-gray-600">
                                    此附件格式不支援內嵌預覽（{attachmentPreviewMime || 'unknown'}），請改用下載。
                                </div>
                            )}
                        </div>
                    )}
                </Modal>
            </div>
        </div>
    );
}
