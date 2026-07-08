import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { exportData, importData, downloadAllVideos } from '@/api'
import { Button } from '@/components/ui'
import SettingsSection from '@/components/settings/SettingsSection'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'

// Large click-target card with a glyph strip, mirroring the mode cards in the
// YouTube authentication section.
function ActionCard({
  glyph, title, description, onClick, disabled,
}: {
  glyph: ReactNode
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}) {
  const { theme } = useTheme()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col gap-3 p-4 rounded-xl text-left transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ border: `1px solid ${theme.border}`, background: theme.surface2 }}
    >
      <div
        className="w-full rounded-lg p-3 flex items-center justify-center"
        style={{ background: theme.surface, border: `1px solid ${theme.border}`, minHeight: '60px', color: theme.accent }}
      >
        {glyph}
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: theme.text }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: theme.text2 }}>{description}</p>
      </div>
    </button>
  )
}

export default function AppDataSection() {
  const { theme } = useTheme()
  const importRef = useRef<HTMLInputElement>(null)
  const importAction = useAsyncStatus()

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    void importAction.run(async () => {
      const result = await importData(file)
      return `Imported ${result.imported} video${result.imported !== 1 ? 's' : ''}`
    })
  }

  return (
    <SettingsSection
      title="Backup"
      description="Your video URLs and collections as a portable JSON file."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionCard
          glyph={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 12 12 16.5m0 0 4.5-4.5M12 16.5V3" />
            </svg>
          }
          title="Export library"
          description="Save everything to fetchr-backup.json."
          onClick={exportData}
        />
        <ActionCard
          glyph={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5" />
            </svg>
          }
          title={importAction.loading ? 'Importing…' : 'Import library'}
          description="Restore from a backup file."
          onClick={() => importRef.current?.click()}
          disabled={importAction.loading}
        />
      </div>
      <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImport} />
      {importAction.status && (
        <p className="text-sm font-medium mt-3" style={{ color: theme.accent }}>{importAction.status}</p>
      )}
      <p className="text-[11px] mt-2" style={{ color: theme.text2 }}>
        Importing restores entries without re-downloading — download each video manually afterwards.
      </p>

      <div className="mt-5 pt-5 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ borderTop: `1px solid ${theme.border}` }}>
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-sm font-semibold" style={{ color: theme.text }}>Download everything</h3>
          <p className="text-xs mt-0.5" style={{ color: theme.text2 }}>
            All locally saved videos as one ZIP. Large libraries take a while to package.
          </p>
        </div>
        <Button variant="secondary" className="shrink-0" onClick={downloadAllVideos}>Download ZIP</Button>
      </div>
    </SettingsSection>
  )
}
