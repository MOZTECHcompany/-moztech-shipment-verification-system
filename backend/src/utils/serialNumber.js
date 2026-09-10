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

module.exports = {
    normalizeSerialScanInput,
};
