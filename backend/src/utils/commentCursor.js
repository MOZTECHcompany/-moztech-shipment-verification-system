// Keep the database's timestamp text: JS Date truncates PostgreSQL microseconds.
function encodeCommentCursor(row) {
    if (!row) return null;
    return `v1:${Buffer.from(JSON.stringify({ createdAt: row.cursor_created_at || row.created_at, id: row.id })).toString('base64url')}`;
}

function decodeCommentCursor(value) {
    if (!value) return null;
    try {
        if (typeof value !== 'string' || value.length > 512) throw new Error();
        if (!value.startsWith('v1:')) {
            if (!Number.isFinite(Date.parse(value))) throw new Error();
            return { createdAt: value, id: null }; // Legacy timestamp-only after cursor.
        }
        const cursor = JSON.parse(Buffer.from(value.slice(3), 'base64url').toString('utf8'));
        if (typeof cursor.createdAt !== 'string' || !Number.isFinite(Date.parse(cursor.createdAt)) ||
            !Number.isSafeInteger(cursor.id) || cursor.id <= 0) throw new Error();
        return cursor;
    } catch {
        const error = new Error('留言分頁游標無效，請重新載入留言');
        error.status = 400;
        error.code = 'INVALID_COMMENT_CURSOR';
        throw error;
    }
}

module.exports = { encodeCommentCursor, decodeCommentCursor };
