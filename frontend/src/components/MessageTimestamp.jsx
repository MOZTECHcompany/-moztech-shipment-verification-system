import React from 'react';
import { formatMessageTimestamp } from '@/utils/messageTimestamp';

export function MessageTimestamp({ value, className = '' }) {
    const date = value == null || value === '' ? null : new Date(value);
    const valid = date && !Number.isNaN(date.getTime());
    return (
        <time dateTime={valid ? date.toISOString() : undefined}
            title={valid ? '台灣時間（UTC+8）' : undefined}
            className={`whitespace-nowrap tabular-nums ${className}`}>
            {formatMessageTimestamp(value)}
        </time>
    );
}
