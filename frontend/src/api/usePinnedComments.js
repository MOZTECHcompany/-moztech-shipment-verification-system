import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from './api';
import { pinnedCommentsKey, normalizePinnedComments } from './pinnedComments';

// Personal pins are server-owned. Never reuse the old order-only localStorage cache.
export function usePinnedComments(orderId, user) {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => pinnedCommentsKey(orderId, user), [orderId, user?.id, user?.role]);
    const query = useQuery({
        queryKey,
        enabled: Boolean(orderId && user?.id),
        staleTime: 30000,
        refetchInterval: 60000,
        refetchOnWindowFocus: true,
        queryFn: async ({ signal }) => {
            const response = await apiClient.get(`/api/tasks/${orderId}/pins`, { signal });
            return normalizePinnedComments(response.data?.pinned);
        }
    });
    const invalidatePins = useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey]);
    return { ...query, pinnedComments: query.data ?? [], invalidatePins };
}
