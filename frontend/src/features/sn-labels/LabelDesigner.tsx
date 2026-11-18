import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Alert, Button, Form, InputNumber, Select, Slider, Space, Switch } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { QRCodeSVG } from '@rc-component/qrcode'
import { QrCode, Ecc } from '@rc-component/qrcode/es/libs/qrcodegen'
import { constrainLayout, defaultLayout, samplePayload, sampleSerial } from './model'
import type { LabelLayout, SnDraft } from './model'

export default function LabelDesigner({ draft, onChange }: { draft: SnDraft; onChange: (label: LabelLayout) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const text = useRef<SVGGElement>(null)
  const drag = useRef<{ x: number; y: number; kind: 'text' | 'qr' | 'size'; initial: LabelLayout } | null>(null)
  const [zoom, setZoom] = useState(100)
  const [selected, setSelected] = useState<'text' | 'qr'>('text')
  const [layoutError, setLayoutError] = useState('')
  const l = draft.label
  let serial = '尚未設定編碼', payload = 'DRAFT:SN-PREVIEW', valid = false
  try { serial = sampleSerial(draft); payload = samplePayload(draft); valid = true } catch { /* Incomplete draft. */ }
  const modules = QrCode.encodeText(payload, Ecc.MEDIUM).size
  const bodyRatio = modules / (modules + 8)
  const title = [draft.model || '產品型號', draft.style, draft.color].filter(Boolean).join(' ')
  const date = draft.manufactureDate ? draft.manufactureDate.replaceAll('-', '').slice(0, 6) : '待設定'
  const update = (patch: Partial<LabelLayout>) => onChange(constrainLayout({ ...l, ...patch }))

  useEffect(() => {
    const check = () => {
      if (!text.current) return
      const b = text.current.getBBox()
      const out = b.x < 0 || b.y < 0 || b.x + b.width > l.width || b.y + b.height > l.height - 1
      const overlap = l.showQr && b.x < l.qrX + l.qrSize && b.x + b.width > l.qrX && b.y < l.qrY + l.qrSize && b.y + b.height > l.qrY
      setLayoutError(out ? '文字超出標籤，請調整位置、字級或尺寸。' : overlap ? '文字與 QR Code 重疊，請調整位置。' : '')
    }
    check()
    let active = true
    void document.fonts.ready.then(() => { if (active) check() })
    return () => { active = false }
  }, [l, title, date, serial])

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = svg.current?.getScreenCTM()?.inverse()
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : null
  }
  const start = (event: PointerEvent<SVGSVGElement>) => {
    const kind = (event.target as Element).closest('[data-drag]')?.getAttribute('data-drag')
    if (kind !== 'text' && kind !== 'qr' && kind !== 'size') return
    const p = point(event)
    if (!p) return
    event.preventDefault()
    setSelected(kind === 'text' ? 'text' : 'qr')
    drag.current = { ...p, x: p.x, y: p.y, kind, initial: { ...l } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const p = point(event), d = drag.current
    if (!p || !d) return
    const dx = p.x - d.x, dy = p.y - d.y
    const patch = d.kind === 'text' ? { textX: d.initial.textX + dx, textY: d.initial.textY + dy }
      : d.kind === 'qr' ? { qrX: d.initial.qrX + dx, qrY: d.initial.qrY + dy }
        : { qrSize: d.initial.qrSize + Math.max(dx, dy) }
    onChange(constrainLayout({ ...d.initial, ...patch }))
  }
  const download = () => {
    if (!svg.current || !valid || layoutError) return
    const copy = svg.current.cloneNode(true) as SVGSVGElement
    copy.setAttribute('width', `${l.width}mm`)
    copy.setAttribute('height', `${l.height}mm`)
    copy.removeAttribute('style')
    copy.removeAttribute('class')
    copy.querySelectorAll('[data-editor]').forEach(el => el.remove())
    copy.querySelectorAll('[data-drag]').forEach(el => el.removeAttribute('data-drag'))
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `SN-DRAFT-${serial}.svg`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="sn-designer">
    <div className="sn-design-controls">
      <Form layout="vertical">
        <Form.Item label="貼標位置"><Select aria-label="貼標位置" value={l.target} onChange={target => update({ target })}
          options={[{ value: 'box', label: '彩盒（含 QR Code）' }, { value: 'device', label: '產品機身' }]} /></Form.Item>
        <div className="sn-field-pair">
          <Form.Item label="寬度 mm"><InputNumber aria-label="標籤寬度" min={15} max={150} step={0.5} value={l.width} onChange={v => v !== null && update({ width: v })} /></Form.Item>
          <Form.Item label="高度 mm"><InputNumber aria-label="標籤高度" min={7.5} max={150} step={0.5} value={l.height} onChange={v => v !== null && update({ height: v })} /></Form.Item>
        </div>
        <Form.Item label="顯示 QR Code"><Switch aria-label="顯示 QR Code" checked={l.showQr} disabled={l.target === 'box'} onChange={showQr => update({ showQr })} /></Form.Item>
        <Form.Item label="選取元件"><Select aria-label="選取元件" value={selected} onChange={setSelected}
          options={[{ value: 'text', label: '產品與序號文字' }, ...(l.showQr ? [{ value: 'qr', label: 'QR Code' }] : [])]} /></Form.Item>
        <div className="sn-field-pair">
          <Form.Item label="X mm"><InputNumber aria-label="元件 X" step={0.1} value={Number((selected === 'text' ? l.textX : l.qrX).toFixed(2))} onChange={v => v !== null && update(selected === 'text' ? { textX: v } : { qrX: v })} /></Form.Item>
          <Form.Item label="Y mm"><InputNumber aria-label="元件 Y" step={0.1} value={Number((selected === 'text' ? l.textY : l.qrY).toFixed(2))} onChange={v => v !== null && update(selected === 'text' ? { textY: v } : { qrY: v })} /></Form.Item>
        </div>
        <Form.Item label={selected === 'text' ? '字級 pt' : 'QR 碼本體邊長 mm'}><InputNumber aria-label="元件尺寸" min={selected === 'text' ? 2.27 : 2} step={0.1}
          value={Number((selected === 'text' ? l.fontSize * 72 / 25.4 : l.qrSize * bodyRatio).toFixed(2))} onChange={v => v !== null && update(selected === 'text' ? { fontSize: v * 25.4 / 72 } : { qrSize: v / bodyRatio })} /></Form.Item>
        <p className="sn-muted">QR 本體 {Number((l.qrSize * bodyRatio).toFixed(2))} mm · 含必要留白 {Number(l.qrSize.toFixed(2))} mm</p>
        <Button icon={<ReloadOutlined />} onClick={() => onChange(defaultLayout())}>重設版面</Button>
      </Form>
    </div>
    <div className="sn-design-stage">
      <div className="sn-preview-toolbar"><span>{l.width} × {l.height} mm</span><Space><span>預覽 {zoom}%</span><Slider aria-label="預覽縮放" min={50} max={200} step={10} value={zoom} onChange={setZoom} style={{ width: 100 }} /></Space></div>
      <div className="sn-canvas-scroll">
        <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${l.width} ${l.height}`} style={{ width: `${zoom}%`, height: 'auto' }}
          className="sn-label-canvas" aria-label="SN 標籤設計預覽" onPointerDown={start} onPointerMove={move}
          onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
          <title>SN 標籤草稿，非正式序號</title>
          <rect width={l.width} height={l.height} fill="white" />
          {l.showQr && <g data-drag="qr"><QRCodeSVG value={payload} x={l.qrX} y={l.qrY} width={l.qrSize} height={l.qrSize} marginSize={4} level="M" boostLevel={false} />
            <rect data-editor="true" x={l.qrX} y={l.qrY} width={l.qrSize} height={l.qrSize} fill="transparent" stroke={selected === 'qr' ? '#4f6d91' : 'transparent'} strokeWidth={0.06} />
            <rect data-editor="true" data-drag="size" x={l.qrX + l.qrSize - 0.5} y={l.qrY + l.qrSize - 0.5} width={0.7} height={0.7} fill="#4f6d91" style={{ cursor: 'nwse-resize' }} />
          </g>}
          <g ref={text} data-drag="text" fill="#111" fontFamily="Arial, 'Noto Sans TC', sans-serif" fontSize={l.fontSize} fontWeight={500}>
            <text x={l.textX} y={l.textY + l.fontSize}>{title}</text>
            <text x={l.textX} y={l.textY + l.fontSize * 2.25}>製造日期 {date}</text>
            <text x={l.textX} y={l.textY + l.fontSize * 3.5}>SN: {serial}</text>
          </g>
          <text x={l.width / 2} y={l.height - 0.2} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={0.65} fill="#555">DRAFT · NOT FOR PRODUCTION</text>
        </svg>
      </div>
      <p className="sn-muted">拖曳文字或 QR Code 調整位置；拖曳 QR Code 右下角等比縮放。預覽倍率不改變列印尺寸。</p>
      {layoutError && <Alert type="warning" showIcon message={layoutError} />}
      <div className="sn-export"><Button icon={<DownloadOutlined />} disabled={!valid || !!layoutError} onClick={download}>下載 SVG 樣張</Button><span className="sn-muted">樣張含 DRAFT 標示，QR 內容加上 DRAFT: 前綴。尺寸仍需工廠試印確認。</span></div>
    </div>
  </div>
}
