// frontend/src/components/LabelPrinter.jsx
// 標籤列印系統 - 出貨標籤和揀貨單

import React, { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, Package, FileText, Download } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toast } from 'sonner';

// 出貨標籤組件
export function ShippingLabel({ order, items, className, variant = 'default' }) {
    const componentRef = useRef(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `出貨標籤-${order.voucher_number}`,
        onAfterPrint: () => toast.success('列印完成'),
    });

    return (
        <div>
            <button
                onClick={handlePrint}
                className={className || `btn-apple bg-apple-blue/90 hover:bg-apple-blue text-white flex items-center gap-2 ${variant === 'icon' ? 'p-2' : 'px-4 py-2'}`}
                title="列印出貨標籤"
            >
                <Printer size={18} />
                {variant !== 'icon' && <span>列印出貨標籤</span>}
            </button>

            {/* 隱藏的列印內容 */}
            <div style={{ display: 'none' }}>
                <div ref={componentRef} className="p-8" style={{ width: '100mm', fontSize: '12pt' }}>
                    {/* 公司標題 */}
                    <div className="text-center mb-6" style={{ borderBottom: '3px solid #000', paddingBottom: '10px' }}>
                        <h1 style={{ fontSize: '24pt', fontWeight: 'bold', marginBottom: '5px' }}>MOZTECH</h1>
                        <p style={{ fontSize: '10pt' }}>出貨標籤 SHIPPING LABEL</p>
                    </div>

                    {/* 訂單資訊 */}
                    <div className="mb-6">
                        <table style={{ width: '100%', marginBottom: '15px' }}>
                            <tbody>
                                <tr>
                                    <td style={{ fontWeight: 'bold', width: '35%' }}>訂單編號:</td>
                                    <td style={{ fontSize: '14pt', fontWeight: 'bold' }}>{order.voucher_number}</td>
                                </tr>
                                <tr>
                                    <td style={{ fontWeight: 'bold' }}>客戶:</td>
                                    <td>{order.customer_name || '未指定'}</td>
                                </tr>
                                <tr>
                                    <td style={{ fontWeight: 'bold' }}>出貨日期:</td>
                                    <td>{format(new Date(), 'yyyy-MM-dd HH:mm', { locale: zhTW })}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 條碼區 */}
                    <div className="text-center mb-6" style={{ border: '2px dashed #ccc', padding: '15px' }}>
                        <div style={{ fontSize: '32pt', fontFamily: 'monospace', letterSpacing: '3px', fontWeight: 'bold' }}>
                            {order.voucher_number}
                        </div>
                        <p style={{ fontSize: '8pt', color: '#666', marginTop: '5px' }}>請掃描此條碼</p>
                    </div>

                    {/* 商品摘要 */}
                    <div>
                        <h3 style={{ fontWeight: 'bold', marginBottom: '10px', borderBottom: '2px solid #000', paddingBottom: '5px' }}>
                            商品清單
                        </h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #ccc' }}>
                                    <th style={{ textAlign: 'left', padding: '5px' }}>品名</th>
                                    <th style={{ textAlign: 'center', padding: '5px', width: '20%' }}>數量</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.slice(0, 10).map((item, index) => (
                                    <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '8px 5px' }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '11pt' }}>{item.product_name}</div>
                                            <div style={{ fontSize: '9pt', color: '#666' }}>條碼: {item.barcode}</div>
                                        </td>
                                        <td style={{ textAlign: 'center', fontSize: '14pt', fontWeight: 'bold' }}>
                                            {item.quantity}
                                        </td>
                                    </tr>
                                ))}
                                {items.length > 10 && (
                                    <tr>
                                        <td colSpan={2} style={{ padding: '8px 5px', textAlign: 'center', color: '#666', fontSize: '9pt' }}>
                                            ... 及其他 {items.length - 10} 項商品
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* 總計 */}
                    <div style={{ marginTop: '20px', borderTop: '3px double #000', paddingTop: '10px' }}>
                        <table style={{ width: '100%' }}>
                            <tbody>
                                <tr>
                                    <td style={{ fontWeight: 'bold', fontSize: '12pt' }}>總件數:</td>
                                    <td style={{ textAlign: 'right', fontSize: '16pt', fontWeight: 'bold' }}>
                                        {items.reduce((sum, item) => sum + item.quantity, 0)} 件
                                    </td>
                                </tr>
                                <tr>
                                    <td style={{ fontWeight: 'bold', fontSize: '12pt' }}>品項數:</td>
                                    <td style={{ textAlign: 'right', fontSize: '16pt', fontWeight: 'bold' }}>
                                        {items.length} 項
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 簽收欄 */}
                    <div style={{ marginTop: '30px', border: '2px solid #000', padding: '15px' }}>
                        <table style={{ width: '100%' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '50%' }}>
                                        <p style={{ marginBottom: '30px' }}>收貨人簽名:</p>
                                        <div style={{ borderBottom: '1px solid #000' }}></div>
                                    </td>
                                    <td style={{ width: '50%', paddingLeft: '20px' }}>
                                        <p style={{ marginBottom: '30px' }}>日期:</p>
                                        <div style={{ borderBottom: '1px solid #000' }}></div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 頁腳 */}
                    <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '8pt', color: '#999' }}>
                        <p>此標籤由 MOZTECH WMS 系統自動生成</p>
                        <p>{format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// 揀貨單組件
export function PickingList({ order, items, className, variant = 'default' }) {
    const componentRef = useRef(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `揀貨單-${order.voucher_number}`,
        onAfterPrint: () => toast.success('列印完成'),
    });

    // 按貨架位置分組（如果有）
    const groupedItems = items.reduce((acc, item) => {
        const location = item.location || '未指定位置';
        if (!acc[location]) {
            acc[location] = [];
        }
        acc[location].push(item);
        return acc;
    }, {});

    return (
        <div>
            <button
                onClick={handlePrint}
                className={className || `btn-apple bg-apple-green/90 hover:bg-apple-green text-white flex items-center gap-2 ${variant === 'icon' ? 'p-2' : 'px-4 py-2'}`}
                title="列印揀貨單"
            >
                <FileText size={18} />
                {variant !== 'icon' && <span>列印揀貨單</span>}
            </button>

            {/* 隱藏的列印內容 */}
            <div style={{ display: 'none' }}>
                <div ref={componentRef} className="p-8" style={{ width: '210mm', fontSize: '12pt' }}>
                    {/* 標題 */}
                    <div className="text-center mb-6" style={{ borderBottom: '4px solid #000', paddingBottom: '15px' }}>
                        <h1 style={{ fontSize: '28pt', fontWeight: 'bold', marginBottom: '5px' }}>揀貨作業單</h1>
                        <p style={{ fontSize: '12pt' }}>PICKING LIST</p>
                    </div>

                    {/* 訂單資訊 */}
                    <div style={{ marginBottom: '20px', backgroundColor: '#f5f5f5', padding: '15px', borderRadius: '8px' }}>
                        <table style={{ width: '100%' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '50%' }}>
                                        <strong>訂單編號:</strong> 
                                        <span style={{ fontSize: '16pt', fontWeight: 'bold', marginLeft: '10px' }}>
                                            {order.voucher_number}
                                        </span>
                                    </td>
                                    <td style={{ width: '50%' }}>
                                        <strong>客戶:</strong> {order.customer_name || '未指定'}
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <strong>列印時間:</strong> {format(new Date(), 'yyyy-MM-dd HH:mm', { locale: zhTW })}
                                    </td>
                                    <td>
                                        <strong>揀貨員:</strong> _________________
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 揀貨清單 */}
                    <div>
                        <h3 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: '15px' }}>
                            📦 揀貨清單 (共 {items.length} 項商品)
                        </h3>

                        {Object.entries(groupedItems).map(([location, locationItems], groupIndex) => (
                            <div key={groupIndex} style={{ marginBottom: '25px' }}>
                                {/* 位置標題 */}
                                <div style={{ 
                                    backgroundColor: '#e3f2fd', 
                                    padding: '10px', 
                                    borderLeft: '4px solid #2196f3',
                                    marginBottom: '10px',
                                    fontWeight: 'bold'
                                }}>
                                    📍 {location}
                                </div>

                                {/* 商品表格 */}
                                <table style={{ 
                                    width: '100%', 
                                    borderCollapse: 'collapse',
                                    marginBottom: '15px'
                                }}>
                                    <thead>
                                        <tr style={{ 
                                            backgroundColor: '#f5f5f5',
                                            borderBottom: '2px solid #000'
                                        }}>
                                            <th style={{ padding: '10px', textAlign: 'left', width: '8%' }}>序號</th>
                                            <th style={{ padding: '10px', textAlign: 'left', width: '35%' }}>品名</th>
                                            <th style={{ padding: '10px', textAlign: 'left', width: '20%' }}>條碼</th>
                                            <th style={{ padding: '10px', textAlign: 'center', width: '10%' }}>數量</th>
                                            <th style={{ padding: '10px', textAlign: 'center', width: '12%' }}>已揀</th>
                                            <th style={{ padding: '10px', textAlign: 'center', width: '15%' }}>確認簽名</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {locationItems.map((item, index) => (
                                            <tr key={index} style={{ borderBottom: '1px solid #ddd' }}>
                                                <td style={{ padding: '12px', textAlign: 'center', fontWeight: 'bold' }}>
                                                    {index + 1}
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>
                                                        {item.product_name}
                                                    </div>
                                                    {item.model_number && (
                                                        <div style={{ fontSize: '9pt', color: '#666' }}>
                                                            型號: {item.model_number}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                                                    {item.barcode}
                                                </td>
                                                <td style={{ 
                                                    padding: '12px', 
                                                    textAlign: 'center', 
                                                    fontSize: '14pt',
                                                    fontWeight: 'bold'
                                                }}>
                                                    {item.quantity}
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'center' }}>
                                                    <div style={{ 
                                                        border: '2px solid #000',
                                                        padding: '5px',
                                                        minHeight: '30px'
                                                    }}></div>
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    <div style={{ 
                                                        borderBottom: '1px solid #999',
                                                        minHeight: '30px'
                                                    }}></div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </div>

                    {/* 彙總資訊 */}
                    <div style={{ 
                        marginTop: '30px', 
                        border: '3px double #000', 
                        padding: '15px',
                        backgroundColor: '#fffde7'
                    }}>
                        <table style={{ width: '100%' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '70%', fontSize: '14pt', fontWeight: 'bold' }}>
                                        ✓ 總件數:
                                    </td>
                                    <td style={{ fontSize: '18pt', fontWeight: 'bold', textAlign: 'right' }}>
                                        {items.reduce((sum, item) => sum + item.quantity, 0)} 件
                                    </td>
                                </tr>
                                <tr>
                                    <td style={{ fontSize: '14pt', fontWeight: 'bold' }}>
                                        ✓ 總品項數:
                                    </td>
                                    <td style={{ fontSize: '18pt', fontWeight: 'bold', textAlign: 'right' }}>
                                        {items.length} 項
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 簽核欄 */}
                    <div style={{ marginTop: '40px' }}>
                        <table style={{ width: '100%' }}>
                            <tbody>
                                <tr>
                                    <td style={{ width: '33%', textAlign: 'center' }}>
                                        <p style={{ marginBottom: '40px', fontWeight: 'bold' }}>揀貨員簽名:</p>
                                        <div style={{ borderTop: '2px solid #000', paddingTop: '5px' }}>簽名 / 日期</div>
                                    </td>
                                    <td style={{ width: '33%', textAlign: 'center' }}>
                                        <p style={{ marginBottom: '40px', fontWeight: 'bold' }}>覆核員簽名:</p>
                                        <div style={{ borderTop: '2px solid #000', paddingTop: '5px' }}>簽名 / 日期</div>
                                    </td>
                                    <td style={{ width: '33%', textAlign: 'center' }}>
                                        <p style={{ marginBottom: '40px', fontWeight: 'bold' }}>主管簽名:</p>
                                        <div style={{ borderTop: '2px solid #000', paddingTop: '5px' }}>簽名 / 日期</div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* 備註欄 */}
                    <div style={{ marginTop: '30px', border: '2px solid #ccc', padding: '15px' }}>
                        <p style={{ fontWeight: 'bold', marginBottom: '10px' }}>備註事項:</p>
                        <div style={{ minHeight: '60px', borderBottom: '1px solid #ddd', marginBottom: '5px' }}></div>
                        <div style={{ minHeight: '60px' }}></div>
                    </div>

                    {/* 頁腳 */}
                    <div style={{ 
                        marginTop: '20px', 
                        paddingTop: '15px',
                        borderTop: '1px solid #ddd',
                        textAlign: 'center', 
                        fontSize: '9pt', 
                        color: '#999' 
                    }}>
                        <p>此揀貨單由 MOZTECH WMS 系統自動生成 | 列印時間: {format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// 批次列印組件
export function BatchPrintLabels({ orders }) {
    const handleBatchPrint = () => {
        toast.info('批次列印功能', {
            description: `準備列印 ${orders.length} 張標籤`,
            duration: 2000
        });
        
        // 依序列印每個訂單
        orders.forEach((order, index) => {
            setTimeout(() => {
                // 這裡可以觸發每個訂單的列印
                console.log(`列印訂單 ${index + 1}/${orders.length}: ${order.voucher_number}`);
            }, index * 1000);
        });
    };

    return (
        <button
            onClick={handleBatchPrint}
            className="btn-apple bg-apple-purple/90 hover:bg-apple-purple text-white flex items-center gap-2"
        >
            <Download size={18} />
            批次列印 ({orders.length})
        </button>
    );
}
