import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { regenerateSidecars, importSidecars, renameToTitles, refreshThumbnails } from '@/api'
import { Button, ConfirmDialog } from '@/components/ui'
import SettingsSection from '@/components/settings/SettingsSection'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'

function ToolCard({
  glyph, title, description, status, actions,
}: {
  glyph: ReactNode
  title: string
  description: ReactNode
  status: string | null
  actions: ReactNode
}) {
  const { theme } = useTheme()
  return (
    <div
      className="flex flex-col p-4 rounded-xl"
      style={{ background: theme.surface2, border: `1px solid ${theme.border}` }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: theme.text2 }}>{glyph}</span>
        <h3 className="text-sm font-semibold" style={{ color: theme.text }}>{title}</h3>
      </div>
      <p className="text-xs mt-1.5 leading-relaxed flex-1" style={{ color: theme.text2 }}>{description}</p>
      <div className="flex flex-wrap gap-2 mt-3">{actions}</div>
      {status && (
        <p className="text-xs font-medium mt-2" style={{ color: theme.accent }}>{status}</p>
      )}
    </div>
  )
}

export default function MaintenanceSection() {
  const { theme } = useTheme()
  const regenerate = useAsyncStatus()
  const sidecarImport = useAsyncStatus(6000)
  const thumbs = useAsyncStatus(6000)
  const rename = useAsyncStatus(6000)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [renameConfirmOpen, setRenameConfirmOpen] = useState(false)

  const handleRegenerate = () => {
    void regenerate.run(async () => {
      const r = await regenerateSidecars()
      const failedSuffix = r.failed > 0 ? `, ${r.failed} failed` : ''
      return `Regenerated ${r.written} of ${r.total} sidecar${r.total !== 1 ? 's' : ''}${failedSuffix}`
    })
  }

  const handleImport = () => {
    void sidecarImport.run(async () => {
      const r = await importSidecars()
      const parts = [`Imported ${r.imported} of ${r.total}`]
      if (r.replaced > 0) parts.push(`${r.replaced} replaced`)
      if (r.skippedNoMedia > 0) parts.push(`${r.skippedNoMedia} skipped (no media)`)
      if (r.failed > 0) parts.push(`${r.failed} failed`)
      return parts.join(', ')
    })
  }

  const handleRefreshThumbnails = (all: boolean) => {
    void thumbs.run(async () => {
      const r = await refreshThumbnails(all)
      return r.enqueued === 0
        ? 'No videos needed a thumbnail refresh.'
        : `Queued ${r.enqueued} thumbnail job${r.enqueued !== 1 ? 's' : ''}.`
    })
  }

  const handleRename = () => {
    void rename.run(async () => {
      const r = await renameToTitles()
      const parts = [`Renamed ${r.renamed} of ${r.total}`]
      if (r.skipped > 0) parts.push(`${r.skipped} already named or skipped`)
      if (r.failed > 0) parts.push(`${r.failed} failed`)
      return parts.join(', ')
    })
  }

  const buttonStyle = { background: theme.surface }

  return (
    <SettingsSection
      title="Library maintenance"
      description="Every download gets a JSON sidecar with its metadata. These tools backfill or repair the library — nothing is redownloaded."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ToolCard
          glyph={
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          }
          title="Regenerate sidecars"
          description="Rewrite every sidecar from the current library data. Backfills older libraries and repairs missing files."
          status={regenerate.status}
          actions={
            <Button variant="secondary" size="sm" style={buttonStyle} onClick={handleRegenerate} disabled={regenerate.loading}>
              {regenerate.loading ? 'Regenerating…' : 'Regenerate'}
            </Button>
          }
        />

        <ToolCard
          glyph={
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          }
          title="Import from sidecars"
          description="Rebuild the library by scanning the videos folder. Matching entries are replaced and thumbnails re-fetched."
          status={sidecarImport.status}
          actions={
            <Button variant="secondary" size="sm" style={buttonStyle} onClick={() => setImportConfirmOpen(true)} disabled={sidecarImport.loading}>
              {sidecarImport.loading ? 'Importing…' : 'Import'}
            </Button>
          }
        />

        <ToolCard
          glyph={
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          }
          title="Rename files to titles"
          description={
            <>
              Rename files still using the old numeric format (e.g. <code style={{ color: theme.accent }}>43.mp4</code>) to their video title, sidecars included.
            </>
          }
          status={rename.status}
          actions={
            <Button variant="secondary" size="sm" style={buttonStyle} onClick={() => setRenameConfirmOpen(true)} disabled={rename.loading}>
              {rename.loading ? 'Renaming…' : 'Rename'}
            </Button>
          }
        />

        <ToolCard
          glyph={
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
          }
          title="Refresh thumbnails"
          description="Re-fetch thumbnails from each video's original page — only for videos missing one, or for the whole library."
          status={thumbs.status}
          actions={
            <>
              <Button variant="secondary" size="sm" style={buttonStyle} onClick={() => handleRefreshThumbnails(false)} disabled={thumbs.loading}>
                {thumbs.loading ? 'Queuing…' : 'Missing only'}
              </Button>
              <Button variant="secondary" size="sm" style={buttonStyle} onClick={() => handleRefreshThumbnails(true)} disabled={thumbs.loading}>
                All videos
              </Button>
            </>
          }
        />
      </div>

      <ConfirmDialog
        open={importConfirmOpen}
        title="Import from sidecars"
        message="Scan the videos folder for sidecar JSON files and import them? Existing entries that conflict (same ID or page URL) will be replaced with the sidecar's data."
        confirmLabel="Import"
        onConfirm={handleImport}
        onClose={() => setImportConfirmOpen(false)}
      />

      <ConfirmDialog
        open={renameConfirmOpen}
        title="Rename files to titles"
        message="Rename all numeric-ID video files (e.g. 43.mp4) to their video title? Sidecars are renamed alongside and the stored file paths are updated. Files already named by title are skipped."
        confirmLabel="Rename"
        onConfirm={handleRename}
        onClose={() => setRenameConfirmOpen(false)}
      />
    </SettingsSection>
  )
}
