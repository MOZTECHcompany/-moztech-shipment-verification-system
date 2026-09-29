import React from 'react';
import { formatMessageTimestamp, parseMessageTimestamp } from '@/utils/messageTimestamp';

export function MessageTimestamp({ value, className = '' }) {
    const date = parseMessageTimestamp(value);
    const valid = Boolean(date);
    return (
        <time dateTime={valid ? date.toISOString() : undefined}
            title={valid ? '台灣時間（UTC+8）' : undefined}
            className={`whitespace-nowrap tabular-nums ${className}`}>
            {formatMessageTimestamp(value)}
        </time>
    );
}
