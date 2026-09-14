export function commentQueryKey(orderId, pageSize, user) {
    return ['comments', String(orderId), pageSize, String(user?.id ?? 'anonymous'), user?.role ?? ''];
}

// Validators never outlive their response body or cross a user/page boundary.
export async function fetchCommentPage({ client, orderId, pageSize, pageParam, cached, signal }) {
    const params = new URLSearchParams({ limit: String(pageSize), latest: '1' });
    if (pageParam) params.set('before', pageParam);
    const requestKey = params.toString();
    const usable = cached?.__requestKey === requestKey && Array.isArray(cached?.items);
    const options = { signal, validateStatus: status => (status >= 200 && status < 300) || status === 304 };
    const url = `/api/tasks/${orderId}/comments?${requestKey}`;
    let response = await client.get(url, {
        ...options, headers: usable && cached.__etag ? { 'If-None-Match': cached.__etag } : {}
    });
    if (response.status === 304 && usable) return cached;
    // A stale browser validator or cache eviction must not turn 304 into an empty conversation.
    if (response.status === 304) response = await client.get(url, { ...options, headers: { 'Cache-Control': 'no-cache' } });
    if (response.status === 304 || !Array.isArray(response.data?.items)) throw new Error('留言資料尚未取得，請重新載入');
    return { ...response.data, __requestKey: requestKey, __etag: response.headers?.etag };
}

export function flattenCommentPages(data) {
    const byId = new Map();
    // Pages run newest -> oldest, but each page is chronological. Prefer the fresh head on overlap.
    for (const page of [...(data?.pages || [])].reverse()) {
        for (const item of page.items || []) byId.set(String(item.id), item);
    }
    return [...byId.values()].sort((a, b) => {
        const time = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (time) return time;
        const exactA = a.cursor_created_at, exactB = b.cursor_created_at;
        if (exactA && exactB && exactA !== exactB) return exactA.localeCompare(exactB);
        return Number(a.id) - Number(b.id);
    });
}

// A page can start with a reply whose parent is outside the loaded history.
// Keep that reply reachable; group loaded descendants without losing nested replies.
export function buildCommentThreads(comments) {
    const byId = new Map(comments.map(comment => [String(comment.id), comment]));
    const roots = new Map();
    for (const comment of comments) {
        let root = comment;
        const seen = new Set([String(root.id)]);
        while (root.parent_id && byId.has(String(root.parent_id)) && !seen.has(String(root.parent_id))) {
            root = byId.get(String(root.parent_id)); seen.add(String(root.id));
        }
        if (!roots.has(String(root.id))) roots.set(String(root.id), { ...root, replies: [] });
        if (root.id !== comment.id) roots.get(String(root.id)).replies.push(comment);
    }
    return [...roots.values()];
}
