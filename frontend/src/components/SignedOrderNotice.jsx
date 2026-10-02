import React from 'react';
import { signedQuantity, signedOrderTotals, signedDocumentLabel, isSignedDocument } from '@/utils/signedOrder';

export function SignedQuantityBadge({ item, showPositive = false }) {
    const quantity = signedQuantity(item);
    if (quantity >= 0 && !showPositive) return null;
    return <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-semibold ${quantity < 0 ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
        {quantity > 0 ? '+' : ''}{quantity} 件 · {quantity < 0 ? '沖正' : '新增'}
    </span>;
}

export function SignedOrderNotice({ order, items }) {
    if (!isSignedDocument(order)) return null;
    const totals = signedOrderTotals(items);
    return <section role="status" aria-label="理貨單異動數量" className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-950">
        <h2 className="font-bold">{signedDocumentLabel(order.document_type)}</h2>
        <p className="mt-1 text-sm">新增 {totals.positive} 件／沖正 {totals.negative} 件，共需核對 <strong>{totals.work}</strong> 件</p>
        <p className="mt-1 text-sm">請依這張理貨單，分別核對新增與沖正品項。</p>
    </section>;
}

export function SignedOrderPrintSummary({ order, items }) {
    if (!isSignedDocument(order)) return null;
    const totals = signedOrderTotals(items);
    return <p style={{ border: '2px solid #000', padding: '8px', fontWeight: 'bold', margin: '12px 0' }}>
        {signedDocumentLabel(order.document_type)}：新增 {totals.positive} 件／沖正 {totals.negative} 件 · 核對 {totals.work} 件
    </p>;
}
