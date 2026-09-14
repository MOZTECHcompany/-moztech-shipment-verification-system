// frontend/src/components/LabelPrinter.jsx
// 標籤列印系統 - 出貨標籤和揀貨單

import React, { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, Package, FileText, Download } from 'lucide-react';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { toast } from 'sonner';
import { OrderBarcode } from './OrderBarcode';
import { groupSourceOrders, sourceOrderLabel } from '../utils/sourceOrders';
import apiClient from '@/api/api.js';
import { loadWorkOrdersForPrint, workOrderBarcode } from '../utils/workOrders';

// 出貨標籤組件
export function ShippingLabel({ order, items, className, variant = 'default' }) {
    const componentRef = useRef(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `出貨標籤-${order.voucher_number}`,
        onAfterPrint: () => toast.info('列印視窗已關閉，請確認印表機輸出。'),
        onPrintError: () => toast.error('無法開啟列印，請重試。'),
        pageStyle: '@page { margin: 8mm; } @media print { body { color: #000; background: #fff; } thead { display: table-header-group; } tr { break-inside: avoid; } }',
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
                <div ref={componentRef} className="p-8" style={{ width: '100mm', maxWidth: '100%', padding: '5mm', boxSizing: 'border-box', fontSize: '12pt' }}>
                    {/* 公司標題 */}
                    <div className="text-center mb-6" style={{ borderBottom: '3px solid #000', paddingBottom: '10px' }}>
                        <h1 style={{ fontSize: '24pt', fontWeight: 'bold', marginBottom: '5px' }}>Corely AI</h1>
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
                                    <td style={{ fontWeight: 'bold' }}>列印時間:</td>
                                    <td>{format(new Date(), 'yyyy-MM-dd HH:mm', { locale: zhTW })}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div style={{ margin: '12px 0 20px' }}><OrderBarcode value={workOrderBarcode(order)} label={order.work_barcode ? "工作單認領條碼" : "訂單條碼"} /></div>

                    <WorkOrderPaperIdentity order={order} />
                    {/* 商品摘要 */}
                    <div>
                        <h3 style={{ fontWeight: 'bold', marginBottom: '10px', borderBottom: '2px solid #000', paddingBottom: '5px' }}>
                            商品摘要（最多列出 10 項）
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
                                            另有 {items.length - 10} 項商品，請以完整揀貨單核對
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
                                        {items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)} 件
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
                        <p>此標籤由 Corely AI 儲運管理系統自動生成</p>
                        <p>{format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// 揀貨單組件
export function PickingList({ order, items, instances = [], className, variant = 'default' }) {
    const componentRef = useRef(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `揀貨單-${order.voucher_number}`,
        onAfterPrint: () => toast.info('列印視窗已關閉，請確認印表機輸出。'),
        onPrintError: () => toast.error('無法開啟列印，請重試。'),
        pageStyle: '@page { margin: 8mm; } @media print { body { color: #000; background: #fff; } thead { display: table-header-group; } tr { break-inside: avoid; } }',
    });


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
            <div style={{ display: 'none' }}><div ref={componentRef}>
                <PickingListDocument order={order} items={items} instances={instances} />
            </div></div>
        </div>
    );
}

function WorkOrderPaperIdentity({ order }) {
    if (!order.batch_number && !order.source_order_number && !order.work_barcode) return null;
    return <section aria-label="工作單來源與負責人" style={{ margin: '12px 0 20px', fontSize: '11pt', lineHeight: 1.8, overflowWrap: 'anywhere' }}>
        {order.batch_number && <p><strong>ERP 匯入批次：</strong>{order.batch_number}</p>}
        {order.source_order_number && <p><strong>商城訂單：</strong>{sourceOrderLabel(order)}</p>}
        <p><strong>揀貨負責人：</strong>{order.picker_name || '尚未認領　________________'}<br /><strong>裝箱負責人：</strong>{order.packer_name || '尚未認領　________________'}</p>
        {order.work_barcode && <p style={{ fontSize: '9pt' }}>於任務看板選擇揀貨／裝箱後，掃描工作單認領條碼即綁定登入者；以系統目前認領紀錄為準。</p>}
    </section>;
}

