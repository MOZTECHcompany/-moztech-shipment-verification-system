export function pinnedCommentsKey(orderId, user) {
    return ['personal-comment-pins', String(orderId), String(user?.id ?? ''), user?.role ?? ''];
}

export function normalizePinnedComments(items) {
    return Array.from(new Map((Array.isArray(items) ? items : [])
        .filter(item => item && item.id && typeof item.content === 'string' && !item.is_retracted)
        .map(item => [String(item.id), item])).values());
}
