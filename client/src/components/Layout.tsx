import { useState, useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTheme } from '@/contexts/ThemeContext'
import { usePlayer } from '@/contexts/PlayerContext'
import { useDesktop } from '@/contexts/DesktopContext'
import { useJobs, JOB_KIND_LABEL } from '@/contexts/JobsContext'
import Footer from '@/components/Footer'

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function MiniPlayerBar() {
  const { video, mode, videoRef, expand, close, next, previous, hasNext, hasPrevious } = usePlayer()
  const { theme } = useTheme()
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)

  const isActive = mode === 'mini' && !!video

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTime = () => {
      setCurrentTime(el.currentTime)
      setDuration(el.duration || 0)
    }
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onTime)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onTime)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [videoRef, mode])

  if (!isActive || !video) return null

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) el.play(); else el.pause()
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = videoRef.current
    if (!el || !el.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration
  }

  const progress = duration ? currentTime / duration : 0

  return (
    <div className="sticky bottom-0 z-30" style={{ borderTop: `1px solid ${theme.border}`, background: theme.surface }}>
      <div
        className="w-full cursor-pointer relative"
        style={{ height: 6, background: theme.surface2 }}
        onClick={handleSeek}
        title="Seek"
      >
        <div
          style={{
            height: '100%',
            width: `${progress * 100}%`,
            background: theme.accent,
            transition: 'width 0.25s linear',
          }}
        />
      </div>

      <div className="flex items-center gap-3 px-4" style={{ height: 64 }}>
        <img
          src={`/api/videos/${video.id}/thumbnail`}
          alt=""
          className="rounded shrink-0"
          style={{ width: 44, height: 44, objectFit: 'cover' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: theme.text }}>
            {video.title || 'Untitled'}
          </p>
          <p className="text-xs tabular-nums" style={{ color: theme.text2 }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </p>
        </div>

        <button
          onClick={previous}
          disabled={!hasPrevious}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
          style={{ color: theme.text2 }}
          title="Previous"
          aria-label="Previous video"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
        </button>

        <button
          onClick={togglePlay}
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: theme.text }}
          title={paused ? 'Play' : 'Pause'}
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          )}
        </button>

        <button
          onClick={next}
          disabled={!hasNext}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
          style={{ color: theme.text2 }}
          title="Next"
          aria-label="Next video"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" /></svg>
        </button>

        <button
          onClick={expand}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: theme.text2 }}
          title="Expand"
          aria-label="Expand video"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
          </svg>
        </button>

        <button
          onClick={close}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: theme.text2 }}
          title="Close"
          aria-label="Close player"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function LogoMark({ size = 28 }: { size?: number }) {
  return <img src="/favicon.svg" width={size} height={size} alt="Fetchr" className="shrink-0" />
}

// Header chip that surfaces the job queue globally: spins with a count while
// jobs run, turns into a warning when something failed. Click for details.
function ActivityIndicator() {
  const { theme } = useTheme()
  const { jobs } = useJobs()
  const [open, setOpen] = useState(false)

  const active = jobs.filter(j => j.status === 'pending' || j.status === 'running')
  const failed = jobs.filter(j => j.status === 'error')
  if (active.length === 0 && failed.length === 0) return null

  const hasFailures = failed.length > 0
  const shown = [...active, ...failed].sort((a, b) => a.id - b.id)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
        style={{
          color: hasFailures ? '#dc2626' : theme.accent,
          background: hasFailures ? '#dc262622' : `${theme.accent}22`,
        }}
        title={hasFailures ? 'Some downloads failed' : 'Downloads in progress'}
        aria-label="Download activity"
      >
        {active.length > 0 ? (
          <span
            className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: `${theme.accent} transparent ${theme.accent} ${theme.accent}` }}
          />
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        <span className="tabular-nums">{active.length > 0 ? active.length : failed.length}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-12 z-20 w-72 py-1.5 rounded-xl shadow-lg"
            style={{ background: theme.surface, border: `1px solid ${theme.border}` }}
          >
            {shown.slice(0, 8).map(job => (
              <div key={job.id} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate" style={{ color: theme.text }}>
                    {JOB_KIND_LABEL[job.kind]}
                  </span>
                  <span
                    className="text-[11px] shrink-0"
                    style={{ color: job.status === 'error' ? '#dc2626' : theme.text2 }}
                  >
                    {job.status}
                  </span>
                </div>
                {job.status === 'running' && (
                  <div className="mt-1 h-1 rounded overflow-hidden" style={{ background: theme.surface2 }}>
                    <div
                      className="h-full transition-all"
                      style={{ width: `${Math.round((job.progress ?? 0) * 100)}%`, background: theme.accent }}
                    />
                  </div>
                )}
              </div>
            ))}
            {shown.length > 8 && (
              <p className="px-3 py-1 text-[11px]" style={{ color: theme.text2 }}>
                +{shown.length - 8} more…
              </p>
            )}
            <div className="mt-1 pt-1.5 px-3 pb-1" style={{ borderTop: `1px solid ${theme.border}` }}>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="text-xs font-medium transition-opacity hover:opacity-80"
                style={{ color: theme.accent }}
              >
                Manage queue →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MusicModeButton() {
  const { theme } = useTheme()
  const { musicMode, toggleMusicMode } = usePlayer()
  return (
    <button
      onClick={toggleMusicMode}
      className="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150"
      style={{
        color: musicMode ? theme.accent : theme.text2,
        background: musicMode ? `${theme.accent}22` : 'transparent',
      }}
      title={musicMode ? 'Music mode is on — playing without opening the video' : 'Turn on music mode'}
      aria-label="Toggle music mode"
    >
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M18 3a1 1 0 0 0-1.196-.98l-10 2A1 1 0 0 0 6 5v9.114A4.369 4.369 0 0 0 5 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0 0 15 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
      </svg>
    </button>
  )
}

export default function Layout() {
  const { theme } = useTheme()
  const { desktop, switchDesktop, deskNames } = useDesktop()
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: theme.bg, color: theme.text }}>
      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          background: `${theme.surface}dd`,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 shrink-0" style={{ textDecoration: 'none' }}>
            <LogoMark size={28} />
            <span className="text-xl font-extrabold tracking-tight gradient-text select-none">
              Fetchr
            </span>
          </Link>

          <nav className="flex items-center gap-0.5">
            {([1, 2] as const).map(d => (
              <button
                key={d}
                onClick={() => switchDesktop(d)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
                style={
                  desktop === d
                    ? { background: `${theme.accent}22`, color: theme.accent }
                    : { color: theme.text2 }
                }
                title={`Switch to ${deskNames[d]} — a separate library with its own videos and collections`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zM13 12a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1v-3a1 1 0 00-1-1h-3z" />
                </svg>
                <span className="hidden sm:inline">{deskNames[d]}</span>
              </button>
            ))}

            <ActivityIndicator />

            <MusicModeButton />

            <Link
              to="/settings"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
              style={
                location.pathname === '/settings'
                  ? { background: `${theme.accent}22`, color: theme.accent }
                  : { color: theme.text2 }
              }
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <MiniPlayerBar />
      <Footer />
    </div>
  )
}
