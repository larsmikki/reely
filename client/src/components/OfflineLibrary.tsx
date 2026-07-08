import { useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useDesktop } from '@/contexts/DesktopContext'
import { isDesk2Unlocked } from '@/api'
import { listOfflineLibrary, type OfflineLibraryEntry } from '@/offline/videoDownloads'
import { formatDuration, formatBytes } from '@/utils/format'
import type { Video } from '@/types'

// Fallback library for the native app when the server is unreachable: the
// videos saved on this device, rendered from locally stored metadata and
// thumbnails, playable from their sandbox files.
export default function OfflineLibrary({ onPlay }: { onPlay: (video: Video, queue: Video[]) => void }) {
  const { theme } = useTheme()
  const { desktop, deskNames } = useDesktop()
  const [entries, setEntries] = useState<OfflineLibraryEntry[] | null>(null)

  // Desk 2 is PIN-gated and the PIN can only be verified by the server, so
  // offline it stays hidden unless it was already unlocked this session.
  const desk2Locked = desktop === 2 && !isDesk2Unlocked()

  useEffect(() => {
    if (desk2Locked) return
    let cancelled = false
    void listOfflineLibrary(desktop).then(list => { if (!cancelled) setEntries(list) })
    return () => { cancelled = true }
  }, [desktop, desk2Locked])

  const banner = (
    <div
      className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm"
      style={{ background: theme.surface2, color: theme.text2, border: `1px solid ${theme.border}` }}
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m2.828 9.9a5 5 0 010-7.072m7.072 0a5 5 0 010 7.072M12 12h.01" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      </svg>
      <span>
        Can't reach the server — showing videos saved on this device. Everything
        else comes back once the server is reachable again.
      </span>
    </div>
  )

  if (desk2Locked) {
    return (
      <div className="flex flex-col gap-6">
        {banner}
        <p className="text-sm text-center py-16" style={{ color: theme.text2 }}>
          {deskNames[2]} needs the server to verify its PIN and isn't available offline.
        </p>
      </div>
    )
  }

  const videos = (entries ?? []).map(e => e.video)

  return (
    <div className="flex flex-col gap-6">
      {banner}

      {entries !== null && entries.length === 0 ? (
        <p className="text-sm text-center py-16" style={{ color: theme.text2 }}>
          No videos saved for offline on this desk yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {(entries ?? []).map(entry => (
            <OfflineCard key={entry.video.id} entry={entry} onClick={() => onPlay(entry.video, videos)} />
          ))}
        </div>
      )}
    </div>
  )
}

function OfflineCard({ entry, onClick }: { entry: OfflineLibraryEntry; onClick: () => void }) {
  const { theme } = useTheme()
  const { video, size, thumbSrc } = entry
  const [imgError, setImgError] = useState(false)

  return (
    <div
      className="card-hover cursor-pointer relative group"
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
      onClick={onClick}
    >
      <div className="relative aspect-video" style={{ background: theme.surface2, overflow: 'hidden', borderRadius: '12px 12px 0 0' }}>
        {thumbSrc && !imgError ? (
          <img
            src={thumbSrc}
            alt={video.title || 'Video thumbnail'}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} style={{ color: theme.text2 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.9)' }}>
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          </div>
        </div>

        {video.duration !== null && (
          <div className="absolute bottom-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(0,0,0,0.75)', color: '#fff' }}>
            {formatDuration(video.duration)}
          </div>
        )}

        <div
          className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
          style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}
          title="Available offline"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
            <path d="M10 2a1 1 0 011 1v8.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 11.586V3a1 1 0 011-1zM3 16a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
          </svg>
          <span>Offline</span>
        </div>
      </div>

      <div className="p-3">
        <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: theme.text }} title={video.title || undefined}>
          {video.title || <span style={{ color: theme.text2 }}>Untitled</span>}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {video.site && (
            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: theme.surface2, color: theme.text2 }}>
              {video.site}
            </span>
          )}
          <span className="text-xs" style={{ color: theme.text2 }}>{formatBytes(size)}</span>
        </div>
      </div>
    </div>
  )
}
