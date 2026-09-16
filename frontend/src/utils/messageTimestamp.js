const taipeiDateTime = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function formatMessageTimestamp(value) {
    if (value == null || value === '') return '時間未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '時間未知';
    const parts = Object.fromEntries(taipeiDateTime.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
