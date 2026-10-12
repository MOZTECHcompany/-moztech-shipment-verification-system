function normalizeSerialScanInput(input) {
    const raw = String(input ?? '').trim();
    const hadSnPrefix = /^SN\s*[:：]/i.test(raw);

    // 去掉舊格式前綴：SN: / SN：
    const withoutPrefix = raw.replace(/^SN\s*[:：]/i, '').trim();
    const normalized = withoutPrefix.toUpperCase();

    // 純數字候選：抓取「連續數字區段」
    // 目的：像 B19B52004754 這種，未來可能只掃到 52004754（尾段數字）
    const digitGroups = normalized.match(/\d+/g) || [];
    const lastGroup = digitGroups.length ? digitGroups[digitGroups.length - 1] : '';
    const longestGroup = digitGroups.reduce((acc, cur) => (cur.length > acc.length ? cur : acc), '');
    const digitsOnly = lastGroup || longestGroup || '';
    const isDigitsOnly = normalized.length > 0 && /^\d+$/.test(normalized);

    return {
        raw,
        normalized,
        digitsOnly,
        hadSnPrefix,
        isDigitsOnly,
    };
}


// Exact vendor identities keep case and punctuation. Canonical fallback is
// retained only after exact matching and is never allowed to choose ambiguity.
function pickExactSerial(instances, rawScan) {
    const raw = String(rawScan ?? '').trim();
    const values = Array.isArray(instances) ? instances : [];
    const pick = (candidates, match) => ({ instance: candidates.length === 1 ? candidates[0] : null,
        ambiguous: candidates.length > 1, match, candidates });
    if (!raw) return pick([], 'none');
    let found = values.filter(instance => instance.serial_number === raw);
    if (found.length) return pick(found, 'exact');
    const plain = raw.replace(/^SN\s*[:：]/i, '').trim();
    if (plain !== raw) {
        found = values.filter(instance => instance.serial_number === plain);
        if (found.length) return pick(found, 'prefixed-exact');
    }
    found = values.filter(instance => typeof instance.serial_number === 'string' && instance.serial_number.toUpperCase() === plain.toUpperCase());
    return pick(found, found.length ? 'canonical' : 'none');
}
function parseExactSerialList(value, expectedQuantity) {
    if (value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0) return [];
    const serials = Array.isArray(value) ? [...value] : String(value).split(/[,\r\n]+/).filter(token => token !== '');
    if (!Number.isSafeInteger(expectedQuantity) || expectedQuantity <= 0 || serials.length !== expectedQuantity) throw new Error(`實際SN筆數必須等於需求數量 ${expectedQuantity}`);
    if (serials.some(sn => typeof sn !== 'string' || !/^[\x21-\x2b\x2d-\x7e]{1,100}$/.test(sn) || /^(?:CARTON:|CTN-)/i.test(sn))) throw new Error('實際SN需為1–100字可列印ASCII，不含空白、逗號或箱號');
    if (new Set(serials).size !== serials.length) throw new Error('實際SN包含重複序號，請核對原始清單');
    return serials;
}

module.exports = {
    normalizeSerialScanInput,
    pickExactSerial,
    parseExactSerialList,
};
