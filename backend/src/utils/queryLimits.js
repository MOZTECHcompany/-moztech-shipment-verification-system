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
// The legacy scan-error screen sends explicit ISO instants, unlike date-only reports.
function logDateRange(startDate, endDate) {
    const check = value => {
        if (value === undefined) return null;
        if (typeof value !== 'string') throw invalid('日期格式不正確');
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isoDate(value);
        if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid('日期格式不正確');
        isoDate(value.slice(0, 10));
        return value;
    };
    const start = check(startDate), end = check(endDate);
    if (start && end && Date.parse(start) > Date.parse(end)) throw invalid('開始日期不可晚於結束日期');
    return { start, end };
}
module.exports = { boundedLimit, isoDate, dateRange, logDateRange };
