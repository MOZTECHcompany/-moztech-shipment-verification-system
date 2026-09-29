const taipeiDateTime = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Older task summaries omitted the zone on UTC database timestamps.
// Interpret that legacy form consistently on every workstation.
export function parseMessageTimestamp(value) {
    if (value == null || value === '') return null;
    let input = value;
    if (typeof input === 'string') {
        input = input.trim();
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(input)) {
            input = input.replace(' ', 'T') + 'Z';
        }
    }
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatMessageTimestamp(value) {
    const date = parseMessageTimestamp(value);
    if (!date) return '時間未知';
    const parts = Object.fromEntries(taipeiDateTime.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
