import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getVideos } from '@/api'
import { queryKeys } from '@/queryKeys'

export const VIDEOS_PAGE_SIZE = 48

// One pagination strategy for every video grid: pages of VIDEOS_PAGE_SIZE,
// loaded as the user scrolls (see LoadMoreSentinel).
export function useInfiniteVideos(params: {
  q?: string
  collection_id?: number | 'uncategorized'
  sort?: string
  refreshKey: number
}) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.videos({ ...params, infinite: true }),
    queryFn: ({ pageParam }) => getVideos({
      page: pageParam,
      limit: VIDEOS_PAGE_SIZE,
      q: params.q,
      collection_id: params.collection_id,
      sort: params.sort,
    }),
    initialPageParam: 1,
    getNextPageParam: last => (last.page < last.totalPages ? last.page + 1 : undefined),
    refetchInterval: q =>
      q.state.data?.pages[0]?.hasPendingAny ? 4000 : false,
  })

  const videos = useMemo(
    () => query.data?.pages.flatMap(p => p.items) ?? [],
    [query.data],
  )
  const total = query.data?.pages[0]?.total ?? 0

  return { ...query, videos, total }
}
