import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Save, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/api';
import { Button } from '@/ui';

const DefectReportModal = ({ isOpen, onClose, orderId, voucherNumber, onSuccess }) => {
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [items, setItems] = useState([]);
    const [instances, setInstances] = useState([]);
    
    const [selectedItemId, setSelectedItemId] = useState('');
    const [oldSn, setOldSn] = useState('');
    const [newSn, setNewSn] = useState('');
    const [reason, setReason] = useState('');

    useEffect(() => {
        if (isOpen && orderId) {
            fetchOrderDetails();
            // Reset form
            setSelectedItemId('');
            setOldSn('');
            setNewSn('');
            setReason('');
        }
    }, [isOpen, orderId]);

    const fetchOrderDetails = async () => {
        try {
            setLoading(true);
            const res = await apiClient.get(`/api/orders/${orderId}`);
            setItems(res.data.items || []);
            setInstances(res.data.instances || []);
        } catch (error) {
            toast.error('無法載入訂單詳情');
            onClose();
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!oldSn || !newSn || !reason) {
            toast.error('請填寫所有欄位');
            return;
        }

        try {
            setSubmitting(true);
            await apiClient.post(`/api/orders/${orderId}/defect`, {
                oldSn,
                newSn,
                reason
            });
            toast.success('新品不良記錄已儲存，SN已更新');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            toast.error('提交失敗', {
                description: error.response?.data?.message || error.message
            });
        } finally {
            setSubmitting(false);
        }
    };

    // Filter instances based on selected item
    const availableInstances = instances.filter(inst => 
        !selectedItemId || inst.order_item_id === parseInt(selectedItemId)
    );

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-red-50">
                    <div className="flex items-center gap-2 text-red-600">
                        <AlertTriangle size={24} />
                        <h2 className="text-lg font-bold">新品不良 SN 更換</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-red-100 rounded-full text-gray-500 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                            <Loader2 size={32} className="animate-spin mb-2" />
                            <p>載入訂單資訊中...</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600 mb-4">
                                訂單編號: <span className="font-bold text-gray-900">{voucherNumber}</span>
                            </div>

                            {/* Product Selection */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">
                                    選擇產品 (可選)
                                </label>
                                <select
                                    value={selectedItemId}
                                    onChange={(e) => {
                                        setSelectedItemId(e.target.value);
                                        setOldSn(''); // Reset SN when product changes
                                    }}
                                    className="w-full rounded-xl border-gray-300 focus:border-red-500 focus:ring-red-500 text-gray-900 bg-white"
                                >
                                    <option value="" className="text-gray-500">-- 所有產品 --</option>
                                    {items.map(item => (
                                        <option key={item.id} value={item.id} className="text-gray-900">
                                            {item.product_name} ({item.product_code})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Old SN Selection */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">
                                    原 SN (不良品) <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={oldSn}
                                    onChange={(e) => setOldSn(e.target.value)}
                                    required
                                    className="w-full rounded-xl border-gray-300 focus:border-red-500 focus:ring-red-500 text-gray-900 bg-white"
                                >
                                    <option value="" className="text-gray-500">-- 請選擇原 SN --</option>
                                    {availableInstances.map(inst => (
                                        <option key={inst.id} value={inst.serial_number} className="text-gray-900">
                                            {inst.serial_number}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* New SN Input */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">
                                    新 SN (更換品) <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={newSn}
                                        onChange={(e) => setNewSn(e.target.value)}
                                        placeholder="掃描或輸入新 SN"
                                        required
                                        className="w-full rounded-xl border-gray-300 focus:border-red-500 focus:ring-red-500 pl-10 text-gray-900 bg-white placeholder:text-gray-400"
                                    />
                                    <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                </div>
                            </div>

                            {/* Reason */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">
                                    不良原因 <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="請詳細描述不良原因..."
                                    required
                                    rows={3}
                                    className="w-full rounded-xl border-gray-300 focus:border-red-500 focus:ring-red-500 text-gray-900 bg-white placeholder:text-gray-400"
                                />
                            </div>

                            <div className="pt-4 flex gap-3">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    className="flex-1"
                                    onClick={onClose}
                                >
                                    取消
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                                >
                                    {submitting ? (
                                        <Loader2 className="animate-spin mr-2" size={18} />
                                    ) : (
                                        <Save className="mr-2" size={18} />
                                    )}
                                    確認更換
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DefectReportModal;
