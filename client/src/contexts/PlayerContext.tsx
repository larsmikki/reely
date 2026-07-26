import { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { RefObject, ReactNode } from 'react'
import type { Video } from '@/types'
import { getVideoById, thumbnailUrl } from '@/api'

export type PlayerMode = 'full' | 'mini' | 'closed'

interface PlayerContextValue {
  video: Video | null
  mode: PlayerMode
  videoRef: RefObject<HTMLVideoElement | null>
  musicMode: boolean
  consumePendingSeek: () => number | null
  play: (video: Video, queue?: Video[]) => void
  next: () => void
  previous: () => void
  hasNext: boolean
  hasPrevious: boolean
  minimize: () => void
  expand: () => void
  close: () => void
  toggleMusicMode: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const MUSIC_MODE_KEY = 'music_mode'

export function PlayerProvider({ children, desktop }: { children: ReactNode; desktop: 1 | 2 }) {
  const storageKey = `player_d${desktop}`

  const [video, setVideo] = useState<Video | null>(null)
  const [queue, setQueue] = useState<Video[]>([])
  const [mode, setMode] = useState<PlayerMode>('closed')
  const [musicMode, setMusicMode] = useState<boolean>(() => {
    try { return localStorage.getItem(MUSIC_MODE_KEY) === '1' } catch { return false }
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeekTime = useRef<number | null>(null)
  const musicModeRef = useRef(musicMode)
  useEffect(() => { musicModeRef.current = musicMode })

  // On mount: restore last video if music mode was on
  useEffect(() => {
    if (!musicModeRef.current) return
    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return
      const { videoId, time } = JSON.parse(stored) as { videoId: number; time: number }
      if (!videoId) return
      getVideoById(videoId)
        .then(v => {
          setVideo(v)
          setMode('mini')
          if (time > 5) pendingSeekTime.current = time
        })
        .catch(() => {})
    } catch {}
  }, [storageKey])

  // Persist video ID when it changes (music mode only)
  useEffect(() => {
    if (!musicMode || !video) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ videoId: video.id, time: Math.floor(videoRef.current?.currentTime ?? 0) }))
    } catch {}
  }, [video, musicMode, storageKey])

  // Save currentTime every 5s (music mode uses storageKey; other modes use per-video key)
  useEffect(() => {
    if (!video) return
    const interval = setInterval(() => {
      const el = videoRef.current
      if (!el || el.currentTime <= 0) return
      try {
        if (musicMode) {
          localStorage.setItem(storageKey, JSON.stringify({ videoId: video.id, time: Math.floor(el.currentTime) }))
        } else {
          localStorage.setItem(`vp-${video.id}`, String(Math.floor(el.currentTime)))
        }
      } catch {}
    }, 5000)
    return () => clearInterval(interval)
  }, [musicMode, video, storageKey, videoRef])

  // Push track metadata to the OS / Bluetooth via Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!video) {
      navigator.mediaSession.metadata = null
      return
    }
    const artwork: MediaImage[] = []
    if (video.thumbnail_url) {
      artwork.push({ src: video.thumbnail_url, sizes: '512x512', type: 'image/jpeg' })
    } else {
      artwork.push({ src: thumbnailUrl(video.id), sizes: '512x512', type: 'image/jpeg' })
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.title ?? 'Untitled',
      artist: video.site ?? 'Play',
      artwork,
    })
  }, [video])

  // Restore saved position for a video (non-music-mode; music mode uses storageKey)
  function restorePosition(videoId: number) {
    if (musicModeRef.current) return
    try {
      const saved = Number(localStorage.getItem(`vp-${videoId}`))
      if (saved > 5) pendingSeekTime.current = saved
    } catch {}
  }

  // Playing from a list queues its playable videos for next/prev/auto-advance.
  // A plain play (no list) keeps a single-item queue.
  const play = useCallback((v: Video, list?: Video[]) => {
    restorePosition(v.id)
    setVideo(v)
    if (list && list.length > 0) {
      const playable = list.filter(x => x.fetch_status === 'ok')
      setQueue(playable.some(x => x.id === v.id) ? playable : [v])
    } else {
      setQueue([v])
    }
    setMode(musicModeRef.current ? 'mini' : 'full')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const queueIndex = video ? queue.findIndex(q => q.id === video.id) : -1
  const hasNext = queueIndex >= 0 && queueIndex < queue.length - 1
  const hasPrevious = queueIndex > 0

  const next = useCallback(() => {
    if (queueIndex >= 0 && queueIndex < queue.length - 1) {
      restorePosition(queue[queueIndex + 1].id)
      setVideo(queue[queueIndex + 1])
    }
  }, [queue, queueIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const previous = useCallback(() => {
    if (queueIndex > 0) {
      restorePosition(queue[queueIndex - 1].id)
      setVideo(queue[queueIndex - 1])
    }
  }, [queue, queueIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bluetooth / OS media keys skip within the queue
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('play', () => { videoRef.current?.play() })
    navigator.mediaSession.setActionHandler('pause', () => { videoRef.current?.pause() })
    navigator.mediaSession.setActionHandler('nexttrack', hasNext ? () => next() : null)
    navigator.mediaSession.setActionHandler('previoustrack', hasPrevious ? () => previous() : null)
    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
    }
  }, [hasNext, hasPrevious, next, previous, videoRef])

  // Sync playbackState so iOS knows audio is active in background
  useEffect(() => {
    const el = videoRef.current
    if (!el || !('mediaSession' in navigator)) return
    const onPlay = () => { navigator.mediaSession.playbackState = 'playing' }
    const onPause = () => { navigator.mediaSession.playbackState = 'paused' }
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => { el.removeEventListener('play', onPlay); el.removeEventListener('pause', onPause) }
  }, [videoRef])

  // Android Chrome pauses video on visibilitychange — resume if it was playing
  useEffect(() => {
    let wasPlaying = false
    const handler = () => {
      const el = videoRef.current
      if (!el) return
      if (document.hidden) wasPlaying = !el.paused
      else if (wasPlaying) el.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [videoRef])

  const minimize = useCallback(() => {
    setMode('mini')
    // Minimizing is how a user opts into music mode from a normal video.
    setMusicMode(prev => {
      if (prev) return prev
      try { localStorage.setItem(MUSIC_MODE_KEY, '1') } catch {}
      return true
    })
  }, [])
  const expand = useCallback(() => setMode('full'), [])

  const close = useCallback(() => {
    // Save final position before closing
    if (!musicModeRef.current) {
      const el = videoRef.current
      const vid = video
      if (el && vid && el.currentTime > 5) {
        try { localStorage.setItem(`vp-${vid.id}`, String(Math.floor(el.currentTime))) } catch {}
      }
    }
    setMode('closed')
    setVideo(null)
    setQueue([])
    try { localStorage.removeItem(storageKey) } catch {}
  }, [video, videoRef, storageKey])

  const toggleMusicMode = useCallback(() => {
    setMusicMode(prev => {
      const next = !prev
      try {
        localStorage.setItem(MUSIC_MODE_KEY, next ? '1' : '0')
        if (!next) localStorage.removeItem(storageKey)
      } catch {}
      return next
    })
  }, [storageKey])

  const consumePendingSeek = useCallback(() => {
    const t = pendingSeekTime.current
    pendingSeekTime.current = null
    return t
  }, [])

  const value = useMemo(() => ({
    video, mode, videoRef, musicMode, consumePendingSeek,
    play, next, previous, hasNext, hasPrevious,
    minimize, expand, close, toggleMusicMode,
  }), [video, mode, musicMode, play, next, previous, hasNext, hasPrevious, minimize, expand, close, toggleMusicMode, consumePendingSeek])

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}