function MarketplaceWorkOrderPaper({ order, items, serialsByItem }) {
    return <article aria-label="商城工作單紙本" style={{ padding: '4mm', background: '#fff', color: '#000', fontSize: '10pt', lineHeight: 1.5, boxSizing: 'border-box' }}>
        <header style={{ borderBottom: '2px solid #000', paddingBottom: '8px', marginBottom: '12px' }}>
            <h1 style={{ fontSize: '20pt', fontWeight: 'bold', margin: 0 }}>商城揀貨／裝箱工作單</h1>
            <p style={{ fontSize: '13pt', fontWeight: 'bold', margin: '5px 0', overflowWrap: 'anywhere' }}>{sourceOrderLabel(order)}</p>
            <p style={{ margin: 0, overflowWrap: 'anywhere' }}>ERP 匯入批次：{order.batch_number} · 客戶：{order.customer_name || '未指定'}</p>
        </header>
        <div style={{ breakInside: 'avoid', margin: '12px 0' }}><OrderBarcode value={workOrderBarcode(order)} label="工作單認領條碼" /></div>
        <p style={{ fontSize: '9pt', margin: '8px 0 12px' }}>任務看板先選揀貨／裝箱，掃上方工作碼即認領並綁定登入者。責任人以系統目前紀錄為準。</p>
        <p style={{ margin: '8px 0', overflowWrap: 'anywhere' }}>揀貨負責人：{order.picker_name || '尚未認領　____________'}　裝箱負責人：{order.packer_name || '尚未認領　____________'}</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead><tr style={{ borderTop: '2px solid #000', borderBottom: '1px solid #000', background: '#f5f5f5' }}>
                <th style={{ width: '47%', padding: '8px', textAlign: 'left' }}>商品／SKU／S/N</th>
                <th style={{ width: '25%', padding: '8px', textAlign: 'left' }}>國際條碼</th>
                <th style={{ width: '10%', padding: '8px', textAlign: 'right' }}>數量</th>
                <th style={{ width: '18%', padding: '8px', textAlign: 'center' }}>揀貨／裝箱</th>
            </tr></thead>
            <tbody>{items.map(item => <tr key={item.id} style={{ borderBottom: '1px solid #bbb', breakInside: (serialsByItem.get(String(item.id))?.length || 0) > 10 ? 'auto' : 'avoid' }}>
                <td style={{ padding: '9px 8px', overflowWrap: 'anywhere' }}><strong>{item.product_name}</strong>
                    <div style={{ fontSize: '9pt' }}>{item.product_code}{item.source_line_id ? ` · 明細 ${item.source_line_id}` : ''}{item.location ? ` · ${item.location}` : ''}</div>
                    {serialsByItem.has(String(item.id)) && <div style={{ fontSize: '9pt', marginTop: '3px' }}>S/N：{serialsByItem.get(String(item.id)).join('、')}</div>}
                </td>
                <td style={{ padding: '9px 8px', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{item.barcode}</td>
                <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '12pt' }}>{item.quantity}</td>
                <td style={{ padding: '9px 8px', textAlign: 'center', fontSize: '14pt' }}>□　□</td>
            </tr>)}</tbody>
        </table>
        <div style={{ breakInside: 'avoid', marginTop: '12px' }}>
            <p style={{ fontWeight: 'bold', fontSize: '12pt', textAlign: 'right' }}>共 {items.length} 個品項 · 總件數：{items.reduce((total, item) => total + Number(item.quantity || 0), 0)} 件</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', paddingTop: '12px', marginTop: '12px' }}><span>揀貨簽名：________________</span><span>裝箱簽名：________________</span><span>日期：____________</span></div>
            <p style={{ marginTop: '16px', borderBottom: '1px solid #bbb', paddingBottom: '18px' }}>備註：</p>
            <p style={{ fontSize: '8pt', color: '#555', marginTop: '10px' }}>Corely AI · 工作單 {order.voucher_number} · 列印 {format(new Date(), 'yyyy-MM-dd HH:mm')}</p>
        </div>
    </article>;
}

