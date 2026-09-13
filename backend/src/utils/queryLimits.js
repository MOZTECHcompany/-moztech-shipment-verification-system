const invalid = message => Object.assign(new Error(message), { status: 400 });
function boundedLimit(value, fallback = 100, max = 1000) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) throw invalid('查詢筆數格式不正確');
    return Math.min(Number(value), max);
}
function isoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('日期格式不正確');
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw invalid('日期格式不正確');
    return value;
}
function dateRange(startDate, endDate, required = false) {
    if (required && (!startDate || !endDate)) throw invalid('請選擇完整的日期範圍');
    const start = startDate === undefined ? null : isoDate(startDate);
    const end = endDate === undefined ? null : isoDate(endDate);
    if (start && end && start > end) throw invalid('開始日期不可晚於結束日期');
    return { start, end };
}
module.exports = { boundedLimit, isoDate, dateRange };
