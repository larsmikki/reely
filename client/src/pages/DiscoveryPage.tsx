import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '@/contexts/ThemeContext'
import { useDesktop } from '@/contexts/DesktopContext'
import { Button, Spinner, Surface, useToast } from '@/components/ui'
import {
  addDiscoverySuggestion,
  dismissDiscoverySuggestion,
  getDiscoverySuggestions,
  refreshDiscovery,
} from '@/api'
import { queryKeys } from '@/queryKeys'
import { formatDuration } from '@/utils/format'
import type { DiscoverySuggestion } from '@/types'

function publishedLabel(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export default function DiscoveryPage() {
  const { theme } = useTheme()
  const { desktop } = useDesktop()
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())

  const { data, isLoading, isError } = useQuery({
    queryKey: [...queryKeys.discovery, desktop],
    queryFn: getDiscoverySuggestions,
  })
  const suggestions = data?.items ?? []

  function setBusy(id: number, busy: boolean) {
    setBusyIds(current => {
      const next = new Set(current)
      if (busy) next.add(id); else next.delete(id)
      return next
    })
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const result = await refreshDiscovery()
      queryClient.setQueryData([...queryKeys.discovery, desktop], { items: result.items })
      const summary = result.creators_scanned === 0
        ? 'No YouTube creators found yet. Add or refresh a YouTube video first.'
        : `Checked ${result.creators_scanned} creator${result.creators_scanned === 1 ? '' : 's'} and found ${result.items.length} suggestion${result.items.length === 1 ? '' : 's'}.`
      addToast(summary, result.errors.length > 0 && result.creators_scanned === 0 ? 'error' : 'success')
      if (result.errors.length > 0 && result.creators_scanned > 0) {
        addToast(`${result.errors.length} creator scan${result.errors.length === 1 ? '' : 's'} could not be completed.`, 'info')
      }
    } catch (err) {
      addToast((err as Error).message, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleAdd(item: DiscoverySuggestion) {
    setBusy(item.id, true)
    try {
      await addDiscoverySuggestion(item.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.discovery }),
        queryClient.invalidateQueries({ queryKey: ['videos'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collections }),
      ])
      addToast(`Added “${item.title}” to your library.`, 'success')
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.discovery })
      addToast((err as Error).message, 'error')
    } finally {
      setBusy(item.id, false)
    }
  }

  async function handleDismiss(item: DiscoverySuggestion) {
    setBusy(item.id, true)
    try {
      await dismissDiscoverySuggestion(item.id)
      queryClient.setQueryData<{ items: DiscoverySuggestion[] }>(
        [...queryKeys.discovery, desktop],
        current => ({ items: (current?.items ?? []).filter(candidate => candidate.id !== item.id) }),
      )
    } catch (err) {
      addToast((err as Error).message, 'error')
    } finally {
      setBusy(item.id, false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: theme.text }}>
            Discover
          </h1>
          <p className="text-sm mt-1 max-w-xl" style={{ color: theme.text2 }}>
            Recent YouTube uploads from creators already in your library. Nothing is downloaded until you add it.
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={() => void handleRefresh()} disabled={refreshing}>
          {refreshing ? 'Checking creators…' : 'Check for new videos'}
        </Button>
      </div>

      {refreshing && (
        <Surface className="p-4 flex items-center gap-3">
          <Spinner />
          <div>
            <p className="text-sm font-semibold" style={{ color: theme.text }}>Scanning recent uploads</p>
            <p className="text-xs mt-0.5" style={{ color: theme.text2 }}>The first scan may take longer while older library metadata is updated.</p>
          </div>
        </Surface>
      )}

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <EmptyState title="Couldn't load suggestions" detail="Check that the server is reachable, then try again." />
      ) : suggestions.length === 0 && !refreshing ? (
        <EmptyState
          title="No suggestions yet"
          detail="Check for new videos to scan the YouTube creators already represented in your library."
          action={<Button onClick={() => void handleRefresh()}>Run your first scan</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {suggestions.map(item => (
            <SuggestionCard
              key={item.id}
              item={item}
              busy={busyIds.has(item.id)}
              onAdd={() => void handleAdd(item)}
              onDismiss={() => void handleDismiss(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionCard({
  item, busy, onAdd, onDismiss,
}: {
  item: DiscoverySuggestion
  busy: boolean
  onAdd: () => void
  onDismiss: () => void
}) {
  const { theme } = useTheme()
  const date = publishedLabel(item.published_at)
  return (
    <Surface className="overflow-hidden flex flex-col">
      <a href={item.page_url} target="_blank" rel="noreferrer" className="block aspect-video" style={{ background: theme.surface2 }}>
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ color: theme.text2 }}>
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </div>
        )}
      </a>
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <a href={item.page_url} target="_blank" rel="noreferrer" className="font-bold leading-snug line-clamp-2 hover:underline" style={{ color: theme.text }}>
            {item.title}
          </a>
          <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: theme.text2 }}>
            <span className="truncate">{item.channel_name}</span>
            {date && <><span>·</span><span className="shrink-0">{date}</span></>}
            {item.duration != null && <><span>·</span><span className="shrink-0">{formatDuration(item.duration)}</span></>}
          </div>
        </div>
        <p className="text-xs leading-relaxed flex-1" style={{ color: theme.text2 }}>{item.reason}</p>
        {item.collection_name && (
          <p className="text-xs font-medium" style={{ color: theme.accent }}>Will be added to {item.collection_name}</p>
        )}
        <div className="flex gap-2">
          <Button variant="primary" size="sm" className="flex-1" disabled={busy} onClick={onAdd}>Add to library</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss} aria-label={`Dismiss ${item.title}`}>Dismiss</Button>
        </div>
      </div>
    </Surface>
  )
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <div className="flex flex-col items-center text-center py-24 gap-3">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: theme.surface2, color: theme.accent }}>
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
        </svg>
      </div>
      <div>
        <p className="font-semibold" style={{ color: theme.text }}>{title}</p>
        <p className="text-sm mt-1 max-w-md" style={{ color: theme.text2 }}>{detail}</p>
      </div>
      {action}
    </div>
  )
}
