const { BadRequestException } = require('./errors');
function dateYear(value) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
        new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
        throw new BadRequestException('請填寫有效日期（2000～2099）');
    return Number(value.slice(0, 4));
}
function validateDraft(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new BadRequestException('草稿格式錯誤');
    const data = {};
    for (const k of [
        'name',
        'productId',
        'productName',
        'sku',
        'barcode',
        'model',
        'style',
        'color',
        'modelCode',
        'styleCode',
        'colorCode',
        'orderDate',
        'manufactureDate',
    ]) {
        if (typeof input[k] !== 'string' || input[k].length > 250)
            throw new BadRequestException(`欄位格式錯誤：${k}`);
        data[k] = input[k].trim();
    }
    if (!data.name)
        throw new BadRequestException('請填寫批次名稱');
    if (!Number.isInteger(input.quantity) ||
        input.quantity < 1 ||
        input.quantity > 10000)
        throw new BadRequestException('單次配號數量需為 1～10,000');
    if (input.capacity !== null &&
        (!Number.isInteger(input.capacity) ||
            input.capacity < 1 ||
            input.capacity > 100))
        throw new BadRequestException('每箱容量需為 1～100（確保整箱 QR 可編碼）');
    data.quantity = input.quantity;
    data.capacity = input.capacity;
    const l = input.label;
    if (!l ||
        typeof l.showQr !== 'boolean' ||
        !['box', 'device'].includes(l.target))
        throw new BadRequestException('標籤格式錯誤');
    for (const k of [
        'width',
        'height',
        'textX',
        'textY',
        'fontSize',
        'qrX',
        'qrY',
        'qrSize',
    ])
        if (!Number.isFinite(l[k]))
            throw new BadRequestException('標籤尺寸錯誤');
    if (l.width < 15 ||
        l.width > 150 ||
        l.height < 7.5 ||
        l.height > 150 ||
        l.fontSize < 0.8 ||
        l.fontSize > 8 ||
        l.textX < 0 ||
        l.textY < 0 ||
        l.qrX < 0 ||
        l.qrY < 0 ||
        l.qrSize < 3 ||
        l.qrX + l.qrSize > l.width ||
        l.qrY + l.qrSize > l.height)
        throw new BadRequestException('標籤元件超出尺寸');
    data.label = Object.fromEntries([
        'width',
        'height',
        'showQr',
        'target',
        'textX',
        'textY',
        'fontSize',
        'qrX',
        'qrY',
        'qrSize',
    ].map((k) => [k, l[k]]));
    data.cartonWidth = input.cartonWidth ?? 60;
    data.cartonHeight = input.cartonHeight ?? 75;
    if (!Number.isFinite(data.cartonWidth) ||
        !Number.isFinite(data.cartonHeight) ||
        data.cartonWidth < 60 ||
        data.cartonWidth > 150 ||
        Math.abs(data.cartonHeight / data.cartonWidth - 1.25) > 0.001)
        throw new BadRequestException('規格箱標籤請依 60 × 75 mm 等比縮放');
    return data;
}
const isNoSerial = (d) => d.modelCode === 'NSI';
function allocationRule(entity, d) {
    const year = dateYear(d.manufactureDate);
    dateYear(d.orderDate);
    if (!d.productId || !d.model || !/^[A-Za-z0-9_-]{1,40}$/.test(d.model))
        throw new BadRequestException('箱號型號需為 1～40 碼英數字、- 或 _');
    if (!isNoSerial(d) &&
        (!/^[A-Z0-9]+$/.test(d.modelCode) ||
            !/^[A-Z0-9]*$/.test(d.styleCode) ||
            !/^[A-Z0-9]+$/.test(d.colorCode) ||
            !/^[A-Z0-9]{4,6}$/.test(d.modelCode + d.styleCode + d.colorCode)))
        throw new BadRequestException('型號與顏色代碼必填；款式選填，合计 4～6 碼大寫英數字');
    if (!/^(?:\d{8,14}|ITM-[A-Za-z0-9_-]{1,80})$/.test(d.barcode))
        throw new BadRequestException('請先在產品建檔填寫國際條碼或 ITM- 開頭的內部掃描碼');
    if (!d.capacity)
        throw new BadRequestException('請填寫每箱容量');
    const prefix = d.modelCode +
        d.styleCode +
        d.colorCode +
        String(year).slice(-2).split('').reverse().join('');
    const scope = JSON.stringify([
        entity,
        d.modelCode,
        d.styleCode,
        d.colorCode,
        year,
    ]);
    return {
        noSerial: isNoSerial(d),
        prefix,
        scope,
        mergeKey: JSON.stringify([entity, d.productId, scope, d.orderDate]),
        cartonScope: d.orderDate + '|' + d.model,
    };
}
function serial(prefix, n) {
    if (!Number.isInteger(n) || n < 1 || n > 999999)
        throw new BadRequestException('流水號超過六碼上限');
    return 'TRY-' + prefix + String(n).padStart(6, '0');
}
function cartonId(d, n) {
    return `CTN-TRY-${d.orderDate.slice(2).replaceAll('-', '')}-${d.model}-${String(n).padStart(3, '0')}`;
}

module.exports = { dateYear, validateDraft, isNoSerial, allocationRule, serial, cartonId };
