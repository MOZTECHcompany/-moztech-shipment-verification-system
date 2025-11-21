// frontend/src/components/OrderWorkView.jsx
// 訂單作業視圖 - Apple 風格現代化版本 (Focus Mode & Enhanced UI)

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { 
    Loader2, ArrowLeft, Check, ScanLine, Barcode, Tag, Package, 
    Plus, Minus, FileDown, XCircle, User, AlertTriangle, ChevronDown,
    ChevronUp, ShoppingCart, Box, Camera, MessageSquare, Printer, Users,
    Maximize2, Minimize2, Focus, Eye, EyeOff
} from 'lucide-react';
import { PageHeader, Button, Card, CardContent, CardHeader, CardTitle, CardDescription, EmptyState, SkeletonText, Badge } from '@/ui';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import apiClient from '../api/api';
import { socket } from '../api/socket';
import { soundNotification } from '../utils/soundNotification';
import { voiceNotification } from '../utils/voiceNotification';
import { desktopNotification } from '../utils/desktopNotification';
import { CameraScanner } from './CameraScanner';
import TaskComments from './TaskComments-modern';
import { ShippingLabel, PickingList } from './LabelPrinter';

// --- 小型组件 ---
const ProgressBar = ({ value, max, colorClass = "bg-blue-500" }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return (
        <div className="w-full bg-gray-100 rounded-full h-2 mt-2 overflow-hidden shadow-inner">
            <div className={`${colorClass} h-full rounded-full transition-all duration-500 shadow-sm relative`} style={{ width: `${Math.min(percentage, 100)}%` }}>
                <div className="absolute inset-0 bg-white/20 animate-pulse-slow"></div>
            </div>
        </div>
    );
};

const QuantityButton = ({ icon: Icon, onClick, disabled, isUpdating }) => (
    <button onClick={onClick} disabled={disabled || isUpdating} 
        className="p-3 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-md active:scale-95 active:bg-gray-100">
        <Icon size={18} className="text-gray-700" />
    </button>
);

