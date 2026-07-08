import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { getSettings, updateSettings, getCookieStatus, uploadCookies, deleteCookies } from '@/api'
import { Button, Input, ConfirmDialog, useToast } from '@/components/ui'
import SettingsSection, { Disclosure, FieldLabel, StatusBadge } from '@/components/settings/SettingsSection'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'
import { formatAge } from '@/utils/formatAge'

export default function YouTubeAuthSection() {
  const { theme } = useTheme()
  const { addToast } = useToast()
  const [cookieMode, setCookieMode] = useState<'file' | 'browser'>('file')
  const [cookieBrowser, setCookieBrowser] = useState('')
  const [cookiePresent, setCookiePresent] = useState(false)
  const [cookieUpdatedAt, setCookieUpdatedAt] = useState<string | null>(null)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const cookieRef = useRef<HTMLInputElement>(null)

  const browserSave = useAsyncStatus(2000)
  const upload = useAsyncStatus(6000)

  useEffect(() => {
    getSettings().then(s => {
      if (s.youtube_cookies_mode === 'browser') setCookieMode('browser')
      if (s.youtube_cookies_browser) setCookieBrowser(s.youtube_cookies_browser)
    }).catch(() => {})
    getCookieStatus().then(c => {
      setCookiePresent(c.present)
      setCookieUpdatedAt(c.updatedAt)
    }).catch(() => {})
  }, [])

  const selectCookieMode = async (mode: 'file' | 'browser') => {
    setCookieMode(mode)
    try {
      await updateSettings({ youtube_cookies_mode: mode })
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save cookie mode', 'error')
    }
  }

  const saveCookieBrowser = (e: React.FormEvent) => {
    e.preventDefault()
    void browserSave.run(async () => {
      await updateSettings({ youtube_cookies_browser: cookieBrowser.trim(), youtube_cookies_mode: 'browser' })
      return 'Saved'
    })
  }

  const handleCookieUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    void upload.run(async () => {
      const content = await file.text()
      const res = await uploadCookies(content)
      const status = await getCookieStatus()
      setCookiePresent(status.present)
      setCookieUpdatedAt(status.updatedAt)
      setCookieMode('file')
      return res.looksValid
        ? `Uploaded ${file.name}`
        : `Uploaded ${file.name}, but it doesn't look like a Netscape cookies.txt — yt-dlp may reject it.`
    })
  }

  const handleRemoveCookies = () => {
    void upload.run(async () => {
      await deleteCookies()
      setCookiePresent(false)
      setCookieUpdatedAt(null)
      return 'Removed'
    })
  }

  return (
    <SettingsSection
      title="YouTube authentication"
      description="Age-restricted videos need a signed-in session. Choose how to provide cookies."
      badge={cookiePresent ? <StatusBadge color="#16a34a">Cookies active</StatusBadge> : undefined}
    >
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        {([
          {
            value: 'file' as const,
            label: 'Cookie file',
            description: 'Upload a cookies.txt — recommended, works in Docker',
            preview: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5" />
              </svg>
            ),
          },
          {
            value: 'browser' as const,
            label: 'From browser',
            description: 'Read cookies from a browser on the server',
            preview: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path strokeLinecap="round" d="M3 9h18" />
                <circle cx="6" cy="7" r="0.55" fill="currentColor" stroke="none" />
                <circle cx="8.2" cy="7" r="0.55" fill="currentColor" stroke="none" />
              </svg>
            ),
          },
        ] as const).map(({ value, label, description, preview }) => (
          <button
            key={value}
            type="button"
            onClick={() => selectCookieMode(value)}
            className="flex flex-col gap-3 p-4 rounded-xl text-left transition-opacity hover:opacity-90"
            style={{
              border: `1px solid ${cookieMode === value ? theme.accent : theme.border}`,
              background: cookieMode === value ? `${theme.accent}08` : theme.surface2,
              boxShadow: cookieMode === value ? `0 0 0 3px ${theme.accent}15` : 'none',
            }}
          >
            <div
              className="w-full rounded-lg p-3 flex items-center justify-center"
              style={{
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                minHeight: '60px',
                color: cookieMode === value ? theme.accent : theme.text2,
              }}
            >
              {preview}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: theme.text }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: theme.text2 }}>{description}</p>
            </div>
          </button>
        ))}
      </div>

      {cookieMode === 'file' ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={cookieRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleCookieUpload} />
            <Button variant="primary" onClick={() => cookieRef.current?.click()} disabled={upload.loading}>
              {upload.loading ? 'Working…' : cookiePresent ? 'Replace cookies.txt' : 'Upload cookies.txt'}
            </Button>
            {cookiePresent && (
              <Button variant="secondary" onClick={() => setRemoveConfirmOpen(true)}>Remove</Button>
            )}
            {cookiePresent && cookieUpdatedAt && (
              <span className="text-xs" style={{ color: theme.text2 }}>
                updated {formatAge(cookieUpdatedAt)}
              </span>
            )}
          </div>

          <div className="mt-4">
            <Disclosure label="How to export cookies.txt">
              <ol className="text-xs space-y-1.5 list-decimal pl-4" style={{ color: theme.text2 }}>
                <li>
                  Install the{' '}
                  <a
                    href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: theme.accent }}
                  >Get cookies.txt LOCALLY</a>{' '}
                  extension (Chrome/Edge; the Firefox build is linked from its{' '}
                  <a
                    href="https://github.com/kairi003/Get-cookies.txt-LOCALLY"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: theme.accent }}
                  >GitHub page</a>).
                </li>
                <li>Sign in to YouTube in a private/incognito window, open <code style={{ color: theme.accent }}>youtube.com</code>, and export cookies in <strong>Netscape</strong> format.</li>
                <li>Close the private window right away — YouTube rotates cookies, and browsing on in that session can invalidate the file.</li>
                <li>Upload the file here. It's stored on the server and reused for every download.</li>
              </ol>
            </Disclosure>
          </div>

          <p className="text-[11px] mt-3" style={{ color: theme.text2 }}>
            Cookies expire after a while — if downloads start failing again, upload a fresh file.
          </p>
        </div>
      ) : (
        <form onSubmit={saveCookieBrowser}>
          <FieldLabel htmlFor="cookie-browser">Browser on the server</FieldLabel>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              id="cookie-browser"
              type="text"
              value={cookieBrowser}
              onChange={e => setCookieBrowser(e.target.value)}
              placeholder="e.g. firefox or firefox:Default"
              className="!flex-1 !w-auto min-w-0"
            />
            <Button type="submit" variant="primary" disabled={browserSave.loading}>
              {browserSave.loading ? 'Saving…' : 'Save'}
            </Button>
            {browserSave.status && <span className="text-sm font-medium" style={{ color: theme.accent }}>{browserSave.status}</span>}
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: theme.text2 }}>
            chrome, firefox, edge, brave, opera, vivaldi, chromium, or safari. Reads the profile on the <strong>server</strong> — won't work in Docker, and can fail while that browser is running.
          </p>
        </form>
      )}

      {upload.status && (
        <p className="text-xs mt-3 font-medium" style={{ color: theme.accent }}>{upload.status}</p>
      )}

      <ConfirmDialog
        open={removeConfirmOpen}
        title="Remove cookies file"
        message="Remove the uploaded cookies file? Downloads that need a logged-in YouTube session will start failing until you upload a new one."
        confirmLabel="Remove"
        destructive
        onConfirm={handleRemoveCookies}
        onClose={() => setRemoveConfirmOpen(false)}
      />
    </SettingsSection>
  )
}
