import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { 
    Loader2, ArrowLeft, Check, ScanLine, Barcode, Tag, Package, 
    Plus, Minus, FileDown, XCircle, User, AlertTriangle, ChevronDown,
    ChevronUp, ShoppingCart, Box, Camera, MessageSquare, Printer, Users
} from 'lucide-react';
import { PageHeader, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, SkeletonText } from '@/ui';
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
        <div className="relative overflow-hidden rounded-2xl bg-white/70 backdrop-blur-2xl border border-gray-200/30 shadow-2xl mb-6 animate-fade-in">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-purple-50/20"></div>
            <div className="relative z-10 p-6">
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="w-full sm:w-auto">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center shadow-sm">
                                    <Package className="text-white" size={20} />
                                </div>
                                <h2 className="text-xl font-semibold text-gray-900">
                                    任務總覽
                                </h2>
                            </div>
                            {/* 即時協作指示器 */}
                            {activeSessions.length > 0 && (
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-50/80 border border-green-200/50">
                                    <Users size={14} className="text-green-600" />
                                    <span className="text-xs text-green-700 font-medium truncate">
                                        {activeSessions.map(s => s.name).join(', ')} 正在查看
                                    </span>
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                            {/* 相機掃描按鈕 */}
                            <button 
                                onClick={onOpenCamera}
                                className="px-4 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium transition-all duration-200 hover:shadow-md active:scale-95 flex items-center gap-2"
                            >
                                <Camera size={16} />
                                <span className="hidden sm:inline">相機掃描</span>
                                <span className="sm:hidden">相機</span>
                            </button>
                            
                            {/* 列印標籤 */}
                            <ShippingLabel order={order} items={items} />
                            <PickingList order={order} items={items} />
                            
                            {/* 匯出報告 */}
                            <button 
                                onClick={onExport} 
                                className="px-4 py-2 rounded-lg bg-white hover:bg-gray-50 text-gray-900 text-sm font-medium border border-gray-200 transition-all duration-200 hover:shadow-md active:scale-95 flex items-center gap-2"
                            >
                                <FileDown size={16} />
                                <span className="hidden sm:inline">匯出</span>
                            </button>
                            
                            {/* 作廢訂單 */}
                            {user.role === 'admin' && (
                                <button 
                                    onClick={onVoid} 
                                    className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-all duration-200 hover:shadow-md active:scale-95 flex items-center gap-2"
                                >
                                    <XCircle size={16} />
                                    <span className="hidden sm:inline">作廢</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* SKU Progress - 藍色（核心關注） */}
                    <div className="group relative overflow-hidden bg-white/60 backdrop-blur-2xl p-6 rounded-2xl border border-blue-200/40 hover:border-blue-300/60 transition-all duration-500 hover:shadow-2xl hover:shadow-blue-500/10 animate-scale-in" style={{ animationDelay: '100ms' }}>
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-transparent to-blue-100/30 opacity-60"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">SKU 進度</p>
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                                    <Package className="text-white" size={18} />
                                </div>
                            </div>
                            <p className="text-3xl font-bold text-blue-600 mb-2">{stats.packedSkus}<span className="text-lg text-blue-400/70">/{stats.totalSkus}</span></p>
                            <ProgressBar value={stats.packedSkus} max={stats.totalSkus} colorClass="bg-gradient-to-r from-blue-500 to-blue-600" />
                            <p className="text-xs text-blue-500 font-semibold mt-2">{completionPercentage.toFixed(0)}% 完成</p>
                        </div>
                    </div>

                    {/* Total Quantity - 灰色（基礎資訊） */}
                    <div className="group relative overflow-hidden bg-white/60 backdrop-blur-2xl p-6 rounded-2xl border border-gray-200/40 hover:border-gray-300/60 transition-all duration-500 hover:shadow-2xl animate-scale-in" style={{ animationDelay: '200ms' }}>
                        <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 via-transparent to-gray-100/30 opacity-60"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-gray-600 font-semibold uppercase tracking-wide">總數量</p>
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center shadow-lg shadow-gray-500/20">
                                    <Box className="text-white" size={18} />
                                </div>
                            </div>
                            <p className="text-3xl font-bold text-gray-800">{stats.totalQuantity}</p>
                            <p className="text-xs text-gray-500 font-semibold mt-4">件商品</p>
                        </div>
                    </div>

                    {/* Picked Quantity - 橙色（進行中） */}
                    <div className="group relative overflow-hidden bg-white/60 backdrop-blur-2xl p-6 rounded-2xl border border-orange-200/40 hover:border-orange-300/60 transition-all duration-500 hover:shadow-2xl hover:shadow-orange-500/10 animate-scale-in" style={{ animationDelay: '300ms' }}>
                        <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-transparent to-orange-100/30 opacity-60"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-orange-600 font-semibold uppercase tracking-wide">已揀貨</p>
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
                                    <ShoppingCart className="text-white" size={18} />
                                </div>
                            </div>
                            <p className="text-3xl font-bold text-orange-600 mb-2">{stats.totalPickedQty}</p>
                            <ProgressBar value={stats.totalPickedQty} max={stats.totalQuantity} colorClass="bg-gradient-to-r from-orange-500 to-orange-600" />
                            <p className="text-xs text-orange-500 font-semibold mt-2">{stats.totalQuantity > 0 ? ((stats.totalPickedQty / stats.totalQuantity) * 100).toFixed(0) : 0}% 完成</p>
                        </div>
                    </div>

                    {/* Packed Quantity - 綠色（已完成） */}
                    <div className="group relative overflow-hidden bg-white/60 backdrop-blur-2xl p-6 rounded-2xl border border-green-200/40 hover:border-green-300/60 transition-all duration-500 hover:shadow-2xl hover:shadow-green-500/10 animate-scale-in" style={{ animationDelay: '400ms' }}>
                        <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 via-transparent to-green-100/30 opacity-60"></div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-green-600 font-semibold uppercase tracking-wide">已裝箱</p>
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/30">
                                    <Check className="text-white" size={18} />
                                </div>
                            </div>
                            <p className="text-3xl font-bold text-green-600 mb-2">{stats.totalPackedQty}</p>
                            <ProgressBar value={stats.totalPackedQty} max={stats.totalQuantity} colorClass="bg-gradient-to-r from-green-500 to-green-600" />
                            <p className="text-xs text-green-500 font-semibold mt-2">{stats.totalQuantity > 0 ? ((stats.totalPackedQty / stats.totalQuantity) * 100).toFixed(0) : 0}% 完成</p>
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
        <div className="min-h-screen bg-secondary">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
                <PageHeader
                  title={`📦 訂單作業 #${orderId}`}
                  description={currentOrderData.order ? `${currentOrderData.order.customer_name}（${currentOrderData.order.customer_code}）` : '載入中...'}
                  actions={<Button variant="secondary" size="sm" onClick={handleReturnToTasks} leadingIcon={ArrowLeft}>返回看板</Button>}
                />
                { (loading || !currentOrderData.order) && (
                  <Card className="mb-6"><CardContent><SkeletonText lines={4} /></CardContent></Card>
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
                  />
                )}

            {/* 討論區塊 */}
            <Card className="mb-6 animate-slide-up">
              <CardHeader className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center shadow-sm"><MessageSquare className="text-white" size={20}/></div>
                <CardTitle className="text-lg">團隊討論</CardTitle>
              </CardHeader>
              <CardContent>
                <TaskComments orderId={orderId} currentUser={user} allUsers={allUsers} />
              </CardContent>
            </Card>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
                {/* 掃描區 */}
                                <div className="lg:col-span-1">
                                    <Card className="sticky top-8 animate-scale-in">
                                        <CardHeader className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm"><ScanLine className="text-white" size={20}/></div>
                                            <CardTitle className="text-lg">掃描區</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="flex gap-2 mb-3">
                                                <div className="relative flex-1">
                                                    <input
                                                        ref={barcodeInputRef}
                                                        type="text"
                                                        placeholder="掃描 SN 碼或條碼..."
                                                        value={barcodeInput}
                                                        onChange={(e) => setBarcodeInput(e.target.value)}
                                                        onKeyDown={handleKeyDown}
                                                        className={`w-full px-4 py-2.5 pr-11 rounded-xl border bg-white text-sm focus:outline-none focus:ring-2 transition-all ${scanError ? 'border-red-300 ring-red-200 bg-red-50 animate-shake' : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'}`}
                                                    />
                                                    <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                                </div>
                                                <Button onClick={handleClick} disabled={isUpdating} size="sm" leadingIcon={isUpdating ? Loader2 : Check}>
                                                    {isUpdating ? '處理中' : '確認'}
                                                </Button>
                                            </div>
                                            <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg">
                                                <p className="text-xs text-blue-600 flex items-center gap-2">
                                                    <AlertTriangle size={12} className="flex-shrink-0" />
                                                    <span>掃描後按 Enter 或點擊確認</span>
                                                </p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>

                {/* 作業清單 */}
                <div className="lg:col-span-2">
                    <Card className="animate-scale-in" style={{ animationDelay: '100ms' }}>
                        <CardHeader className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center"><Package className="text-white" size={20}/></div>
                                <CardTitle className="text-lg">作業清單</CardTitle>
                            </div>
                            {currentOrderData.order ? (
                              <StatusBadge status={currentOrderData.order.status} />
                            ) : (
                              <div className="w-24 h-6 rounded-xl bg-gray-200 animate-pulse" />
                            )}
                        </CardHeader>
                        <CardContent>
                            {currentOrderData.order ? (
                              <>
                                <div className="flex items-center flex-wrap gap-4 text-sm p-4 bg-gray-50 rounded-xl border border-gray-200 mb-6">
                                    <span className="flex items-center gap-2 text-gray-600"><Package size={16} className="text-gray-400" />單號: <strong className="text-gray-900 truncate">{currentOrderData.order.voucher_number}</strong></span>
                                    <span className="flex items-center gap-2 text-gray-600"><User size={16} className="text-gray-400" />客戶: <strong className="text-gray-900 truncate">{currentOrderData.order.customer_name}</strong></span>
                                </div>
                                {scanError && (
                                    <div className="mb-6 p-5 rounded-xl border border-red-300 bg-red-50 animate-fade-in">
                                        <p className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-2"><XCircle size={16}/>掃描錯誤</p>
                                        <p className="text-sm text-red-600">{scanError}</p>
                                    </div>
                                )}
                                <div className="space-y-4">
                                    {sortedItems.map((item, index) => {
                                        const itemInstances = currentOrderData.instances.filter(i => i.order_item_id === item.id);
                                        const hasSN = itemInstances.length > 0;
                                        return (
                                            <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${index * 40}ms` }}>
                                                {hasSN ? (
                                                    <SNItemCard item={item} instances={itemInstances} />
                                                ) : (
                                                    <QuantityItemCard item={item} onUpdate={updateItemState} user={user} orderStatus={currentOrderData.order?.status} isUpdating={isUpdating} />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {sortedItems.length === 0 && !loading && (
                                    <EmptyState title="尚無品項" description="此訂單目前沒有可處理的品項" />
                                )}
                              </>
                            ) : (
                              <div className="space-y-4">
                                <SkeletonText lines={3} />
                                <SkeletonText lines={4} />
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
