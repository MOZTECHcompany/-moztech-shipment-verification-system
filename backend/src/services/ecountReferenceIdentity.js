const { text } = require('./cartonContents');
function normalizedVoucher(value) {
    const literal = text(value, 'ECOUNT 既有銷貨單號', { max: 100 });
    const match = /^(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[-－–—]\s*(\d{1,9})$/.exec(literal);
    if (!match) return { value: literal, dated: false };
    const [year, month, day, number] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1000 || number < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return { value: literal, dated: false };
    return { value: `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}-${number}`, dated: true };
}
module.exports = { normalizedVoucher };
