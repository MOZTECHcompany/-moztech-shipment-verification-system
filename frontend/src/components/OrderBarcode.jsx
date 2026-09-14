import React, { useMemo } from 'react';
import { encodeOrderBarcode, ORDER_BARCODE_WIDTH_MM } from '../utils/orderBarcode';

export function OrderBarcode({ value }) {
  const code = useMemo(() => encodeOrderBarcode(value), [value]);
  if (!code) return <div style={{ textAlign: 'center', overflowWrap: 'anywhere' }}><strong>{String(value ?? '') || '未提供訂單編號'}</strong><p style={{ fontSize: '9pt', marginTop: '4px' }}>此單號請手動輸入，未產生條碼。</p></div>;
  return <figure style={{ margin: 0, textAlign: 'center' }}>
    <svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`訂單條碼 ${code.text}`} viewBox={`0 0 ${code.width} ${code.height}`} width={code.width} height={code.height} style={{ display: 'block', width: `${ORDER_BARCODE_WIDTH_MM}mm`, maxWidth: '100%', height: '20mm', margin: '0 auto' }} preserveAspectRatio="none" shapeRendering="crispEdges">
      <rect width={code.width} height={code.height} fill="#fff" />
      {code.bars.map(bar => <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={code.height} fill="#000" />)}
    </svg>
    <figcaption style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '11pt', overflowWrap: 'anywhere' }}>{code.text}</figcaption>
    <p style={{ marginTop: '4px', fontSize: '8pt', color: '#555' }}>訂單條碼 · CODE128</p>
  </figure>;
}
