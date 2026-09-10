import { useCallback, useMemo } from 'react';
import { useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import apiClient from '@/api/api';
import { commentQueryKey, fetchCommentPage, flattenCommentPages } from './commentPages';

export function useComments(orderId, pageSize = 50) {
    const queryClient = useQueryClient();
    let user;
    try { user = JSON.parse(localStorage.getItem('wms_user') || 'null'); } catch { user = null; }
    const userId = user?.id, userRole = user?.role;
    const queryKey = useMemo(() => commentQueryKey(orderId, pageSize, { id: userId, role: userRole }), [orderId, pageSize, userId, userRole]);
    const query = useInfiniteQuery({
        queryKey,
        enabled: !!orderId,
        initialPageParam: null,
        getNextPageParam: lastPage => lastPage?.previousCursor ?? undefined,
        queryFn: ({ pageParam, signal }) => {
            const stored = queryClient.getQueryData(queryKey);
            const index = stored?.pageParams?.findIndex(value => value === pageParam) ?? -1;
            return fetchCommentPage({ client: apiClient, orderId, pageSize, pageParam, signal, cached: stored?.pages?.[index] });
        }
    });
    const comments = useMemo(() => flattenCommentPages(query.data), [query.data]);
    const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey]);
    const markVisibleRead = useCallback(async ids => {
        const response = await apiClient.post(`/api/tasks/${orderId}/comments/mark-read`, { commentIds: ids });
        const confirmed = new Set((response.data.commentIds || []).map(String));
        queryClient.setQueryData(queryKey, old => old && ({
            ...old,
            pages: old.pages.map(page => ({
                ...page, __etag: undefined,
                items: page.items.map(item => confirmed.has(String(item.id)) ? { ...item, is_read: true, mention_is_read: true } : item)
            }))
        }));
        return [...confirmed];
    }, [orderId, queryClient, queryKey]);
    // Kept for existing callers; synthetic cards must never reuse the server page validator.
    const addOptimistic = useCallback(draft => {
        queryClient.setQueryData(queryKey, old => {
            const base = old ?? { pages: [{ items: [] }], pageParams: [null] };
            return { ...base, pages: [{ ...base.pages[0], __etag: undefined, items: [...base.pages[0].items, draft] }, ...base.pages.slice(1)] };
        });
    }, [queryClient, queryKey]);
    return { ...query, comments, invalidate, addOptimistic, markVisibleRead, currentUserId: userId };
}
