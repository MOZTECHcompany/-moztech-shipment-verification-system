import { useLayoutEffect, useRef, useState, useCallback } from 'react';

export function useCommentScroll({ rootRef, comments, orderId, fetchNextPage, enabled = true }) {
    const atBottom = useRef(true), previous = useRef({ orderId, lastId: null }), anchor = useRef(null);
    const [hasNewMessages, setHasNewMessages] = useState(false);
    const jumpToLatest = useCallback(() => {
        if (rootRef.current) rootRef.current.scrollTop = rootRef.current.scrollHeight;
        atBottom.current = true; setHasNewMessages(false);
    }, [rootRef]);
    useLayoutEffect(() => {
        if (!enabled || !rootRef.current) return;
        const root = rootRef.current;
        const lastId = comments.at(-1)?.id;
        if (anchor.current && anchor.current.firstId !== comments[0]?.id) {
            root.scrollTop = anchor.current.top + root.scrollHeight - anchor.current.height;
            anchor.current = null;
        } else if (anchor.current) {
            // Wait for the older page to commit before restoring its visual anchor.
        } else if (previous.current.orderId !== orderId || previous.current.lastId == null || atBottom.current) {
            root.scrollTop = root.scrollHeight;
        } else if (lastId !== previous.current.lastId) setHasNewMessages(true);
        previous.current = { orderId, lastId };
    }, [comments, orderId, enabled, rootRef]);
    const onScroll = useCallback(() => {
        const root = rootRef.current;
        if (!root) return;
        atBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight < 64;
        if (atBottom.current) setHasNewMessages(false);
    }, [rootRef]);
    const loadOlder = useCallback(async () => {
        const root = rootRef.current;
        if (root) anchor.current = { top: root.scrollTop, height: root.scrollHeight, firstId: comments[0]?.id };
        try { const result = await fetchNextPage(); if (result.isError) anchor.current = null; } catch { anchor.current = null; }
    }, [rootRef, fetchNextPage, comments]);
    return { onScroll, loadOlder, jumpToLatest, hasNewMessages };
}
