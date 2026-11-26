const { BadRequestException } = require('./errors');
const PDFDocument = require('pdfkit');
const { join } = require('path');
const XLSX = require('xlsx');
const QR = require('qrcode');
const BWIP = require('bwip-js');
const { drawCartonLabel } = require('./carton-label-layout');
const mm = 72 / 25.4;
const font = join(__dirname, '../../assets/fonts/NotoSansCJKtc-Regular.otf');
const EXPORT_KINDS = [
    'labels',
    'cartons',
    'cartons-no-sn',
    'warranty',
    'warehouse',
    'warehouse-cartons',
];
class SnLabelsExport {
    warehouseCartons(d, boxes, batchId) {
        if (!d.sku || boxes.length < 1)
            throw new BadRequestException('請核對商品品號及箱序範圍');
        const internationalBarcode = d.barcode.startsWith('ITM-') ? '' : d.barcode;
        const rows = boxes.map((box) => [
            internationalBarcode, d.productName, d.model, box.quantity, box.id,
            box.serials.join(','), d.sku, internationalBarcode ? '' : d.barcode, 'corely-wms-sn-trial', batchId,
        ]);
        const headers = [
            '國際條碼', '品名', '產品型號', '數量', '箱號', 'SN', '品號',
            '內部掃描碼', '來源系統', '來源識別',
        ];
        const workbook = XLSX.utils.book_new();
        const cartonSheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        cartonSheet['!cols'] = [20, 32, 18, 10, 26, 50, 20, 20, 25, 38].map((wch) => ({ wch }));
        XLSX.utils.book_append_sheet(workbook, cartonSheet, '箱號明細');
        const warehouseSheet = XLSX.utils.aoa_to_sheet([
            ['收貨倉庫', ...headers.slice(0, 4), '單價', ...headers.slice(4)],
            ...rows.map((row) => ['', ...row.slice(0, 4), '', ...row.slice(4)]),
        ]);
        warehouseSheet['!cols'] = [
            { wch: 18 }, ...cartonSheet['!cols'].slice(0, 4), { wch: 10 },
            ...cartonSheet['!cols'].slice(4),
        ];
        XLSX.utils.book_append_sheet(workbook, warehouseSheet, '倉儲明細');
        return XLSX.write(workbook, {
            type: 'buffer', bookType: 'xlsx', compression: true,
        });
    }
    workbook(kind, d, items, columns) {
        if (kind === 'warranty' && d.barcode.startsWith('ITM-'))
            throw new BadRequestException('保固範本需要國際條碼');
        const mapping = {
            一般序號: (s) => s.sn,
            SKU: () => /^\d+$/.test(d.barcode) ? d.barcode : '',
            國際條碼: () => /^\d+$/.test(d.barcode) ? d.barcode : '',
            'ERP SKU': () => d.sku,
            箱號: (s) => s.carton_id,
            產品名稱: () => d.productName,
            型號: () => d.model,
            款式: () => d.style,
            顏色: () => d.color,
            下單日期: () => d.orderDate,
            製造日期: () => d.manufactureDate,
            箱內順序: (s) => String(s.position),
        };
        const headers = kind === 'warranty'
            ? ['一般序號', 'SKU']
            : columns?.length
                ? columns
                : [
                    '一般序號',
                    '國際條碼',
                    '箱號',
                    '箱內順序',
                    '產品名稱',
                    '型號',
                    '款式',
                    '顏色',
                    '下單日期',
                    '製造日期',
                ];
        if (headers.length > 12 ||
            new Set(headers).size !== headers.length ||
            headers.some((h) => !mapping[h]) ||
            !headers.includes('一般序號'))
            throw new BadRequestException('匯出欄位無效，必須包含一般序號');
        const sheet = XLSX.utils.aoa_to_sheet([
            headers,
            ...items.map((s) => headers.map((h) => mapping[h](s))),
        ]);
        // Strings preserve leading zeroes and prevent formula execution.
        sheet['!cols'] = headers.map(() => ({ wch: 25 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, sheet, kind === 'warranty' ? '保固序號' : 'SN 明細');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
    async pdf(kind, d, items, boxes) {
        const isCarton = kind.startsWith('carton'), scale = (d.cartonWidth || 60) / 60;
        const width = isCarton ? 60 * scale : d.label.width, height = isCarton
            ? (kind === 'cartons-no-sn' ? 45 : 75) * scale
            : d.label.height;
        const doc = new PDFDocument({
            autoFirstPage: false,
            margin: 0,
            compress: true,
        });
        const chunks = [];
        const result = new Promise((resolve, reject) => {
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
        });
        const text = (s, x, y, size, maxWidth) => {
            doc.font(font).fontSize(size * mm);
            if (doc.widthOfString(s) > maxWidth * mm + 0.01)
                throw new BadRequestException('標籤文字超出範圍，請縮小字級或放大標籤');
            doc.fillColor('black').text(s, x * mm, y * mm, { lineBreak: false });
        };
        const qr = (value, x, y, size, serialList = false) => {
            let q = QR.create(value, { errorCorrectionLevel: 'M' }).modules;
            // Keep the full comma-separated list and four quiet-zone modules on each side.
            if (serialList && size / (q.size + 8) < 0.2)
                q = QR.create(value, { errorCorrectionLevel: 'L' }).modules;
            const n = q.size, unit = size / (n + 8);
            if (unit < (serialList ? 2 / 12 : 0.2))
                throw new BadRequestException(serialList
                    ? '25 mm QR Code 無法清楚容納這箱的 SN，請降低每箱容量。'
                    : 'QR Code 過密，請放大標籤或降低每箱容量後再配號');
            doc
                .fillColor('white')
                .rect(x * mm, y * mm, size * mm, size * mm)
                .fill();
            doc.fillColor('black');
            if (isCarton) {
              // Fill a single vector path to avoid pale seams between adjacent modules on thermal rasters.
              for (let row = 0; row < n; row++) {
                for (let col = 0; col < n;) {
                  if (!q.get(row, col)) { col++; continue; }
                  const first = col++;
                  while (col < n && q.get(row, col)) col++;
                  doc.rect((x + (first + 4) * unit) * mm, (y + (row + 4) * unit) * mm, (col - first) * unit * mm, unit * mm);
                }
              }
              doc.fill();
              return;
            }
            for (let row = 0; row < n; row++)
                for (let col = 0; col < n; col++)
                    if (q.get(row, col))
                        doc
                            .rect((x + (col + 4) * unit) * mm, (y + (row + 4) * unit) * mm, unit * mm, unit * mm)
                            .fill();
        };
        const bars = (value, x, y, w, h) => {
            const raw = BWIP.raw({ bcid: 'code128', text: value })[0].sbs;
            const modules = raw.reduce((a, b) => a + b, 0);
            const maximum = w / (modules + 20);
            // Dense trial IDs benefit from integral print dots on 300 dpi stock.
            const dot = 25.4 / 300;
            const dense = maximum < 1.5 * 25.4 / 203 && maximum >= dot;
            const unit = dense ? Math.floor(maximum / dot) * dot : maximum;
            const center = x + (w - modules * unit) / 2;
            let pos = dense ? Math.max(x + 10 * unit, Math.min(x + w - (modules + 10) * unit, Math.round(center / dot) * dot)) : center;
            raw.forEach((v, i) => {
                if (i % 2 === 0)
                    doc
                        .fillColor('black')
                        .rect(pos * mm, y * mm, v * unit * mm, h * mm)
                        .fill();
                pos += v * unit;
            });
        };
        try {
            for (const item of isCarton ? boxes : items) {
                doc.addPage({ size: [width * mm, height * mm], margin: 0 });
                if (!isCarton) {
                    const l = d.label, title = [d.model, d.style, d.color].filter(Boolean).join(' '), lines = [
                        title,
                        '製造日期 ' + d.manufactureDate.replaceAll('-', '').slice(0, 6),
                        'SN: ' + item.sn,
                    ];
                    const bottom = l.textY + l.fontSize * 3.8;
                    if (bottom > l.height)
                        throw new BadRequestException('文字高度超出標籤');
                    const tw = Math.max(...lines.map((line) => doc
                        .font(font)
                        .fontSize(l.fontSize * mm)
                        .widthOfString(line) / mm));
                    if (l.showQr &&
                        l.textX < l.qrX + l.qrSize &&
                        l.textX + tw > l.qrX &&
                        l.textY < l.qrY + l.qrSize &&
                        bottom > l.qrY)
                        throw new BadRequestException('文字與 QR Code 重疊，請調整版面');
                    lines.forEach((line, i) => text(line, l.textX, l.textY + i * l.fontSize * 1.25, l.fontSize, l.width - l.textX));
                    if (l.showQr)
                        qr(item.sn, l.qrX, l.qrY, l.qrSize);
                }
                else {
                    drawCartonLabel(doc, font, width, height, d, item, kind !== 'cartons-no-sn', true, qr, bars);
                }
            }
            doc.end();
            return await result;
        }
        catch (error) {
            doc.end();
            await result;
            throw error;
        }
    }
}

module.exports = { EXPORT_KINDS, SnLabelsExport };
