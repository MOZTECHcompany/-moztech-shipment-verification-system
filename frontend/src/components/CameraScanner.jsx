// frontend/src/components/CameraScanner.jsx
// 相機條碼掃描組件 - Apple 風格現代化版本

import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { Camera, X, Zap, AlertCircle, CheckCircle, Scan, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { soundNotification } from '@/utils/soundNotification';
import { Button, Card } from '@/ui';

export function CameraScanner({ onScan, onClose, mode = 'single' }) {
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState(null);
    const [lastScanned, setLastScanned] = useState(null);
    const [scannedCodes, setScannedCodes] = useState([]);
    const [cameraDevices, setCameraDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    
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
                    device.label.toLowerCase().includes('rear') ||
                    device.label.toLowerCase().includes('environment')
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
            // 先停止當前掃描
            codeReaderRef.current.reset();
            
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
                        // 忽略常見的解碼錯誤
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
        // 防止重複掃描（1秒內的重複條碼會被忽略）
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
        
        // 設定新的超時，1秒後清除 lastScanned
        scanTimeoutRef.current = setTimeout(() => {
            setLastScanned(null);
            scanTimeoutRef.current = null;
        }, 1000);

        // 播放成功音效
        soundNotification.play('success');
        
        // 視覺反饋
        const overlay = document.getElementById('scan-overlay');
        if (overlay) {
            overlay.classList.add('border-green-500', 'bg-green-500/20');
            setTimeout(() => {
                overlay.classList.remove('border-green-500', 'bg-green-500/20');
            }, 300);
        }

        if (mode === 'batch') {
            setScannedCodes(prev => [...prev, code]);
            onScan(code);
        } else {
            onScan(code);
            // 單次模式掃描後不自動關閉，讓用戶決定何時關閉
            // onClose(); 
        }
    };

    const stopScanning = () => {
        if (codeReaderRef.current) {
            codeReaderRef.current.reset();
        }
        setIsScanning(false);
    };

    const switchCamera = (deviceId) => {
        setSelectedDevice(deviceId);
        startScanning(deviceId);
        setShowSettings(false);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col animate-fade-in">
            {/* 頂部控制列 */}
            <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent absolute top-0 left-0 right-0 z-20 safe-top">
                <div className="flex items-center gap-3 text-white">
                    <div className="p-2 bg-white/10 rounded-full backdrop-blur-md">
                        <Scan size={20} className="animate-pulse text-blue-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-lg tracking-tight">掃描條碼</h3>
                        <p className="text-xs text-white/60 font-medium">
                            {mode === 'batch' ? '批次掃描模式' : '單次掃描模式'}
                        </p>
                    </div>
                </div>
                <button 
                    onClick={onClose}
                    className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all active:scale-95 backdrop-blur-md"
                >
                    <X size={24} />
                </button>
            </div>

            {/* 相機視窗 */}
            <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
                {error ? (
                    <div className="text-center p-8 max-w-sm mx-auto">
                        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertCircle size={32} className="text-red-500" />
                        </div>
                        <h3 className="text-white font-bold text-xl mb-2">無法啟動相機</h3>
                        <p className="text-white/60 mb-6">{error}</p>
                        <Button onClick={() => window.location.reload()} variant="secondary">
                            重新整理頁面
                        </Button>
                    </div>
                ) : (
                    <>
                        <video
                            ref={videoRef}
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                        
                        {/* 掃描框遮罩 */}
                        <div className="absolute inset-0 z-10 pointer-events-none">
                            <div className="absolute inset-0 bg-black/40 mask-scan"></div>
                            <div 
                                id="scan-overlay"
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 border-2 border-white/50 rounded-3xl transition-all duration-300 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                            >
                                {/* 掃描線動畫 */}
                                <div className="absolute left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-scan-line top-0"></div>
                                
                                {/* 角落裝飾 */}
                                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-blue-500 rounded-tl-xl -mt-1 -ml-1"></div>
                                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-blue-500 rounded-tr-xl -mt-1 -mr-1"></div>
                                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-blue-500 rounded-bl-xl -mb-1 -ml-1"></div>
                                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-blue-500 rounded-br-xl -mb-1 -mr-1"></div>
                            </div>
                            <p className="absolute top-1/2 mt-44 left-0 right-0 text-center text-white/80 text-sm font-medium drop-shadow-md">
                                將條碼置於框內即可自動掃描
                            </p>
                        </div>
                    </>
                )}
            </div>

            {/* 底部控制區 */}
            <div className="bg-black/80 backdrop-blur-xl border-t border-white/10 p-6 safe-bottom z-20">
                <div className="flex items-center justify-between max-w-md mx-auto">
                    <button 
                        onClick={() => setShowSettings(!showSettings)}
                        className="flex flex-col items-center gap-1 text-white/60 hover:text-white transition-colors"
                    >
                        <div className="p-3 rounded-full bg-white/5 border border-white/10">
                            <Settings size={20} />
                        </div>
                        <span className="text-xs">設定</span>
                    </button>

                    <div className="flex flex-col items-center gap-2">
                        {lastScanned ? (
                            <div className="px-4 py-2 bg-green-500/20 border border-green-500/50 rounded-full flex items-center gap-2 animate-scale-in">
                                <CheckCircle size={16} className="text-green-400" />
                                <span className="text-green-400 font-mono font-bold">{lastScanned}</span>
                            </div>
                        ) : (
                            <div className="h-10 flex items-center text-white/40 text-sm">
                                等待掃描...
                            </div>
                        )}
                    </div>

                    <button 
                        onClick={() => setScannedCodes([])}
                        className="flex flex-col items-center gap-1 text-white/60 hover:text-white transition-colors"
                    >
                        <div className="p-3 rounded-full bg-white/5 border border-white/10">
                            <RefreshCw size={20} />
                        </div>
                        <span className="text-xs">重置</span>
                    </button>
                </div>

                {/* 相機選擇選單 */}
                {showSettings && (
                    <div className="absolute bottom-full left-0 right-0 bg-gray-900/95 backdrop-blur-xl border-t border-white/10 p-4 rounded-t-2xl animate-slide-up mb-0">
                        <h4 className="text-white/80 text-sm font-bold mb-3 px-2">選擇相機鏡頭</h4>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            {cameraDevices.map((device) => (
                                <button
                                    key={device.deviceId}
                                    onClick={() => switchCamera(device.deviceId)}
                                    className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${
                                        selectedDevice === device.deviceId
                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                                            : 'bg-white/5 text-white/70 hover:bg-white/10'
                                    }`}
                                >
                                    {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            
            <style>{`
                @keyframes scan-line {
                    0% { top: 0%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 100%; opacity: 0; }
                }
                .animate-scan-line {
                    animation: scan-line 2s linear infinite;
                }
            `}</style>
        </div>
    );
}