export function PickingListDocument({ order, items, instances = [] }) {
    const serialsByItem = new Map();
    for (const instance of instances) {
        const key = String(instance.order_item_id);
        if (!serialsByItem.has(key)) serialsByItem.set(key, []);
        serialsByItem.get(key).push(instance.serial_number);
    }
    if (order.import_batch_id) return <MarketplaceWorkOrderPaper order={order} items={items} serialsByItem={serialsByItem} />;
    const sourceGroups = groupSourceOrders(items);
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
                <div className="p-8" style={{ width: '100%', padding: '4mm', boxSizing: 'border-box', fontSize: '12pt' }}>
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
                                        <strong>揀貨負責人:</strong> {order.picker_name || "_________________"}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div style={{ margin: '12px 0 20px' }}><OrderBarcode value={workOrderBarcode(order)} label={order.work_barcode ? "工作單認領條碼" : "理貨主單條碼"} /></div>
                    <WorkOrderPaperIdentity order={order} />
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
                                                    {item.source_order_number && <div style={{ marginTop: '4px', fontSize: '9pt', overflowWrap: 'anywhere' }}>商城訂單：{sourceOrderLabel(item)}</div>}
                                                    {serialsByItem.has(String(item.id)) && <div style={{ marginTop: '4px', fontSize: '9pt', overflowWrap: 'anywhere' }}>S/N：{serialsByItem.get(String(item.id)).join('、')}</div>}
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

                    {!order.import_batch_id && sourceGroups.length > 0 && <section aria-label="商城訂單分單對照" style={{ marginTop: '24px' }}>
                        <h2 style={{ fontSize: '16pt', fontWeight: 'bold', marginBottom: '8px' }}>商城訂單分單對照</h2>
                        <p style={{ fontSize: '10pt', marginBottom: '16px' }}>理貨主單：{order.voucher_number} · 共 {sourceGroups.length} 筆商城訂單</p>
                        {sourceGroups.map(group => <div key={group.key} data-source-order={group.number} style={{ marginBottom: '24px' }}>
                            <div style={{ breakInside: 'avoid', breakAfter: 'avoid', borderTop: '2px solid #000', paddingTop: '10px' }}>
                                <h3 style={{ fontSize: '12pt', fontWeight: 'bold', overflowWrap: 'anywhere', marginBottom: '10px' }}>{group.label}</h3>
                                <OrderBarcode value={group.number} label="商城訂單定位條碼（不可認領）" />
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px', fontSize: '10pt' }}>
                                <thead><tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #000' }}>
                                    <th style={{ textAlign: 'left', padding: '8px' }}>品項／商城明細</th>
                                    <th style={{ textAlign: 'left', padding: '8px' }}>國際條碼</th>
                                    <th style={{ textAlign: 'right', padding: '8px' }}>數量</th>
                                </tr></thead>
                                <tbody>{group.items.map(item => <tr key={item.id} style={{ borderBottom: '1px solid #ddd', breakInside: 'avoid' }}>
                                    <td style={{ padding: '8px', overflowWrap: 'anywhere' }}>{item.product_name}
                                        <div style={{ fontSize: '9pt' }}>{item.product_code}{item.source_line_id ? ` · 明細 ${item.source_line_id}` : ''}</div>
                                    </td>
                                    <td style={{ padding: '8px', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{item.barcode}</td>
                                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>{item.quantity}</td>
                                </tr>)}</tbody>
                            </table>
                        </div>)}
                        {items.some(item => !item.source_order_number) && <p style={{ fontSize: '10pt' }}>另有未提供商城訂單號的品項，請依上方完整揀貨清單核對。</p>}
                    </section>}

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
                                        {items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)} 件
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
                        <p>此揀貨單由 Corely AI 儲運管理系統自動生成 | 列印時間: {format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</p>
                    </div>
                </div>
    );
}

export function BatchPrintLabels({ orders, label = '批量列印工作單' }) {
    const componentRef = useRef(null);
    const readyToPrint = useRef(false);
    const mounted = useRef(true);
    const inFlight = useRef(false);
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: '商城工作單批量列印',
        onAfterPrint: () => { inFlight.current = false; if (mounted.current) setLoading(false); toast.info('列印視窗已關閉，請確認各張工作單輸出。'); },
        onPrintError: () => { inFlight.current = false; if (mounted.current) setLoading(false); toast.error('工作單資料未完整載入或列印失敗，請重試整個批次。'); },
        pageStyle: '@page { margin: 8mm; } @media print { body { color: #000; background: #fff; } .work-order-paper { break-after: page; } .work-order-paper:last-child { break-after: auto; } thead { display: table-header-group; } tr { break-inside: avoid; } }',
    });
    useEffect(() => {
        if (!documents.length || !readyToPrint.current) return;
        readyToPrint.current = false;
        handlePrint();
    }, [documents, handlePrint]);
    const preparePrint = async () => {
        if (inFlight.current) return;
        inFlight.current = true; setLoading(true);
        try {
            const data = await loadWorkOrdersForPrint(apiClient, orders);
            if (!mounted.current) return;
            readyToPrint.current = true; setDocuments(data);
        } catch (error) {
            inFlight.current = false;
            if (mounted.current) { setLoading(false); toast.error(error.message || '未能載入全部工作單，請重試。'); }
        }
    };
    return <div><button type="button" disabled={loading || !orders?.length} onClick={preparePrint} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"><Printer size={17} />{loading ? '正在準備全部工作單…' : label}</button>
        <div style={{ display: 'none' }}><div ref={componentRef}>{documents.map(document => <div key={document.order.id} className="work-order-paper"><PickingListDocument order={document.order} items={document.items} instances={document.instances} /></div>)}</div></div>
    </div>;
}
