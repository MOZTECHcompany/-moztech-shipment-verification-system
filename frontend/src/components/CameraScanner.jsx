// frontend/src/components/CameraScanner.jsx
// 相機條碼掃描組件 - 支援多種條碼格式

import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { Camera, X, Zap, AlertCircle, CheckCircle, Scan } from 'lucide-react';
import { toast } from 'sonner';
import { soundNotification } from '@/utils/soundNotification';

export function CameraScanner({ onScan, onClose, mode = 'single' }) {
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState(null);
    const [lastScanned, setLastScanned] = useState(null);
    const [scannedCodes, setScannedCodes] = useState([]);
    const [cameraDevices, setCameraDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState(null);
    
    const videoRef = useRef(null);
    const codeReaderRef = useRef(null);
    const scanTimeoutRef = useRef(null);

    useEffect(() => {
        initializeScanner();
        return () => {
            stopScanning();
        };
    }, []);

    const initializeScanner = async () => {
        try {
            codeReaderRef.current = new BrowserMultiFormatReader();
            
            // 獲取可用的相機設備
            const devices = await codeReaderRef.current.listVideoInputDevices();
            setCameraDevices(devices);
            
            if (devices.length > 0) {
                // 優先選擇後置相機
                const backCamera = devices.find(device => 
                    device.label.toLowerCase().includes('back') || 
                    device.label.toLowerCase().includes('rear')
                ) || devices[0];
                
                setSelectedDevice(backCamera.deviceId);
                startScanning(backCamera.deviceId);
            } else {
                setError('未找到可用的相機設備');
            }
        } catch (err) {
            console.error('初始化掃描器失敗:', err);
            setError('無法訪問相機。請確認已授予相機權限。');
        }
    };

    const startScanning = async (deviceId) => {
        if (!videoRef.current || !codeReaderRef.current) return;
        
        try {
            setIsScanning(true);
            setError(null);
            
            await codeReaderRef.current.decodeFromVideoDevice(
                deviceId,
                videoRef.current,
                (result, err) => {
                    if (result) {
                        handleScanResult(result.getText());
                    }
                    
                    if (err && !(err instanceof NotFoundException)) {
                        console.error('掃描錯誤:', err);
                    }
                }
            );
        } catch (err) {
            console.error('啟動掃描失敗:', err);
            setError('啟動掃描失敗');
            setIsScanning(false);
        }
    };

    const handleScanResult = (code) => {
        // 防止重複掃描（0.5秒內的重複條碼會被忽略）
        if (lastScanned === code && scanTimeoutRef.current) {
            return;
        }

        // 批次掃描模式：檢查是否已掃描過
        if (mode === 'batch' && scannedCodes.includes(code)) {
            // 重複條碼音效
            soundNotification.play('warning');
            toast.warning('重複掃描', { description: `條碼 ${code} 已掃描過` });
            return;
        }

        setLastScanned(code);
        
        // 清除舊的超時
        if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
        }
        
        // 設置新的超時
        scanTimeoutRef.current = setTimeout(() => {
            setLastScanned(null);
            scanTimeoutRef.current = null;
        }, 500);

        // 成功掃描音效
        soundNotification.play('success');
        
        if (mode === 'batch') {
            // 批次模式：累積條碼
            setScannedCodes(prev => [...prev, code]);
            toast.success('掃描成功', { 
                description: `已掃描 ${scannedCodes.length + 1} 個條碼`,
                duration: 1000 
            });
        } else {
            // 單次模式：立即回調並關閉
            onScan(code);
            stopScanning();
            onClose();
        }
    };

    const stopScanning = () => {
        if (codeReaderRef.current) {
            codeReaderRef.current.reset();
        }
        if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
        }
        setIsScanning(false);
    };

    const handleDeviceChange = (deviceId) => {
        stopScanning();
        setSelectedDevice(deviceId);
        startScanning(deviceId);
    };

    const handleBatchComplete = () => {
        if (scannedCodes.length === 0) {
            toast.error('尚未掃描任何條碼');
            return;
        }
        
        onScan(scannedCodes);
        stopScanning();
        onClose();
    };

    const removeScannedCode = (index) => {
        setScannedCodes(prev => prev.filter((_, i) => i !== index));
        soundNotification.play('click');
    };

    return (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col animate-fade-in">
            {/* 頂部控制欄 */}
            <div className="glass-dark p-4 flex justify-between items-center border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-apple-blue/20 to-apple-indigo/20 flex items-center justify-center">
                        <Camera className="w-6 h-6 text-apple-blue" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-white">
                            📸 相機掃描
                        </h2>
                        <p className="text-sm text-gray-400">
                            {mode === 'batch' ? '批次掃描模式 - 連續掃描' : '單次掃描模式'}
                        </p>
                    </div>
                </div>
                
                <button 
                    onClick={() => { stopScanning(); onClose(); }}
                    className="btn-apple bg-red-500/90 hover:bg-red-600 text-white"
                >
                    <X size={20} />
                    關閉
                </button>
            </div>

            {/* 相機畫面 */}
            <div className="flex-1 flex flex-col items-center justify-center p-4">
                <div className="relative w-full max-w-2xl aspect-video bg-black rounded-2xl overflow-hidden shadow-apple-xl">
                    {error ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-8">
                            <AlertCircle className="w-16 h-16 text-red-400 mb-4" />
                            <p className="text-lg font-semibold mb-2">相機錯誤</p>
                            <p className="text-gray-400 text-center">{error}</p>
                        </div>
                    ) : (
                        <>
                            <video 
                                ref={videoRef}
                                className="w-full h-full object-cover"
                                autoPlay
                                playsInline
                            />
                            
                            {/* 掃描框提示 */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="relative w-3/4 h-3/4 border-4 border-apple-blue/50 rounded-2xl">
                                    {/* 四個角落的標記 */}
                                    <div className="absolute -top-2 -left-2 w-8 h-8 border-t-4 border-l-4 border-apple-blue rounded-tl-xl"></div>
                                    <div className="absolute -top-2 -right-2 w-8 h-8 border-t-4 border-r-4 border-apple-blue rounded-tr-xl"></div>
                                    <div className="absolute -bottom-2 -left-2 w-8 h-8 border-b-4 border-l-4 border-apple-blue rounded-bl-xl"></div>
                                    <div className="absolute -bottom-2 -right-2 w-8 h-8 border-b-4 border-r-4 border-apple-blue rounded-br-xl"></div>
                                    
                                    {/* 掃描線動畫 */}
                                    {isScanning && (
                                        <div className="absolute inset-0 overflow-hidden">
                                            <div className="w-full h-1 bg-gradient-to-r from-transparent via-apple-blue to-transparent animate-scan"></div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 掃描狀態指示器 */}
                            <div className="absolute top-4 left-4 flex items-center gap-2 glass-dark px-4 py-2 rounded-xl">
                                {isScanning ? (
                                    <>
                                        <Scan className="w-5 h-5 text-apple-green animate-pulse" />
                                        <span className="text-white font-semibold">掃描中...</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle className="w-5 h-5 text-yellow-400" />
                                        <span className="text-white font-semibold">準備中</span>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* 相機切換 */}
                {cameraDevices.length > 1 && (
                    <div className="mt-4 glass-dark p-4 rounded-xl">
                        <label className="text-white text-sm font-semibold mb-2 block">選擇相機:</label>
                        <select 
                            value={selectedDevice || ''}
                            onChange={(e) => handleDeviceChange(e.target.value)}
                            className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white font-medium"
                        >
                            {cameraDevices.map(device => (
                                <option key={device.deviceId} value={device.deviceId} className="bg-gray-900">
                                    {device.label || `相機 ${device.deviceId.slice(0, 8)}`}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* 提示文字 */}
                <div className="mt-4 text-center">
                    <p className="text-gray-400 flex items-center gap-2 justify-center">
                        <Zap className="w-4 h-4 text-yellow-400" />
                        將條碼對準掃描框內
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                        支援 QR Code、Code 128、EAN-13、Data Matrix 等格式
                    </p>
                </div>
            </div>

            {/* 批次模式：已掃描列表 */}
            {mode === 'batch' && scannedCodes.length > 0 && (
                <div className="glass-dark p-4 border-t border-white/10 max-h-48 overflow-y-auto safe-bottom">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-white font-semibold">
                            已掃描 ({scannedCodes.length})
                        </h3>
                        <button 
                            onClick={handleBatchComplete}
                            className="btn-apple bg-apple-green/90 hover:bg-apple-green text-white"
                        >
                            <CheckCircle size={18} />
                            完成掃描
                        </button>
                    </div>
                    <div className="space-y-2">
                        {scannedCodes.map((code, index) => (
                            <div 
                                key={index}
                                className="flex items-center justify-between glass p-3 rounded-xl animate-scale-in"
                                style={{ animationDelay: `${index * 50}ms` }}
                            >
                                <span className="text-white font-mono">{code}</span>
                                <button 
                                    onClick={() => removeScannedCode(index)}
                                    className="text-red-400 hover:text-red-300 p-1"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <style jsx>{`
                @keyframes scan {
                    0% {
                        transform: translateY(0);
                    }
                    100% {
                        transform: translateY(400%);
                    }
                }
                .animate-scan {
                    animation: scan 2s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}
