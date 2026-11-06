const { isoDate } = require('./queryLimits');

const normalize = value => value.normalize('NFKC').replace(/[‐‑‒–—−－]/g, '-').trim();
const datedNumber = '(?:\\d{8}|\\d{4}[./-]\\d{1,2}[./-]\\d{1,2})';
const joinedVoucher = new RegExp(`\\b(${datedNumber})[ \\t]*-[ \\t]*(\\d+)\\b`, 'g');
const packingWords = new Set(['出貨', '出貨紀錄', '出貨記錄', '裝箱', '裝貨', '裝箱操作', '裝箱紀錄', '裝箱記錄', '裝箱掃描']);
const adjacentPacking = new RegExp(`(^|\\s)(${datedNumber}(?:[ \\t]*-[ \\t]*\\d+)?)[ \\t]*(?:的[ \\t]*)?(?=(?:${[...packingWords].join('|')})(?:\\s|$))`, 'gu');

function tokenizeErpSearch(value) {
    return normalize(value).replace(adjacentPacking, '$1$2 ').replace(joinedVoucher, '$1-$2').split(/\s+/u).filter(Boolean);
}

function parseErpDate(term) {
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(term);
    const separated = /^(\d{4})([./-])(\d{1,2})\2(\d{1,2})$/.exec(term);
    if (!compact && !separated) return null;
    const [, year, month, day] = compact || [null, separated[1], separated[3], separated[4]];
    if (year === '0000') return null;
    try { return isoDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`); }
    catch { return null; }
}

function parseErpVoucher(term) {
    const match = /^(.+)-(\d+)$/.exec(term);
    const day = match && parseErpDate(match[1]);
    return day ? { day, sequence: match[2] } : null;
}

function voucherDatePattern(day, sequence) {
    // Only validated date digits and an optional numeric ERP sequence enter the pattern.
    const [year, month, date] = isoDate(day).split('-');
    const dash = '[‐‑‒–—−-]';
    const separator = '[./‐‑‒–—−-]';
    const component = value => value.startsWith('0') ? '0?' + value[1] : value;
    const prefix = `^(${year}${month}${date}|${year}${separator}${component(month)}${separator}${component(date)})`;
    const boundary = '([^[:digit:]]|$)';
    if (sequence === undefined) return prefix + boundary;
    if (!/^\d+$/.test(sequence)) throw new TypeError('ERP sequence must contain only digits');
    return `${prefix}([[:space:]]*${dash}[[:space:]]*|[[:space:]]+)${sequence}${boundary}`;
}

module.exports = { tokenizeErpSearch, parseErpDate, parseErpVoucher, voucherDatePattern, packingWords };
