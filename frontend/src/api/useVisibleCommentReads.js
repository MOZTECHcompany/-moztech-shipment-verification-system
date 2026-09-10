import { useEffect, useRef } from 'react';

export function isCommentVisible(entry, hidden) {
    return !hidden && entry.isIntersecting && entry.intersectionRect.height >= Math.min(80, entry.boundingClientRect.height / 2);
}

// Observe actual DOM bubbles, including virtualized rows. Offscreen, minimized,
// filtered and unloaded messages never enter the batch. No mark-all endpoint here.
export function useVisibleCommentReads({ orderId, rootRef, comments, markVisibleRead, enabled = true }) {
    const latest = useRef({ comments, markVisibleRead });
    latest.current = { comments, markVisibleRead };
    useEffect(() => {
        const root = rootRef.current;
        if (!enabled || !root || typeof IntersectionObserver === 'undefined') return;
        const seen = new Set(), pending = new Set(), visible = new Map(), timers = new Map();
        let stopped = false, flushTimer, inFlight = false;
        const flush = async () => {
            if (stopped || inFlight || document.visibilityState === 'hidden') return;
            const ids = [...pending].slice(0, 200);
            if (!ids.length) return;
            ids.forEach(id => pending.delete(id));
            inFlight = true;
            try {
                const confirmed = await latest.current.markVisibleRead(ids);
                if (!stopped) confirmed.forEach(id => seen.add(String(id)));
            } catch {
                // Retry only on the next visible observation; never mark unseen IDs.
            } finally {
                inFlight = false;
                if (!stopped && pending.size) flushTimer = setTimeout(flush, 200);
            }
        };
        const consider = (element, entry) => {
            const id = Number(element.dataset.commentId);
            const item = latest.current.comments.find(c => Number(c.id) === id);
            if (!item || item.__optimistic || item.is_read || !Number.isSafeInteger(id) || seen.has(String(id)) || timers.has(element)) return;
            if (!isCommentVisible(entry, document.visibilityState === 'hidden')) return;
            timers.set(element, setTimeout(() => {
                timers.delete(element);
                if (stopped || !element.isConnected || !isCommentVisible(visible.get(element) || {}, document.visibilityState === 'hidden')) return;
                pending.add(id);
                clearTimeout(flushTimer);
                flushTimer = setTimeout(flush, 150);
            }, 400));
        };
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                visible.set(entry.target, entry);
                if (!isCommentVisible(entry, document.visibilityState === 'hidden')) {
                    clearTimeout(timers.get(entry.target)); timers.delete(entry.target);
                } else consider(entry.target, entry);
            }
        }, { root, threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1] });
        const observed = new Map();
        const observe = () => {
            for (const element of observed.keys()) if (!root.contains(element)) { observer.unobserve(element); observed.delete(element); visible.delete(element); }
            root.querySelectorAll('[data-comment-id]').forEach(element => {
                if (observed.get(element) !== element.dataset.commentId) {
                    observer.unobserve(element); visible.delete(element);
                    clearTimeout(timers.get(element)); timers.delete(element);
                    observed.set(element, element.dataset.commentId); observer.observe(element);
                }
            });
        };
        observe();
        const mutations = new MutationObserver(observe);
        mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-comment-id'] });
        const visibility = () => {
            if (document.visibilityState === 'hidden') {
                timers.forEach(clearTimeout); timers.clear(); pending.clear();
            } else visible.forEach((entry, element) => consider(element, entry));
        };
        document.addEventListener('visibilitychange', visibility);
        return () => {
            stopped = true; observer.disconnect(); mutations.disconnect();
            timers.forEach(clearTimeout); clearTimeout(flushTimer);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, [orderId, rootRef, enabled]);
}
