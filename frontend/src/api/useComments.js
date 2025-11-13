import { useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import apiClient from '@/api/api'

// 簡易 ETag 管理：每個 orderId 存最近一次 ETag
const etagStore = {
  get(orderId) {
    try { return sessionStorage.getItem(`etag_comments_${orderId}`) || null } catch { return null }
  },
  set(orderId, etag) {
    try { sessionStorage.setItem(`etag_comments_${orderId}`, etag) } catch {}
  }
}

export function useComments(orderId, pageSize = 50) {
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: ['comments', orderId],
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()
      params.set('limit', pageSize)
      if (pageParam) params.set('after', pageParam)

      const headers = {}
      const prevTag = etagStore.get(orderId)
      if (prevTag && !pageParam) headers['If-None-Match'] = prevTag

      const res = await apiClient.get(`/api/tasks/${orderId}/comments?${params.toString()}`, {
        headers,
        validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
      })

      const etag = res.headers?.etag
      if (etag && !pageParam) etagStore.set(orderId, etag)

      if (res.status === 304) {
        // 沒變動，回傳快取內容
        const cached = queryClient.getQueryData(['comments', orderId])
        return cached?.pages?.[0] ?? { items: [], nextCursor: null, total: 0 }
      }

      return res.data
    },
  })

  // 樂觀更新：新增評論時立即插入頁面快取
  const addOptimistic = (draftComment) => {
    queryClient.setQueryData(['comments', orderId], (old) => {
      const base = old ?? { pages: [], pageParams: [null] }
      const first = base.pages[0] ?? { items: [], nextCursor: null, total: 0 }
      return {
        ...base,
        pages: [{ ...first, items: [...first.items, draftComment] }, ...base.pages.slice(1)],
      }
    })
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['comments', orderId] })

  return { ...query, addOptimistic, invalidate }
}
