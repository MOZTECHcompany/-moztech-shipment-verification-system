"use strict";
const { BadRequestException } = require('./errors');
const mm = 72 / 25.4;
const cartonQrSizeMm = 25;
const fontSizePt = 11;
const lineHeight = 4.75;
const margin = 2;
// All coordinates are millimetres. PDFKit font sizes are already in points.
function drawCartonLabel(doc, font, width, height, data, box, showSerials, showCartonQr, qr, bars) {
    doc.font(font).fontSize(fontSizePt);
    const measure = (s) => doc.widthOfString(s) / mm;
    const print = (s, x, y) => doc.fillColor('black').text(s, x * mm, y * mm, { lineBreak: false });
    function wrap(value, available) {
        const rows = [];
        let row = '';
        for (const ch of value.replace(/\s+/gu, ' ').trim()) {
            if (row && measure(row + ch) > available) {
                rows.push(row.trimEnd());
                row = '';
            }
            if (row || ch !== ' ')
                row += ch;
        }
        if (row)
            rows.push(row);
        return rows;
    }
    const contentWidth = width - 2 * margin;
    const columnGap = 1.2;
    const sideWidth = contentWidth - cartonQrSizeMm - columnGap;
    const headerWidth = showCartonQr ? sideWidth : contentWidth;
    const model = '型號: ' + data.model, quantity = '一箱共 ' + box.quantity + ' 入';
    const sharedRow = measure(model) + columnGap + measure(quantity) <= headerWidth;
    const header = [
        ...wrap(model, headerWidth),
        ...wrap('款式: ' + (data.style || '—'), headerWidth),
        ...wrap('顏色: ' + (data.color || '—'), headerWidth),
        ...(sharedRow ? [] : wrap(quantity, headerWidth)),
    ];
    const headerHeight = Math.max(header.length * lineHeight, showCartonQr ? cartonQrSizeMm : 0);
    const idText = '箱號: ' + box.id;
    const cartonId = measure(idText) > contentWidth && measure(box.id) <= contentWidth
        ? ['箱號:', box.id] : wrap(idText, contentWidth);
    function serialLines(sn) {
        if (measure(sn) <= sideWidth)
            return [sn];
        // Keep the six-digit running number together when a trial prefix needs a second row.
        const match = /^(.*?)([0-9]{6})$/.exec(sn);
        const wrapped = wrap(sn, sideWidth);
        if (!match) return wrapped;
        const grouped = [...wrap(match[1], sideWidth), match[2]];
        return grouped.length <= wrapped.length ? grouped : wrapped;
    }
    const serialRows = showSerials ? [
        '箱內序號', ...serialLines(box.serials[0]), '至',
        ...serialLines(box.serials[box.serials.length - 1]),
    ] : [];
    const footerHeight = showSerials ? Math.max(cartonQrSizeMm, serialRows.length * lineHeight) : 0;
    const minBarHeight = 5, gapBeforeBars = 0.7, gapAfterBars = 0.3, gapBeforeFooter = showSerials ? 1 : 0;
    const required = headerHeight + gapBeforeBars + minBarHeight + gapAfterBars
        + cartonId.length * lineHeight + gapBeforeFooter + footerHeight;
    const free = height - 2 * margin - required;
    if (free < -0.001)
        throw new BadRequestException('11 pt 規格箱文字超出紙張，請加大規格箱貼紙寬度或縮短型號、款式、顏色。');
    const barHeight = Math.min(9.5 * width / 60, minBarHeight + Math.max(0, free));
    const space = Math.max(0, free - (barHeight - minBarHeight));
    const top = margin + space * 0.10;
    header.forEach((s, i) => print(s, margin, top + i * lineHeight));
    if (sharedRow)
        print(quantity, margin + headerWidth - measure(quantity), top);
    if (showCartonQr)
        qr(box.id, width - margin - cartonQrSizeMm, top, cartonQrSizeMm);
    const barY = top + headerHeight + gapBeforeBars + space * (showSerials ? 0.35 : 0.55);
    // Code 128 also reserves ten quiet modules at each end inside this width.
    bars(box.id, 1, barY, width - 2, barHeight);
    const idY = barY + barHeight + gapAfterBars;
    cartonId.forEach((s, i) => print(s, margin, idY + i * lineHeight));
    if (showSerials) {
        const footerY = idY + cartonId.length * lineHeight + gapBeforeFooter + space * 0.40;
        qr(box.serials.join(','), margin, footerY + (footerHeight - cartonQrSizeMm) / 2, cartonQrSizeMm, true);
        const step = (footerHeight - lineHeight) / (serialRows.length - 1);
        serialRows.forEach((s, i) => print(s, margin + cartonQrSizeMm + columnGap, footerY + i * step));
    }
}

module.exports = { drawCartonLabel };