const StatusBadge = ({ status }) => {
    const statusStyles = {
        pending: { color: 'text-gray-600', bg: 'bg-gray-100 border-gray-200', label: '待處理', icon: Package },
        picking: { color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', label: '揀貨中', icon: ShoppingCart },
        packing: { color: 'text-green-600', bg: 'bg-green-50 border-green-200', label: '裝箱中', icon: Box },
        completed: { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: '已完成', icon: Check },
        void: { color: 'text-red-600', bg: 'bg-red-50 border-red-200', label: '已作廢', icon: XCircle }
    };
    const style = statusStyles[status] || statusStyles.pending;
    const Icon = style.icon;
    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${style.bg} ${style.color} text-xs font-bold shadow-sm`}>
            <Icon size={14} />
            {style.label}
        </span>
    );
};

// --- 进度仪表板 ---
const ProgressDashboard = ({ stats, onExport, onVoid, user, onOpenCamera, activeSessions, order, items, isFocusMode, toggleFocusMode }) => {
    const completionPercentage = stats.totalSkus > 0 ? (stats.packedSkus / stats.totalSkus) * 100 : 0;
    
    return (
        <div className={`relative overflow-hidden rounded-3xl bg-white/80 backdrop-blur-2xl border border-white/40 shadow-apple-lg mb-6 animate-fade-in transition-all duration-500 ${isFocusMode ? 'p-4' : 'p-6'}`}>
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-transparent to-purple-50/30 pointer-events-none"></div>
            <div className="relative z-10">
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="w-full sm:w-auto">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center shadow-lg shadow-gray-900/20">
                                    <Package className="text-white" size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
                                        任務總覽
                                    </h2>
                                    {/* 即時協作指示器 */}
                                    {activeSessions.length > 0 && (
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="relative flex h-2 w-2">
                                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                            </span>
                                            <span className="text-xs text-gray-500 font-medium truncate">
                                                {activeSessions.map(s => s.name).join(', ')} 正在查看
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 w-full sm:w-auto items-center">
                            {/* 專注模式切換 */}
                            <button
                                onClick={toggleFocusMode}
                                className={`p-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 text-sm font-bold ${
                                    isFocusMode 
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-200' 
                                        : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                                }`}
                                title={isFocusMode ? "退出專注模式" : "進入專注模式"}
                            >
                                {isFocusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                                <span className="hidden sm:inline">{isFocusMode ? '退出專注' : '專注模式'}</span>
                            </button>

                            <div className="w-px h-8 bg-gray-200 mx-1 hidden sm:block"></div>

                            {/* 相機掃描按鈕 */}
                            <button 
                                onClick={onOpenCamera}
                                className="px-4 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-bold transition-all duration-200 hover:shadow-lg hover:shadow-gray-900/20 active:scale-95 flex items-center gap-2"
                            >
                                <Camera size={18} />
                                <span className="hidden sm:inline">掃描</span>
                            </button>
                            
                            {/* 工具按鈕群組 */}
                            <div className="flex bg-white rounded-xl border border-gray-200 p-1 shadow-sm">
                                <ShippingLabel order={order} items={items} variant="ghost" size="icon" />
                                <PickingList order={order} items={items} variant="ghost" size="icon" />
                                <button 
                                    onClick={onExport} 
                                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
                                    title="匯出報告"
                                >
                                    <FileDown size={18} />
                                </button>
                            </div>
                            
                            {/* 作廢訂單 */}
                            {user.role === 'admin' && (
                                <button 
                                    onClick={onVoid} 
                                    className="p-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-all duration-200 hover:shadow-md active:scale-95"
                                    title="作廢訂單"
                                >
                                    <XCircle size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                
                {!isFocusMode && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 animate-slide-up">
                        {/* SKU Progress - 藍色（核心關注） */}
                        <div className="group relative overflow-hidden bg-white p-5 rounded-2xl border border-blue-100 shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">SKU 進度</p>
                                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                                    <Package size={16} />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <p className="text-3xl font-black text-gray-900">{stats.packedSkus}</p>
                                <span className="text-sm text-gray-400 font-medium">/{stats.totalSkus}</span>
                            </div>
                            <ProgressBar value={stats.packedSkus} max={stats.totalSkus} colorClass="bg-blue-500" />
                        </div>

                        {/* Total Quantity - 灰色（基礎資訊） */}
                        <div className="group relative overflow-hidden bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">總數量</p>
                                <div className="w-8 h-8 rounded-lg bg-gray-50 text-gray-600 flex items-center justify-center">
                                    <Box size={16} />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <p className="text-3xl font-black text-gray-900">{stats.totalQuantity}</p>
                                <span className="text-sm text-gray-400 font-medium">件</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2 mt-2"></div>
                        </div>

                        {/* Picked Quantity - 橙色（進行中） */}
                        <div className="group relative overflow-hidden bg-white p-5 rounded-2xl border border-orange-100 shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">已揀貨</p>
                                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                                    <ShoppingCart size={16} />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <p className="text-3xl font-black text-gray-900">{stats.totalPickedQty}</p>
                                <span className="text-sm text-gray-400 font-medium">/{stats.totalQuantity}</span>
                            </div>
                            <ProgressBar value={stats.totalPickedQty} max={stats.totalQuantity} colorClass="bg-orange-500" />
                        </div>

                        {/* Packed Quantity - 綠色（已完成） */}
                        <div className="group relative overflow-hidden bg-white p-5 rounded-2xl border border-green-100 shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">已裝箱</p>
                                <div className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                                    <Check size={16} />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-1">
                                <p className="text-3xl font-black text-gray-900">{stats.totalPackedQty}</p>
                                <span className="text-sm text-gray-400 font-medium">/{stats.totalQuantity}</span>
                            </div>
                            <ProgressBar value={stats.totalPackedQty} max={stats.totalQuantity} colorClass="bg-green-500" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- SN模式的品项卡片 ---
const SNItemCard = ({ item, instances, isFocusMode }) => {
    const [expanded, setExpanded] = useState(false);
    
    const pickedCount = instances.filter(i => i.status === 'picked' || i.status === 'packed').length;
    const packedCount = instances.filter(i => i.status === 'packed').length;
    const isComplete = packedCount >= item.quantity;
    
    // 專注模式下，如果已完成則隱藏（除非展開）
    if (isFocusMode && isComplete && !expanded) return null;

    return (
        <div className={`group relative bg-white rounded-2xl overflow-hidden transition-all duration-300 ${
            isComplete 
                ? 'border border-green-200 shadow-sm opacity-80 hover:opacity-100' 
                : 'border border-gray-200 shadow-apple-sm hover:shadow-apple-md hover:-translate-y-0.5'
        }`}>
            {isComplete && (
                <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden z-10">
                    <div className="absolute top-0 right-0 bg-green-500 text-white text-xs font-bold px-6 py-1 transform rotate-45 translate-x-4 translate-y-3 shadow-sm">
                        完成
                    </div>
                </div>
            )}
            
            <div className="p-5">
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <h3 className={`font-bold text-lg truncate ${isComplete ? 'text-green-700' : 'text-gray-900'}`}>
                                {item.product_name}
                            </h3>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
                                <Tag size={14} className="text-gray-400"/>
                                <span className="text-sm font-mono text-gray-600 break-all">{item.product_code}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-100">
                                <Barcode size={14} className="text-blue-500"/>
                                <span className="text-sm font-mono text-blue-700 font-medium break-all">{item.barcode}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex gap-3 w-full sm:w-auto">
                        <div className="flex-1 sm:flex-none text-center bg-gray-50 px-4 py-2 rounded-xl border border-gray-100 min-w-[80px]">
                            <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">揀貨</p>
                            <div className="flex items-baseline justify-center gap-0.5">
                                <span className={`text-xl font-black ${pickedCount >= item.quantity ? 'text-blue-600' : 'text-gray-900'}`}>{pickedCount}</span>
                                <span className="text-xs text-gray-400">/{item.quantity}</span>
                            </div>
                        </div>
                        <div className="flex-1 sm:flex-none text-center bg-gray-50 px-4 py-2 rounded-xl border border-gray-100 min-w-[80px]">
                            <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">裝箱</p>
                            <div className="flex items-baseline justify-center gap-0.5">
                                <span className={`text-xl font-black ${packedCount >= item.quantity ? 'text-green-600' : 'text-gray-900'}`}>{packedCount}</span>
                                <span className="text-xs text-gray-400">/{item.quantity}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                {instances.length > 0 && (
                    <button onClick={() => setExpanded(!expanded)} 
                        className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-900 font-medium py-2 rounded-lg hover:bg-gray-50 transition-all duration-200 group-hover:bg-gray-50/50">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {expanded ? '收起序號列表' : `查看序號列表 (${instances.length})`}
                    </button>
                )}
            </div>
            
            {expanded && instances.length > 0 && (
                <div className="border-t border-gray-100 bg-gray-50/30 p-4 animate-slide-up">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-2 scrollbar-thin">
                        {instances.map((inst, idx) => (
                            <div key={idx} 
                                className={`px-3 py-2 rounded-lg text-sm font-mono border transition-all duration-200 flex items-center justify-between ${
                                    inst.status === 'packed' 
                                        ? 'bg-green-50 border-green-200 text-green-700 shadow-sm' 
                                        : inst.status === 'picked' 
                                            ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm' 
                                            : 'bg-white border-gray-200 text-gray-600'
                                }`}>
                                <span className="truncate">{inst.serial_number}</span>
                                {inst.status === 'packed' && <Check size={14} className="text-green-600 flex-shrink-0" />}
                                {inst.status === 'picked' && <ShoppingCart size={14} className="text-blue-600 flex-shrink-0" />}
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
    
    // 專注模式下，如果已完成則隱藏
    if (isFocusMode && isComplete) return null;

    return (
        <div className={`group relative bg-white rounded-2xl p-5 transition-all duration-300 ${
            isComplete 
                ? 'border border-green-200 shadow-sm opacity-80 hover:opacity-100' 
                : 'border border-gray-200 shadow-apple-sm hover:shadow-apple-md hover:-translate-y-0.5'
        }`}>
            {isComplete && (
                <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden z-10">
                    <div className="absolute top-0 right-0 bg-green-500 text-white text-xs font-bold px-6 py-1 transform rotate-45 translate-x-4 translate-y-3 shadow-sm">
                        完成
                    </div>
                </div>
            )}

            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-center gap-2 mb-2">
                        <h3 className={`font-bold text-lg truncate ${isComplete ? 'text-green-700' : 'text-gray-900'}`}>
                            {item.product_name}
                        </h3>
                    </div>
                    <div className="flex flex-wrap gap-3 mb-4 lg:mb-0">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
                            <Tag size={14} className="text-gray-400"/>
                            <span className="text-sm font-mono text-gray-600 break-all">{item.product_code}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-100">
                            <Barcode size={14} className="text-blue-500"/>
                            <span className="text-sm font-mono text-blue-700 font-medium break-all">{item.barcode}</span>
                        </div>
                    </div>
                </div>
                
                <div className="w-full lg:w-auto flex flex-col sm:flex-row items-center gap-4">
                    {/* Pick Controls */}
                    <div className={`flex items-center gap-3 p-2 rounded-2xl border transition-all w-full sm:w-auto justify-between ${
                        item.picked_quantity >= item.quantity ? 'bg-blue-50/50 border-blue-100' : 'bg-gray-50/50 border-gray-100'
                    }`}>
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pick', -1)} 
                            disabled={!canAdjustPick || item.picked_quantity <= 0} isUpdating={isUpdating} />
                        
                        <div className="flex flex-col items-center min-w-[80px]">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">揀貨</span>
                            <div className="flex items-baseline gap-0.5">
                                <span className={`text-2xl font-black ${item.picked_quantity >= item.quantity ? 'text-blue-600' : 'text-gray-900'}`}>
                                    {item.picked_quantity}
                                </span>
                                <span className="text-xs text-gray-400 font-medium">/{item.quantity}</span>
                            </div>
                        </div>

                        <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pick', 1)} 
                            disabled={!canAdjustPick || item.picked_quantity >= item.quantity} isUpdating={isUpdating} />
                    </div>
                    
                    {/* Pack Controls */}
                    <div className={`flex items-center gap-3 p-2 rounded-2xl border transition-all w-full sm:w-auto justify-between ${
                        item.packed_quantity >= item.quantity ? 'bg-green-50/50 border-green-100' : 'bg-gray-50/50 border-gray-100'
                    }`}>
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pack', -1)} 
                            disabled={!canAdjustPack || item.packed_quantity <= 0} isUpdating={isUpdating} />
                        
                        <div className="flex flex-col items-center min-w-[80px]">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">裝箱</span>
                            <div className="flex items-baseline gap-0.5">
                                <span className={`text-2xl font-black ${item.packed_quantity >= item.quantity ? 'text-green-600' : 'text-gray-900'}`}>
                                    {item.packed_quantity}
                                </span>
                                <span className="text-xs text-gray-400 font-medium">/{item.picked_quantity}</span>
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
    
    // 新功能狀態
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const [activeSessions, setActiveSessions] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [isFocusMode, setIsFocusMode] = useState(false); // 專注模式狀態

    const barcodeInputRef = useRef(null);
    // 移除對外部 mp3 的依賴，統一使用 WebAudio 產生提示音，避免 404 或自動播放限制
    useEffect(() => { barcodeInputRef.current?.focus(); }, [currentOrderData.order]);

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

        return () => {
            clearInterval(interval);
            socket.off('active_sessions_update');
            socket.off('new_comment');
        };
    }, [orderId, user.id]);

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
        else if ((user.role === 'packer' || user.role === 'admin') && status === 'packing') operationType = 'pack';
        
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 pb-20">
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
                {/* 頂部導航 */}
                <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 mb-6 transition-all">
                    <PageHeader
                        title={`📦 訂單作業 #${orderId}`}
                        description={currentOrderData.order ? `${currentOrderData.order.customer_name}（${currentOrderData.order.customer_code}）` : '載入中...'}
                        actions={
                            <Button variant="secondary" size="sm" onClick={handleReturnToTasks} leadingIcon={ArrowLeft} className="hover:bg-gray-100">
                                返回看板
                            </Button>
                        }
                        className="mb-0 p-0 border-0 shadow-none bg-transparent"
                    />
                </div>

                { (loading || !currentOrderData.order) && (
                  <Card className="mb-6 border-0 shadow-apple-sm"><CardContent className="p-6"><SkeletonText lines={4} /></CardContent></Card>
                )}
                
                { !(loading || !currentOrderData.order) && (
                  <ProgressDashboard 
                    stats={progressStats} 
                    onExport={handleExportReport} 
                    onVoid={handleVoidOrder} 
                    user={user}
                    onOpenCamera={() => setShowCameraScanner(true)}
                    activeSessions={activeSessions}
                    order={currentOrderData.order}
                    items={currentOrderData.items}
                    isFocusMode={isFocusMode}
                    toggleFocusMode={() => setIsFocusMode(!isFocusMode)}
                  />
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* 左側：掃描與討論 (在專注模式下隱藏討論) */}
                    <div className={`lg:col-span-1 space-y-6 ${isFocusMode ? 'hidden lg:block lg:opacity-50 lg:pointer-events-none' : ''}`}>
                        {/* 掃描區 */}
                        <Card className="sticky top-24 border-0 shadow-apple-md overflow-hidden animate-scale-in z-20">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500"></div>
                            <CardHeader className="flex items-center gap-3 pb-2">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm border border-blue-100">
                                    <ScanLine size={20}/>
                                </div>
                                <div>
                                    <CardTitle className="text-lg">掃描作業</CardTitle>
                                    <CardDescription>請掃描商品條碼或 SN 碼</CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="flex gap-2 mb-3">
                                    <div className="relative flex-1 group">
                                        <input
                                            ref={barcodeInputRef}
                                            type="text"
                                            placeholder="點擊此處開始掃描..."
                                            value={barcodeInput}
                                            onChange={(e) => setBarcodeInput(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            className={`w-full px-4 py-3 pr-11 rounded-xl border-2 bg-gray-50 text-base focus:outline-none transition-all ${
                                                scanError 
                                                    ? 'border-red-300 bg-red-50 animate-shake focus:border-red-400' 
                                                    : 'border-transparent focus:bg-white focus:border-blue-500 focus:shadow-lg focus:shadow-blue-500/10'
                                            }`}
                                        />
                                        <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                                    </div>
                                    <Button 
                                        onClick={handleClick} 
                                        disabled={isUpdating} 
                                        size="lg" 
                                        className={`px-6 rounded-xl shadow-lg shadow-blue-500/20 ${isUpdating ? 'opacity-80' : ''}`}
                                    >
                                        {isUpdating ? <Loader2 className="animate-spin" /> : <Check />}
                                    </Button>
                                </div>
                                
                                <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl flex items-start gap-3">
                                    <AlertTriangle size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                                    <div className="text-xs text-blue-700 leading-relaxed">
                                        <p className="font-bold mb-0.5">操作提示</p>
                                        <p>確認游標在輸入框內，掃描槍掃描後會自動送出。如遇錯誤請檢查輸入法。</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 討論區塊 */}
                        <Card className="border-0 shadow-apple-md animate-slide-up">
                            <CardHeader className="flex items-center gap-3 pb-2">
                                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shadow-sm border border-purple-100">
                                    <MessageSquare size={20}/>
                                </div>
                                <div>
                                    <CardTitle className="text-lg">團隊討論</CardTitle>
                                    <CardDescription>訂單相關備註與溝通</CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <TaskComments orderId={orderId} currentUser={user} allUsers={allUsers} />
                            </CardContent>
                        </Card>
                    </div>

                    {/* 右側：作業清單 */}
                    <div className={`${isFocusMode ? 'lg:col-span-3' : 'lg:col-span-2'} transition-all duration-500`}>
                        <Card className="border-0 shadow-apple-lg animate-scale-in bg-white/80 backdrop-blur-xl" style={{ animationDelay: '100ms' }}>
                            <CardHeader className="flex items-center justify-between border-b border-gray-100 pb-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-gray-900 text-white flex items-center justify-center shadow-lg shadow-gray-900/20">
                                        <Package size={24}/>
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">作業清單</CardTitle>
                                        <CardDescription>
                                            {isFocusMode ? '專注模式：僅顯示未完成項目' : '顯示所有訂單品項'}
                                        </CardDescription>
                                    </div>
                                </div>
                                {currentOrderData.order ? (
                                  <StatusBadge status={currentOrderData.order.status} />
                                ) : (
                                  <div className="w-24 h-8 rounded-full bg-gray-100 animate-pulse" />
                                )}
                            </CardHeader>
                            <CardContent className="pt-6">
                                {currentOrderData.order ? (
                                  <>
                                    {/* 訂單資訊摘要 */}
                                    <div className="flex flex-wrap gap-3 mb-6">
                                        <div className="px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-2 text-sm">
                                            <Package size={16} className="text-gray-400" />
                                            <span className="text-gray-500">單號：</span>
                                            <strong className="text-gray-900 font-mono">{currentOrderData.order.voucher_number}</strong>
                                        </div>
                                        <div className="px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-2 text-sm">
                                            <User size={16} className="text-gray-400" />
                                            <span className="text-gray-500">客戶：</span>
                                            <strong className="text-gray-900">{currentOrderData.order.customer_name}</strong>
                                        </div>
                                    </div>

                                    {scanError && (
                                        <div className="mb-6 p-4 rounded-2xl border border-red-200 bg-red-50 animate-shake flex items-center gap-4 shadow-sm">
                                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                                                <XCircle size={20} className="text-red-600"/>
                                            </div>
                                            <div>
                                                <p className="font-bold text-red-800">掃描錯誤</p>
                                                <p className="text-sm text-red-600">{scanError}</p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-4">
                                        {sortedItems.map((item, index) => {
                                            const itemInstances = currentOrderData.instances.filter(i => i.order_item_id === item.id);
                                            const hasSN = itemInstances.length > 0;
                                            return (
                                                <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}>
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
                                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                                <Check size={40} className="text-green-600" />
                                            </div>
                                            <h3 className="text-xl font-bold text-gray-900 mb-2">太棒了！</h3>
                                            <p className="text-gray-500">所有項目都已完成，您可以退出專注模式或返回看板。</p>
                                            <Button onClick={() => setIsFocusMode(false)} variant="secondary" className="mt-4">
                                                退出專注模式
                                            </Button>
                                        </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="space-y-6">
                                    <SkeletonText lines={2} className="h-20" />
                                    <SkeletonText lines={4} className="h-32" />
                                    <SkeletonText lines={4} className="h-32" />
                                  </div>
                                )}
                            </CardContent>
                        </Card>
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
            </div>
        </div>
    );
}
