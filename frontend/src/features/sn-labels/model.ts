// Browser format previews; only the server allocates serial numbers.
export type LabelTarget = 'box' | 'device'
export type LabelLayout = {
  width: number; height: number; showQr: boolean; target: LabelTarget
  textX: number; textY: number; fontSize: number
  qrX: number; qrY: number; qrSize: number
}
export type SnDraft = {
  version: 2; id: string; updatedAt: string; name: string
  productId: string; productName: string; sku: string; barcode: string; model: string
  style: string; color: string; modelCode: string; styleCode: string; colorCode: string
  orderDate: string; manufactureDate: string; legacyManualYear?: number
  quantity: number; capacity: number | null; label: LabelLayout; cartonWidth?: number; cartonHeight?: number
}
export const PENDING_RULES = [
  ['倉儲匯入', '欄位與檔案格式於後續設定'],
  ['掃箱出庫', '查詢、確認出貨與重複掃描的處理'],
] as const
export const CONFIRMED_RULES = [
  ['年份', '依製造年取西元後兩碼反轉：2024 → 42、2026 → 62'],
  ['流水號', '型號＋款式＋顏色＋製造年各自累加，跨年重新計數'],
  ['同日下單', '同日多次下單併為一筆單，接續排序'],
  ['裝箱', '維持連續 SN 與固定箱內產品；不足一箱顯示實際數量與序號'],
  ['補印／重印', '破損或漏印沿用原 SN；只有追加生產數量才接續新號'],
  ['保固匯入', 'SKU 欄位使用國際條碼'],
] as const
export const defaultLayout = (): LabelLayout => ({
  width: 28, height: 7.5, target: 'box', showQr: true,
  textX: 8, textY: 0.7, fontSize: 1.45, qrX: 0.25, qrY: 0.25, qrSize: 6,
})
export function newDraft(id: string): SnDraft {
  return {
    version: 2, id, updatedAt: '', name: '', productId: '', productName: '', sku: '', barcode: '', model: '',
    style: '', color: '', modelCode: '', styleCode: '', colorCode: '',
    orderDate: '', manufactureDate: '', quantity: 100, capacity: null, label: defaultLayout(),
  }
}
export function yearCode(year: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) throw new Error('編碼年份需介於 2000～2099')
  return String(year).slice(-2).split('').reverse().join('')
}
export function manufacturingYear(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('請填寫完整製造日期')
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('製造日期無效')
  yearCode(year)
  return year
}
export const isNoSerial = (draft: Pick<SnDraft, 'modelCode'>) => draft.modelCode === 'NSI'
function itemPrefix(draft: SnDraft) {
  if (isNoSerial(draft)) throw new Error('NSI 無 SN 產品，不產生單品序號')
  const codes = [draft.modelCode, draft.styleCode, draft.colorCode]
  if (!/^[A-Z0-9]+$/.test(codes[0]) || !/^[A-Z0-9]*$/.test(codes[1]) || !/^[A-Z0-9]+$/.test(codes[2]) || !/^[A-Z0-9]{4,6}$/.test(codes.join(''))) {
    throw new Error('型號與顏色代碼必填；款式選填，合計需為 4～6 碼大寫英數字')
  }
  return codes.join('')
}
export function sequenceScopeKey(draft: SnDraft): string {
  itemPrefix(draft)
  // Preserve tuple boundaries, even when two different configurations concatenate
  // to the same printable prefix. Issuance still needs a global SN uniqueness check.
  return JSON.stringify([draft.modelCode, draft.styleCode, draft.colorCode, manufacturingYear(draft.manufactureDate)])
}
export function sampleSerial(draft: SnDraft, sequence = 1): string {
  const prefix = itemPrefix(draft)
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) throw new Error('流水號超出六碼範圍')
  return "TRY-" + prefix + yearCode(manufacturingYear(draft.manufactureDate)) + String(sequence).padStart(6, '0')
}
export type PreviewCarton = { index: number; quantity: number; firstSequence: number; lastSequence: number; firstSn: string; lastSn: string }
export function previewCartons(draft: SnDraft, page = 1, pageSize = 10, start = 1) {
  const estimate = cartonEstimate(draft.quantity, draft.capacity)
  if (!estimate || !draft.capacity) throw new Error('請填寫有效的 SN 數量與每箱容量')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || !Number.isInteger(page) || page < 1) throw new Error('分頁參數無效')
  sampleSerial(draft, start)
  sampleSerial(draft, start + draft.quantity - 1) // Fail on overflow before any rows are returned.
  const rows: PreviewCarton[] = []
  const offset = (page - 1) * pageSize
  for (let i = offset; i < Math.min(estimate.boxes, offset + pageSize); i++) {
    const quantity = Math.min(draft.capacity, draft.quantity - i * draft.capacity)
    const firstSequence = start + i * draft.capacity, lastSequence = firstSequence + quantity - 1
    rows.push({ index: i + 1, quantity, firstSequence, lastSequence, firstSn: sampleSerial(draft, firstSequence), lastSn: sampleSerial(draft, lastSequence) })
  }
  return { rows, total: estimate.boxes }
}
export function cartonEstimate(quantity: number, capacity: number | null) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999999 ||
      capacity === null || !Number.isInteger(capacity) || capacity < 1 || capacity > 999999) return null
  return { boxes: Math.ceil(quantity / capacity), full: Math.floor(quantity / capacity), remainder: quantity % capacity }
}
export function constrainLayout(layout: LabelLayout): LabelLayout {
  const bounded = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  const width = bounded(layout.width, 15, 150), height = bounded(layout.height, 7.5, 150)
  const fontSize = bounded(layout.fontSize, 0.8, Math.min(8, (height - 1.5) / 3.6))
  const qrSize = bounded(layout.qrSize, 3, Math.min(width, height - 1))
  return { ...layout, width, height, fontSize, qrSize, showQr: layout.target === 'box' || layout.showQr,
    textX: bounded(layout.textX, 0, width - 5), textY: bounded(layout.textY, 0, height - fontSize * 3.6 - 1),
    qrX: bounded(layout.qrX, 0, width - qrSize), qrY: bounded(layout.qrY, 0, height - qrSize - 1) }
}
export function samplePayload(draft: SnDraft): string {
  // Samples must never be accepted as real stock/warranty serials.
  return 'DRAFT:' + sampleSerial(draft)
}
export function draftStorageKey(entityId: string, userId: string) {
  if (!entityId.trim() || !userId.trim()) throw new Error('缺少公司或使用者資訊')
  return `corely.sn-labels.v1:${encodeURIComponent(entityId)}:${encodeURIComponent(userId)}`
}
export function parseDrafts(raw: string | null): SnDraft[] {
  if (!raw) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || data.length > 100) throw new Error('草稿格式不正確')
  const keys = ['id', 'updatedAt', 'name', 'productId', 'productName', 'sku', 'barcode', 'model', 'style', 'color',
    'modelCode', 'styleCode', 'colorCode', 'orderDate', 'manufactureDate'] as const
  return data.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('草稿格式不正確')
    const d = value as Omit<SnDraft, 'version'> & { version: number; year?: number }
    if (![1, 2].includes(d.version) || keys.some(k => typeof d[k] !== 'string' || d[k].length > 250) || !d.id ||
        !Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > 999999 ||
        (d.capacity !== null && (!Number.isInteger(d.capacity) || d.capacity < 1 || d.capacity > 999999))) throw new Error('草稿格式不正確')
    if (d.version === 1) {
      if (d.year === undefined) throw new Error('舊版草稿缺少年份')
      yearCode(d.year)
    }
    if (d.legacyManualYear !== undefined) yearCode(d.legacyManualYear)
    if (d.manufactureDate) manufacturingYear(d.manufactureDate)
    const l = d.label
    if (!l || !['box', 'device'].includes(l.target) || typeof l.showQr !== 'boolean' ||
        (['width', 'height', 'textX', 'textY', 'fontSize', 'qrX', 'qrY', 'qrSize'] as const).some(k => !Number.isFinite(l[k]))) throw new Error('標籤格式不正確')
    const { year, ...rest } = d
    return { ...rest, version: 2, ...(d.version === 1 ? { legacyManualYear: year } : {}), label: constrainLayout(l) }
  })
}
