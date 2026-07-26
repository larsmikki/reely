import { memo, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from '@/contexts/ThemeContext'
import { thumbnailUrl, cleanupAndRetryVideo, refreshVideoThumbnail, captureVideoThumbnail, bulkMoveVideos } from '@/api'
import { useActiveVideoJob, useJobs, JOB_KIND_LABEL } from '@/contexts/JobsContext'
import { usePlayer } from '@/contexts/PlayerContext'
import { useDesktop } from '@/contexts/DesktopContext'
import { ConfirmDialog, Modal, useToast } from '@/components/ui'
import CastPanel from '@/components/CastPanel'
import {
  downloadVideo,
  removeOfflineVideo,
  useOfflineState,
} from '@/offline/videoDownloads'
import type { Video, Collection } from '@/types'
import { formatDuration } from '@/utils/format'

interface VideoCardProps {
  video: Video
  onClick: (video: Video) => void
  onDelete: (video: Video) => void
  onEdit: (video: Video) => void
  collectionMap: Map<number, Collection>
  showCollection?: boolean
  onMoved?: () => void
}

type MenuIconName = 'edit' | 'external' | 'copy' | 'refresh' | 'camera' | 'move' | 'download' | 'cast' | 'trash'

function MenuIcon({ name }: { name: MenuIconName }) {
  const shared = 'w-4 h-4 shrink-0'
  switch (name) {
    case 'edit':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 7.125L16.875 4.5" />
        </svg>
      )
    case 'external':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 8.25v9A1.75 1.75 0 007.75 19h8.5A1.75 1.75 0 0018 17.25v-3" />
        </svg>
      )
    case 'copy':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h9.25A1.75 1.75 0 0119 9.75V19a1.75 1.75 0 01-1.75 1.75H8A1.75 1.75 0 016.25 19V9.75A1.75 1.75 0 018 8z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 16H4.75A1.75 1.75 0 013 14.25V5a1.75 1.75 0 011.75-1.75H14A1.75 1.75 0 0115.75 5v.25" />
        </svg>
      )
    case 'refresh':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8.1 8.1 0 00-15.5-2M4 5v4h4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
        </svg>
      )
    case 'camera':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 8.25A2.25 2.25 0 016.75 6h1.5l1.2-1.6A1 1 0 0110.25 4h3.5a1 1 0 01.8.4L15.75 6h1.5a2.25 2.25 0 012.25 2.25v8.5A2.25 2.25 0 0117.25 19H6.75a2.25 2.25 0 01-2.25-2.25v-8.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.25a3 3 0 106 0 3 3 0 00-6 0z" />
        </svg>
      )
    case 'move':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h10m0 0l-3-3m3 3l-3 3" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 17H6m0 0l3 3m-3-3l3-3" />
        </svg>
      )
    case 'download':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 18.5h14" />
        </svg>
      )
    case 'cast':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.75A2.75 2.75 0 0 1 5.75 4h12.5A2.75 2.75 0 0 1 21 6.75v8.5A2.75 2.75 0 0 1 18.25 18H13" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 14.5A6.5 6.5 0 0 1 9.5 21M3 18.5A2.5 2.5 0 0 1 5.5 21M3 21h.01" />
        </svg>
      )
    case 'trash':
      return (
        <svg className={shared} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12m-9 0V5.75A1.75 1.75 0 0110.75 4h2.5A1.75 1.75 0 0115 5.75V7m-7.5 0l.75 12A2 2 0 0010.25 21h3.5a2 2 0 002-2L16.5 7" />
        </svg>
      )
  }
}

