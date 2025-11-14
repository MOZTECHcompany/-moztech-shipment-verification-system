import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { 
    Loader2, ArrowLeft, Check, ScanLine, Barcode, Tag, Package, 
    Plus, Minus, FileDown, XCircle, User, AlertTriangle, ChevronDown,
    ChevronUp, ShoppingCart, Box, Camera, MessageSquare, Printer, Users
} from 'lucide-react';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import apiClient from '../api/api';
import { socket } from '../api/socket';
import { soundNotification } from '../utils/soundNotification';
import { voiceNotification } from '../utils/voiceNotification';
import { desktopNotification } from '../utils/desktopNotification';
import { CameraScanner } from './CameraScanner';
import { TaskComments } from './TaskComments';
import { ShippingLabel, PickingList } from './LabelPrinter';

// --- 小型组件 ---
const ProgressBar = ({ value, max, colorClass = "bg-blue-500" }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return (
        <div className="w-full bg-gray-200/50 rounded-full h-1.5 mt-1.5 overflow-hidden">
            <div className={`${colorClass} h-full rounded-full transition-all duration-500 shadow-sm`} style={{ width: `${Math.min(percentage, 100)}%` }} />
        </div>
    );
};

const QuantityButton = ({ icon: Icon, onClick, disabled, isUpdating }) => (
    <button onClick={onClick} disabled={disabled || isUpdating} 
        className="p-2 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 hover:from-blue-50 hover:to-blue-100 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-md active:scale-95">
        <Icon size={16} className="text-gray-700" />
    </button>
);

