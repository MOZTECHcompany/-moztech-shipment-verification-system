const xlsx = require('xlsx');

// SheetJS 0.18.5 matches a literal <is> opening tag for inline strings.
// ECOUNT also puts xml:space="preserve" on <is>, so the reader returns an
// empty cell even though the original <t> still contains its exact text.
// Normalize only that wrapper of an inline-string cell. Preserve <t>,
// whitespace, entities, rich text and all other worksheet XML as-is.
const ECOUNT_INLINE_WRAPPER = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|(<(?:\w+:)?c\s[^<>]*>\s*)<((?:\w+:)?is)\s+xml:space\s*=\s*(["'])preserve\3\s*>(?=\s*<(?:\w+:)?(?:t|r)(?:\s|>))/g;
const INLINE_CELL_TYPE = /\s+t\s*=\s*(["'])inlineStr\1(?=[\s>])/;

function readOrderImportWorkbook(buffer, options) {
    // Use the original single read for CSV and legacy XLS. Only OOXML ZIP
    // workbooks can contain the compatibility case.
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return xlsx.read(buffer, options);
    const workbook = xlsx.read(buffer, { ...options, bookFiles: true });
    let archive;
    for (const worksheetPath of workbook.Directory?.sheets ?? []) {
        const name = worksheetPath.replace(/^\//, '');
        const content = workbook.files?.[name]?.content;
        if (!/\.xml$/i.test(name) || !Buffer.isBuffer(content) || !content.includes('xml:space')) continue;
        // latin1 is a byte-for-byte round trip for the XML part. The change
        // targets ASCII markup, leaving the file's own text encoding intact.
        const xml = content.toString('latin1');
        const normalized = xml.replace(ECOUNT_INLINE_WRAPPER, (match, cell, wrapper) =>
            cell && INLINE_CELL_TYPE.test(cell) ? `${cell}<${wrapper}>` : match);
        if (xml === normalized) continue;
        // Reuse SheetJS's ZIP reader/writer and its worksheet parser. There
        // is no filesystem extraction or independent XML/entity parser.
        archive ||= xlsx.CFB.read(buffer, { type: 'buffer' });
        const entry = xlsx.CFB.find(archive, `/${name}`);
        if (!entry || !Buffer.isBuffer(entry.content) || !entry.content.equals(content)) {
            throw new Error('Unable to locate the original inline-string worksheet part');
        }
        entry.content = Buffer.from(normalized, 'latin1');
        entry.size = entry.content.length;
    }
    if (!archive) return workbook;
    const normalizedFile = xlsx.CFB.write(archive, { type: 'buffer', fileType: 'zip', compression: true });
    return xlsx.read(normalizedFile, options);
}

module.exports = { readOrderImportWorkbook };