const VideoCard = memo(function VideoCard({
  video,
  onClick,
  onDelete,
  onEdit,
  collectionMap,
  showCollection = true,
  onMoved,
}: VideoCardProps) {
  const { theme } = useTheme()
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const { desktop, deskNames } = useDesktop()
  const targetDesktop: 1 | 2 = desktop === 1 ? 2 : 1
  const [moving, setMoving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [castModalOpen, setCastModalOpen] = useState(false)
  const activeJob = useActiveVideoJob(video.id)
  const { musicMode, video: playingVideo, videoRef } = usePlayer()

  const isActiveMusic = musicMode && playingVideo?.id === video.id
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!isActiveMusic) return
    const el = videoRef.current
    if (!el) return
    setPaused(el.paused)
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [isActiveMusic, videoRef])

  const collection = video.collection_id != null ? collectionMap.get(video.collection_id) : undefined
  const isPending = video.fetch_status === 'pending' || !!activeJob

  // The worker runs one job at a time, FIFO by id — count what's ahead of us.
  const { jobs: allJobs } = useJobs()
  const queuedAhead = useMemo(() => {
    if (!activeJob || activeJob.status !== 'pending') return null
    return allJobs.filter(
      j => j.status === 'running' || (j.status === 'pending' && j.id < activeJob.id),
    ).length
  }, [allJobs, activeJob])

  const [offlineRemoveConfirmOpen, setOfflineRemoveConfirmOpen] = useState(false)

  const handleMenuClick = (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(p => !p) }
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    onDelete(video)
  }
  const handleEdit = (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(false); onEdit(video) }
  const [refreshThumbStatus, setRefreshThumbStatus] = useState<'idle' | 'queued' | 'error'>('idle')
  const handleRefreshThumb = async (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    setRefreshThumbStatus('idle')
    try {
      await refreshVideoThumbnail(video.id)
      setRefreshThumbStatus('queued')
      setTimeout(() => setRefreshThumbStatus('idle'), 2500)
    } catch {
      setRefreshThumbStatus('error')
      setTimeout(() => setRefreshThumbStatus('idle'), 4000)
    }
  }
  const [capturing, setCapturing] = useState(false)
  const [captureBust, setCaptureBust] = useState<number | null>(null)
  const handleCaptureThumb = async (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    setCapturing(true)
    try {
      await captureVideoThumbnail(video.id)
      setCaptureBust(Date.now())
      setImgError(false)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to capture thumbnail', 'error')
    } finally {
      setCapturing(false)
    }
  }
  const handleMove = async (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    setMoving(true)
    try {
      await bulkMoveVideos([video.id], targetDesktop)
      onMoved?.()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to move video', 'error')
    }
    finally { setMoving(false) }
  }
  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    setRetrying(true)
    try {
      await cleanupAndRetryVideo(video.id)
      await queryClient.invalidateQueries({ queryKey: ['videos'] })
    } catch { /* surfaced again as fetch_error on the next refetch */ }
    finally { setRetrying(false) }
  }
  const handleOpenOriginal = (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    window.open(video.page_url, '_blank', 'noopener,noreferrer')
  }
  const handleCopyLink = async (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    try {
      await navigator.clipboard.writeText(video.page_url)
      addToast('Link copied', 'success')
    } catch {
      addToast('Could not copy the link', 'error')
    }
  }
  const handleCast = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    setCastModalOpen(true)
  }
  const handleCopyError = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!video.fetch_error) return
    try {
      await navigator.clipboard.writeText(video.fetch_error)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  const offline = useOfflineState(video.id)
  const handleOfflineToggle = (e: React.MouseEvent) => {
    e.stopPropagation(); setMenuOpen(false)
    if (offline.status === 'available') {
      setOfflineRemoveConfirmOpen(true)
    } else if (offline.status === 'absent' || offline.status === 'error') {
      void downloadVideo(video)
    }
  }
  const offlineLabel =
    offline.status === 'available' ? 'Remove offline copy'
    : offline.status === 'downloading' ? `Downloading… ${Math.round(offline.progress * 100)}%`
    : offline.status === 'error' ? 'Retry offline download'
    : 'Save for offline'

  const offlineIcon: MenuIconName = offline.status === 'available' ? 'trash' : 'download'
  const menuItemClass = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:opacity-80 disabled:opacity-60'
  const menuLabelClass = 'min-w-0 flex-1 truncate whitespace-nowrap'

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!isActiveMusic) return
    e.stopPropagation()
    const el = videoRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => {}); else el.pause()
  }

  const showPauseIcon = isActiveMusic && !paused

  return (
    <div
      className="card-hover cursor-pointer relative group"
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        // While the menu is open, lift this card above its grid siblings so the
        // dropdown isn't painted behind later cards (the hover transform on
        // .card-hover creates a stacking context that would otherwise trap it).
        zIndex: menuOpen ? 30 : undefined,
      }}
      onClick={() => onClick(video)}
    >
      {refreshThumbStatus !== 'idle' && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-2.5 py-1 rounded-full text-[11px] font-medium shadow"
          style={{
            background: refreshThumbStatus === 'queued' ? theme.accent : '#e11d48',
            color: '#fff',
          }}
        >
          {refreshThumbStatus === 'queued' ? 'Thumbnail refresh queued' : 'Refresh failed'}
        </div>
      )}
      <div className="relative aspect-video bg-black" style={{ background: theme.surface2, overflow: 'hidden', borderRadius: '12px 12px 0 0' }}>
        {isPending ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: `${theme.accent} transparent ${theme.accent} ${theme.accent}` }}
            />
            {activeJob && (
              <span className="text-xs text-center" style={{ color: theme.text2 }}>
                {activeJob.status === 'pending'
                  ? queuedAhead ? `Queued · ${queuedAhead} ahead` : 'Queued'
                  : JOB_KIND_LABEL[activeJob.kind]}
              </span>
            )}
          </div>
        ) : video.fetch_status === 'error' ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center"
            onClick={e => e.stopPropagation()}
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#e11d48' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-xs font-semibold" style={{ color: theme.text }}>Failed to load</span>
            {video.fetch_error && (
              <span
                className="text-[11px] leading-tight line-clamp-3 break-words select-text"
                style={{ color: theme.text2 }}
                title={video.fetch_error}
              >
                {video.fetch_error}
              </span>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="text-xs font-medium px-2.5 py-1 rounded transition-opacity hover:opacity-80 disabled:opacity-60"
                style={{ background: theme.accent, color: '#fff' }}
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
              {video.fetch_error && (
                <button
                  onClick={handleCopyError}
                  className="text-xs font-medium px-2.5 py-1 rounded transition-opacity hover:opacity-80"
                  style={{ background: theme.surface2, color: theme.text2 }}
                >
                  {copied ? 'Copied' : 'Copy error'}
                </button>
              )}
            </div>
          </div>
        ) : !imgError ? (
          <img
            src={captureBust ? `${thumbnailUrl(video.id)}?t=${captureBust}` : thumbnailUrl(video.id)}
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

        {/* Progress bar for active jobs */}
        {activeJob && activeJob.progress > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0"
            style={{ height: 3, background: 'rgba(0,0,0,0.35)' }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(activeJob.progress * 100)}%`,
                background: theme.accent,
                transition: 'width 0.25s linear',
              }}
            />
          </div>
        )}

        {video.fetch_status === 'ok' && !isPending && (
          <div
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${isActiveMusic ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            style={{ background: isActiveMusic ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.4)' }}
            onClick={handleOverlayClick}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(220,38,38,0.9)' }}
              title={isActiveMusic ? (showPauseIcon ? 'Pause' : 'Play') : undefined}
              aria-label={isActiveMusic ? (showPauseIcon ? 'Pause' : 'Play') : undefined}
            >
              {showPauseIcon ? (
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              )}
            </div>
          </div>
        )}

        {video.duration !== null && (
          <div className="absolute bottom-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(0,0,0,0.75)', color: '#fff' }}>
            {formatDuration(video.duration)}
          </div>
        )}

        {showCollection && collection && (
          <div className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full border border-white/30" style={{ background: collection.color }} title={collection.name} />
        )}

        {offline.status === 'available' && (
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
        )}
        {offline.status === 'downloading' && (
          <div
            className="absolute top-0 left-0 right-0"
            style={{ height: 3, background: 'rgba(0,0,0,0.35)' }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(offline.progress * 100)}%`,
                background: '#22c55e',
                transition: 'width 0.25s linear',
              }}
            />
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium leading-snug line-clamp-2"
              style={{ color: theme.text }}
              title={video.title || undefined}
            >
              {video.title || <span style={{ color: theme.text2 }}>Untitled</span>}
            </p>

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {video.site && (
                <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: theme.surface2, color: theme.text2 }}>
                  {video.site}
                </span>
              )}
              {showCollection && collection && (
                <span className="flex items-center gap-1 text-xs" style={{ color: theme.text2 }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: collection.color }} />
                  {collection.name}
                </span>
              )}
            </div>
          </div>

          <div className="relative shrink-0">
            <button onClick={handleMenuClick} className="w-6 h-6 flex items-center justify-center rounded transition-colors" style={{ color: theme.text2 }} title="More options">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={e => { e.stopPropagation(); setMenuOpen(false) }} />
                <div
                  role="menu"
                  aria-label="Video actions"
                  className="absolute right-0 top-7 z-20 w-56 max-w-[calc(100vw-2rem)] py-1 rounded-lg shadow-lg"
                  style={{ background: theme.surface, border: `1px solid ${theme.border}` }}
                >
                  <button onClick={handleEdit} className={menuItemClass} style={{ color: theme.text }} role="menuitem">
                    <span style={{ color: theme.text2 }}><MenuIcon name="edit" /></span>
                    <span className={menuLabelClass}>Edit details</span>
                  </button>

                  <div className="my-1 h-px" style={{ background: theme.border }} />

                  <button onClick={handleOpenOriginal} className={menuItemClass} style={{ color: theme.text }} role="menuitem">
                    <span style={{ color: theme.text2 }}><MenuIcon name="external" /></span>
                    <span className={menuLabelClass}>Open original</span>
                  </button>
                  <button onClick={handleCopyLink} className={menuItemClass} style={{ color: theme.text }} role="menuitem">
                    <span style={{ color: theme.text2 }}><MenuIcon name="copy" /></span>
                    <span className={menuLabelClass}>Copy link</span>
                  </button>

                  <div className="my-1 h-px" style={{ background: theme.border }} />

                  <button onClick={handleRefreshThumb} className={menuItemClass} style={{ color: theme.text }} role="menuitem">
                    <span style={{ color: theme.text2 }}><MenuIcon name="refresh" /></span>
                    <span className={menuLabelClass}>Refresh thumbnail</span>
                  </button>
                  {imgError && video.local_path && (
                    <button onClick={handleCaptureThumb} disabled={capturing} className={menuItemClass} style={{ color: theme.text }} role="menuitem">
                      <span style={{ color: theme.text2 }}><MenuIcon name="camera" /></span>
                      <span className={menuLabelClass}>{capturing ? 'Capturing...' : 'Capture thumbnail'}</span>
                    </button>
                  )}
                  <div className="my-1 h-px" style={{ background: theme.border }} />

                  <button onClick={handleMove} disabled={moving} className={menuItemClass} style={{ color: theme.text }} role="menuitem">
                    <span style={{ color: theme.text2 }}><MenuIcon name="move" /></span>
                    <span className={menuLabelClass}>{moving ? 'Moving...' : `Move to ${deskNames[targetDesktop]}`}</span>
                  </button>
                  <button
                    onClick={handleOfflineToggle}
                    disabled={offline.status === 'downloading'}
                    className={menuItemClass}
                    style={{ color: theme.text }}
                    role="menuitem"
                  >
                    <span style={{ color: theme.text2 }}><MenuIcon name={offlineIcon} /></span>
                    <span className={menuLabelClass}>{offlineLabel}</span>
                  </button>
                  <button
                    onClick={handleCast}
                    disabled={video.fetch_status !== 'ok' || isPending}
                    className={menuItemClass}
                    style={{ color: theme.text }}
                    role="menuitem"
                  >
                    <span style={{ color: theme.text2 }}><MenuIcon name="cast" /></span>
                    <span className={menuLabelClass}>Cast to DLNA TV</span>
                  </button>

                  <div className="my-1 h-px" style={{ background: theme.border }} />

                  <button onClick={handleDelete} className={menuItemClass} style={{ color: '#e11d48' }} role="menuitem">
                    <MenuIcon name="trash" />
                    <span className={menuLabelClass}>Delete</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={offlineRemoveConfirmOpen}
        title="Remove offline copy"
        message="Remove this video from offline storage?"
        confirmLabel="Remove"
        destructive
        onConfirm={() => void removeOfflineVideo(video.id)}
        onClose={() => setOfflineRemoveConfirmOpen(false)}
      />

      {castModalOpen && (
        <Modal title="Cast to DLNA TV" onClose={() => setCastModalOpen(false)} maxWidth={384}>
          <div className="p-4">
            <CastPanel video={video} />
          </div>
        </Modal>
      )}
    </div>
  )
})

export default VideoCard