const StatusBadge = ({ status }) => {
    const statusStyles = {
        pending: { color: 'text-gray-600', bg: 'bg-gray-100 border-gray-300', label: '待處理', icon: Package },
        picking: { color: 'text-blue-600', bg: 'bg-blue-50 border-blue-300', label: '揀貨中', icon: ShoppingCart },
        packing: { color: 'text-green-600', bg: 'bg-green-50 border-green-300', label: '裝箱中', icon: Box },
        completed: { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-300', label: '已完成', icon: Check },
        void: { color: 'text-red-600', bg: 'bg-red-50 border-red-300', label: '已作廢', icon: XCircle }
    };
    const style = statusStyles[status] || statusStyles.pending;
    const Icon = style.icon;
    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${style.bg} ${style.color} text-xs font-medium shadow-sm`}>
            <Icon size={14} />
            {style.label}
        </span>
    );
};

// --- 进度仪表板 ---
const ProgressDashboard = ({ stats, onExport, onVoid, user, onOpenCamera, activeSessions, order, items }) => {
    const completionPercentage = stats.totalSkus > 0 ? (stats.packedSkus / stats.totalSkus) * 100 : 0;
    
    return (
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/90 via-blue-50/50 to-purple-50/50 backdrop-blur-xl border border-white/60 shadow-2xl mb-6 animate-fade-in">
            {/* 背景裝飾 */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-400/10 to-purple-400/10 rounded-full blur-3xl -z-10"></div>
            <div className="absolute bottom-0 left-0 w-72 h-72 bg-gradient-to-tr from-pink-400/10 to-orange-400/10 rounded-full blur-3xl -z-10"></div>
            
            <div className="p-6">
                <div className="flex flex-col gap-4 mb-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="w-full sm:w-auto">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                                    <Package className="text-white" size={24} />
                                </div>
                                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                                    任務總覽
                                </h2>
                            </div>
                            {/* 即時協作指示器 */}
                            {activeSessions.length > 0 && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/50 animate-pulse-slow">
                                    <Users size={14} className="text-green-600 flex-shrink-0" />
                                    <span className="text-sm text-green-700 font-medium truncate">
                                        {activeSessions.map(s => s.name).join(', ')} 正在查看
                                    </span>
                                    <span className="w-2 h-2 bg-green-500 rounded-full animate-ping flex-shrink-0"></span>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                            {/* 相機掃描按鈕 */}
                            <button 
                                onClick={onOpenCamera}
                                className="relative overflow-hidden group px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                                <div className="relative flex items-center gap-2">
                                    <Camera size={18} className="drop-shadow-lg" />
                                    <span className="hidden sm:inline">相機掃描</span>
                                    <span className="sm:hidden">相機</span>
                                </div>
                            </button>
                            
                            {/* 列印標籤 */}
                            <ShippingLabel order={order} items={items} />
                            <PickingList order={order} items={items} />
                            
                            {/* 匯出報告 */}
                            <button 
                                onClick={onExport} 
                                className="relative overflow-hidden group px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                                <div className="relative flex items-center gap-2">
                                    <FileDown size={18} className="drop-shadow-lg" />
                                    <span className="hidden sm:inline">匯出</span>
                                </div>
                            </button>
                            
                            {/* 作廢訂單 */}
                            {user.role === 'admin' && (
                                <button 
                                    onClick={onVoid} 
                                    className="relative overflow-hidden group px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-pink-600 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                                    <div className="relative flex items-center gap-2">
                                        <XCircle size={18} className="drop-shadow-lg" />
                                        <span className="hidden sm:inline">作廢</span>
                                    </div>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* SKU Progress */}
                    <div className="group relative overflow-hidden bg-gradient-to-br from-purple-500/90 to-purple-600/90 p-5 rounded-2xl border border-purple-400/30 shadow-xl hover:shadow-2xl transition-all duration-500 hover:scale-105 animate-scale-in cursor-pointer" style={{ animationDelay: '100ms' }}>
                        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm text-purple-100 font-semibold">SKU 進度</p>
                                <div className="p-2 rounded-lg bg-white/20 backdrop-blur-sm">
                                    <Package className="text-white drop-shadow-lg" size={20} />
                                </div>
                            </div>
                            <p className="text-4xl font-black text-white mb-2 drop-shadow-lg">{stats.packedSkus}<span className="text-2xl text-purple-200">/{stats.totalSkus}</span></p>
                            <ProgressBar value={stats.packedSkus} max={stats.totalSkus} colorClass="bg-white/90 shadow-lg" />
                            <p className="text-sm text-purple-100 font-medium mt-2">{completionPercentage.toFixed(0)}% 完成</p>
                        </div>
                    </div>

                    {/* Total Quantity */}
                    <div className="group relative overflow-hidden bg-gradient-to-br from-blue-500/90 to-blue-600/90 p-5 rounded-2xl border border-blue-400/30 shadow-xl hover:shadow-2xl transition-all duration-500 hover:scale-105 animate-scale-in cursor-pointer" style={{ animationDelay: '200ms' }}>
                        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm text-blue-100 font-semibold">總數量</p>
                                <div className="p-2 rounded-lg bg-white/20 backdrop-blur-sm">
                                    <Box className="text-white drop-shadow-lg" size={20} />
                                </div>
                            </div>
                            <p className="text-4xl font-black text-white drop-shadow-lg">{stats.totalQuantity}</p>
                            <p className="text-sm text-blue-100 font-medium mt-4">件商品</p>
                        </div>
                    </div>

                    {/* Picked Quantity */}
                    <div className="group relative overflow-hidden bg-gradient-to-br from-cyan-500/90 to-cyan-600/90 p-5 rounded-2xl border border-cyan-400/30 shadow-xl hover:shadow-2xl transition-all duration-500 hover:scale-105 animate-scale-in cursor-pointer" style={{ animationDelay: '300ms' }}>
                        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm text-cyan-100 font-semibold">已揀貨</p>
                                <div className="p-2 rounded-lg bg-white/20 backdrop-blur-sm">
                                    <ShoppingCart className="text-white drop-shadow-lg" size={20} />
                                </div>
                            </div>
                            <p className="text-4xl font-black text-white mb-2 drop-shadow-lg">{stats.totalPickedQty}</p>
                            <ProgressBar value={stats.totalPickedQty} max={stats.totalQuantity} colorClass="bg-white/90 shadow-lg" />
                            <p className="text-sm text-cyan-100 font-medium mt-2">{stats.totalQuantity > 0 ? ((stats.totalPickedQty / stats.totalQuantity) * 100).toFixed(0) : 0}% 完成</p>
                        </div>
                    </div>

                    {/* Packed Quantity */}
                    <div className="group relative overflow-hidden bg-gradient-to-br from-green-500/90 to-emerald-600/90 p-5 rounded-2xl border border-green-400/30 shadow-xl hover:shadow-2xl transition-all duration-500 hover:scale-105 animate-scale-in cursor-pointer" style={{ animationDelay: '400ms' }}>
                        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm text-green-100 font-semibold">已裝箱</p>
                                <div className="p-2 rounded-lg bg-white/20 backdrop-blur-sm">
                                    <Check className="text-white drop-shadow-lg" size={20} />
                                </div>
                            </div>
                            <p className="text-4xl font-black text-white mb-2 drop-shadow-lg">{stats.totalPackedQty}</p>
                            <ProgressBar value={stats.totalPackedQty} max={stats.totalQuantity} colorClass="bg-white/90 shadow-lg" />
                            <p className="text-sm text-green-100 font-medium mt-2">{stats.totalQuantity > 0 ? ((stats.totalPackedQty / stats.totalQuantity) * 100).toFixed(0) : 0}% 完成</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- SN模式的品项卡片 ---
const SNItemCard = ({ item, instances }) => {
    const [expanded, setExpanded] = useState(false);
    
    const pickedCount = instances.filter(i => i.status === 'picked' || i.status === 'packed').length;
    const packedCount = instances.filter(i => i.status === 'packed').length;
    const isComplete = packedCount >= item.quantity;
    
    return (
        <div className={`glass border rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-apple-lg ${isComplete ? 'border-green-300 bg-gradient-to-br from-green-50/50 to-emerald-50/50' : 'border-gray-200'}`}>
            <div className="p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <p className="font-bold text-lg text-gray-900">{item.product_name}</p>
                            {isComplete && <Check className="text-green-600" size={20} />}
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-sm text-gray-600 font-mono flex items-center gap-2">
                                <Tag size={14} className="text-gray-400"/>
                                {item.product_code}
                            </p>
                            <p className="text-sm text-blue-600 font-mono flex items-center gap-2">
                                <Barcode size={14} className="text-blue-400"/>
                                {item.barcode}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex gap-3">
                        <div className="text-center bg-gradient-to-br from-blue-50 to-blue-100 px-4 py-3 rounded-xl border border-blue-200 shadow-sm">
                            <p className="text-xs text-blue-700 font-medium mb-1">揀貨</p>
                            <p className="text-2xl font-bold text-blue-600">{pickedCount}</p>
                            <p className="text-xs text-gray-500">/{item.quantity}</p>
                            <ProgressBar value={pickedCount} max={item.quantity} colorClass="bg-gradient-to-r from-blue-500 to-blue-600" />
                        </div>
                        <div className="text-center bg-gradient-to-br from-green-50 to-green-100 px-4 py-3 rounded-xl border border-green-200 shadow-sm">
                            <p className="text-xs text-green-700 font-medium mb-1">裝箱</p>
                            <p className="text-2xl font-bold text-green-600">{packedCount}</p>
                            <p className="text-xs text-gray-500">/{item.quantity}</p>
                            <ProgressBar value={packedCount} max={item.quantity} colorClass="bg-gradient-to-r from-green-500 to-green-600" />
                        </div>
                    </div>
                </div>
                
                {instances.length > 0 && (
                    <button onClick={() => setExpanded(!expanded)} 
                        className="w-full flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-blue-600 font-medium py-2 px-4 rounded-xl hover:bg-blue-50 transition-all duration-200">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {expanded ? '收起' : '查看'} SN 列表 ({instances.length})
                    </button>
                )}
            </div>
            
            {expanded && instances.length > 0 && (
                <div className="border-t border-gray-200 bg-gray-50/50 p-4 animate-slide-up">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-2 scrollbar-thin">
                        {instances.map((inst, idx) => (
                            <div key={idx} 
                                className={`p-3 rounded-xl text-sm font-mono border transition-all duration-200 hover:shadow-md ${
                                    inst.status === 'packed' 
                                        ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-300 text-green-800' 
                                        : inst.status === 'picked' 
                                            ? 'bg-gradient-to-br from-blue-50 to-blue-100 border-blue-300 text-blue-800' 
                                            : 'bg-white border-gray-300 text-gray-700'
                                }`}>
                                <div className="flex items-center justify-between">
                                    <span className="break-all">{inst.serial_number}</span>
                                    {inst.status === 'packed' && <Check size={16} className="text-green-600 ml-2 flex-shrink-0" />}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- 数量模式的品项卡片 ---
const QuantityItemCard = ({ item, onUpdate, user, orderStatus, isUpdating }) => {
    const canAdjustPick = (user.role === 'picker' || user.role === 'admin') && orderStatus === 'picking';
    const canAdjustPack = (user.role === 'packer' || user.role === 'admin') && orderStatus === 'packing';
    const isComplete = item.packed_quantity >= item.quantity;
    
    return (
        <div className={`glass border rounded-2xl p-5 hover:shadow-apple-lg transition-all duration-300 ${isComplete ? 'border-green-300 bg-gradient-to-br from-green-50/50 to-emerald-50/50' : 'border-gray-200'}`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <p className="font-bold text-lg text-gray-900">{item.product_name}</p>
                        {isComplete && <Check className="text-green-600" size={20} />}
                    </div>
                    <div className="space-y-1.5">
                        <p className="text-sm text-gray-600 font-mono flex items-center gap-2">
                            <Tag size={14} className="text-gray-400"/>
                            {item.product_code}
                        </p>
                        <p className="text-sm text-blue-600 font-mono flex items-center gap-2">
                            <Barcode size={14} className="text-blue-400"/>
                            {item.barcode}
                        </p>
                    </div>
                </div>
                
                <div className="w-full sm:w-auto flex items-center gap-3">
                    {/* Pick Controls */}
                    <div className="flex items-center gap-2 bg-gradient-to-br from-blue-50 to-blue-100 px-3 py-2 rounded-xl border border-blue-200 shadow-sm">
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pick', -1)} 
                            disabled={!canAdjustPick || item.picked_quantity <= 0} isUpdating={isUpdating} />
                        <div className="flex-1 text-center min-w-[80px]">
                            <p className='text-xs text-blue-700 font-medium mb-1'>揀貨</p>
                            <div className="flex items-baseline justify-center gap-1">
                                <span className="font-bold text-xl text-blue-600">{item.picked_quantity}</span>
                                <span className="text-sm text-gray-500">/{item.quantity}</span>
                            </div>
                            <ProgressBar value={item.picked_quantity} max={item.quantity} colorClass="bg-gradient-to-r from-blue-500 to-blue-600" />
                        </div>
                        <QuantityButton icon={Plus} onClick={() => onUpdate(item.barcode, 'pick', 1)} 
                            disabled={!canAdjustPick || item.picked_quantity >= item.quantity} isUpdating={isUpdating} />
                    </div>
                    
                    {/* Pack Controls */}
                    <div className="flex items-center gap-2 bg-gradient-to-br from-green-50 to-green-100 px-3 py-2 rounded-xl border border-green-200 shadow-sm">
                        <QuantityButton icon={Minus} onClick={() => onUpdate(item.barcode, 'pack', -1)} 
                            disabled={!canAdjustPack || item.packed_quantity <= 0} isUpdating={isUpdating} />
                        <div className="flex-1 text-center min-w-[80px]">
                            <p className='text-xs text-green-700 font-medium mb-1'>裝箱</p>
                            <div className="flex items-baseline justify-center gap-1">
                                <span className="font-bold text-xl text-green-600">{item.packed_quantity}</span>
                                <span className="text-sm text-gray-500">/{item.picked_quantity}</span>
                            </div>
                            <ProgressBar value={item.packed_quantity} max={item.picked_quantity} colorClass="bg-gradient-to-r from-green-500 to-green-600" />
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

        const { status } = currentOrderData.order;
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

    if (loading || !currentOrderData.order) {
        return (
            <div className="flex flex-col justify-center items-center h-screen bg-gradient-to-br from-blue-50 to-purple-50">
                <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
                <p className="text-gray-600 font-medium">載入訂單資料中...</p>
            </div>
        );
    }

    return (
        <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 bg-gradient-to-br from-gray-50 to-blue-50/30 min-h-screen">
            {/* Header */}
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-6 sm:mb-8 animate-fade-in">
                <button onClick={handleReturnToTasks} 
                    className="flex items-center gap-2 text-gray-600 hover:text-blue-600 font-semibold px-3 sm:px-4 py-2 rounded-xl hover:bg-white/80 transition-all duration-200 hover:shadow-md group text-sm sm:text-base">
                    <ArrowLeft className="group-hover:-translate-x-1 transition-transform duration-200" size={18} />
                    <span className="hidden xs:inline">返回任務列表</span>
                    <span className="xs:hidden">返回</span>
                </button>
                <div className="text-left sm:text-right w-full sm:w-auto">
                    <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-1">
                        作業詳情
                    </h1>
                    <p className="text-sm sm:text-base text-gray-600 flex items-center gap-2 justify-start sm:justify-end">
                        <User size={14} className="sm:hidden" />
                        <User size={16} className="hidden sm:block" />
                        <span className="truncate max-w-[200px] sm:max-w-none">操作員: <span className="font-semibold text-gray-800">{user.name || user.username}</span></span>
                    </p>
                </div>
            </header>

            <ProgressDashboard 
                stats={progressStats} 
                onExport={handleExportReport} 
                onVoid={handleVoidOrder} 
                user={user}
                onOpenCamera={() => setShowCameraScanner(true)}
                activeSessions={activeSessions}
                order={currentOrderData.order}
                items={currentOrderData.items}
            />

            {/* 討論區塊 - 永久顯示並美化 */}
            <div className="mb-6 animate-slide-up">
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/90 via-indigo-50/50 to-purple-50/50 backdrop-blur-xl border border-white/60 shadow-2xl">
                    {/* 背景裝飾 */}
                    <div className="absolute top-0 left-0 w-96 h-96 bg-gradient-to-br from-indigo-400/10 to-purple-400/10 rounded-full blur-3xl -z-10"></div>
                    <div className="absolute bottom-0 right-0 w-72 h-72 bg-gradient-to-tl from-pink-400/10 to-blue-400/10 rounded-full blur-3xl -z-10"></div>
                    
                    <div className="p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
                                <MessageSquare className="text-white" size={24} />
                            </div>
                            <h2 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                                團隊討論
                            </h2>
                        </div>
                        <TaskComments 
                            orderId={orderId}
                            currentUser={user}
                            allUsers={allUsers}
                        />
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">{/* Scan Area */}
                <div className="lg:col-span-1">
                    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/90 via-blue-50/50 to-cyan-50/50 backdrop-blur-xl border border-white/60 shadow-2xl p-6 sticky top-8 animate-scale-in">
                        {/* 背景裝飾 */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-400/10 to-cyan-400/10 rounded-full blur-3xl -z-10"></div>
                        
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 shadow-lg">
                                <ScanLine className="text-white" size={20}/>
                            </div>
                            <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                                掃描區
                            </h2>
                        </div>
                        <div className="flex gap-3">
                            <div className="relative flex-1">
                                <input
                                    ref={barcodeInputRef}
                                    type="text"
                                    placeholder="掃描 SN 碼或條碼..."
                                    value={barcodeInput}
                                    onChange={(e) => setBarcodeInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    className={`w-full px-4 py-3 pr-12 rounded-xl border-2 bg-white/80 backdrop-blur-sm text-base font-medium focus:outline-none focus:ring-4 transition-all duration-300 ${
                                        scanError 
                                            ? 'border-red-500 ring-red-300 bg-red-50 animate-shake' 
                                            : 'border-blue-200 focus:border-blue-500 focus:ring-blue-200'
                                    }`}
                                />
                                <Barcode className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            </div>
                            <button onClick={handleClick} disabled={isUpdating} 
                                className="relative overflow-hidden group px-6 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600 text-white font-bold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
                                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                                <div className="relative">
                                    {isUpdating ? <Loader2 className="animate-spin" size={20} /> : '確認'}
                                </div>
                            </button>
                        </div>
                        
                        <div className="mt-4 p-3 bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-xl">
                            <p className="text-xs text-blue-700 font-medium flex items-center gap-2">
                                <AlertTriangle size={14} className="flex-shrink-0" />
                                <span>提示：掃描後按 Enter 或點擊確認按鈕</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Items List */}
                <div className="lg:col-span-2">
                    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/90 via-purple-50/50 to-pink-50/50 backdrop-blur-xl border border-white/60 shadow-2xl p-6 min-h-full animate-scale-in" style={{ animationDelay: '100ms' }}>
                        {/* 背景裝飾 */}
                        <div className="absolute top-0 left-0 w-96 h-96 bg-gradient-to-br from-purple-400/10 to-pink-400/10 rounded-full blur-3xl -z-10"></div>
                        
                        {scanError && (
                            <div className="absolute inset-0 bg-gradient-to-br from-red-500/95 via-red-600/95 to-red-700/95 backdrop-blur-xl flex flex-col justify-center items-center z-10 rounded-3xl animate-fade-in p-4">
                                <div className="bg-white rounded-full p-8 mb-6 shadow-2xl animate-bounce-slow">
                                    <XCircle className="text-red-600 h-24 w-24 animate-pulse" strokeWidth={3} />
                                </div>
                                <div className="bg-white/90 rounded-2xl px-8 py-6 shadow-2xl max-w-md">
                                    <p className="text-3xl font-black text-red-600 text-center mb-2 animate-pulse">⚠️ 錯誤！</p>
                                    <p className="text-xl font-bold text-gray-800 text-center">{scanError}</p>
                                </div>
                            </div>
                        )}
                        
                        <div className="mb-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg">
                                        <Package className="text-white" size={20} />
                                    </div>
                                    <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">作業清單</h2>
                                </div>
                                <StatusBadge status={currentOrderData.order.status} />
                            </div>
                            <div className="flex items-center flex-wrap gap-4 text-sm p-4 bg-gradient-to-r from-purple-50 via-pink-50 to-orange-50 rounded-xl border border-purple-200/50 shadow-sm">
                                <span className="flex items-center gap-2 font-semibold text-purple-700">
                                    <Package size={16} className="text-purple-500 flex-shrink-0" />
                                    單號: <strong className="text-purple-900 truncate">{currentOrderData.order.voucher_number}</strong>
                                </span>
                                <span className="flex items-center gap-2 font-semibold text-pink-700">
                                    <User size={16} className="text-pink-500 flex-shrink-0" />
                                    客戶: <strong className="text-pink-900 truncate">{currentOrderData.order.customer_name}</strong>
                                </span>
                            </div>
                        </div>
                        
                        <div className="space-y-3 sm:space-y-4">
                            {sortedItems.map((item, index) => {
                                const itemInstances = currentOrderData.instances.filter(i => i.order_item_id === item.id);
                                const hasSN = itemInstances.length > 0;

                                return (
                                    <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                                        {hasSN ? (
                                            <SNItemCard item={item} instances={itemInstances} />
                                        ) : (
                                            <QuantityItemCard item={item} onUpdate={updateItemState} user={user} 
                                                orderStatus={currentOrderData.order.status} isUpdating={isUpdating} />
                                        )}
                                    </div>
                                );
                            })}
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
        </div>
    );
}
