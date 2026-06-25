import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { regenerateSidecars, importSidecars, renameToTitles, refreshThumbnails } from '@/api'
import { Button, Surface, ConfirmDialog } from '@/components/ui'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'

interface ToolRowProps {
  title: string
  description: ReactNode
  status: string | null
  actions: ReactNode
  divider?: boolean
}

function ToolRow({ title, description, status, actions, divider = true }: ToolRowProps) {
  const { theme } = useTheme()
  return (
    <div className={divider ? 'mt-5 pt-5' : ''} style={divider ? { borderTop: `1px solid ${theme.border}` } : undefined}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-sm font-semibold" style={{ color: theme.text }}>{title}</h3>
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: theme.text2 }}>{description}</p>
        </div>
        <div className="flex gap-2 shrink-0">{actions}</div>
      </div>
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

  return (
    <Surface className="p-6 mb-5">
      <h2 className="text-base font-bold mb-1" style={{ color: theme.text }}>Library Maintenance</h2>
      <p className="text-xs mb-5" style={{ color: theme.text2 }}>
        Each downloaded video gets a JSON sidecar (title, site, collection, page URL) next to the media file, written and updated automatically. These tools backfill or repair the library — none of them redownload videos.
      </p>

      <ToolRow
        divider={false}
        title="Regenerate sidecars"
        description="Rewrite the sidecar for every downloaded video from the current library data. Use this to backfill a library from before sidecars existed, or to repair missing ones."
        status={regenerate.status}
        actions={
          <Button variant="secondary" size="sm" onClick={handleRegenerate} disabled={regenerate.loading}>
            {regenerate.loading ? 'Regenerating...' : 'Regenerate'}
          </Button>
        }
      />

      <ToolRow
        title="Import from sidecars"
        description="Restore the library from a backup by scanning the videos folder. Every sidecar with a matching media file is imported, and its thumbnail is re-fetched automatically. Existing entries with the same ID or page URL are replaced by the sidecar."
        status={sidecarImport.status}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setImportConfirmOpen(true)} disabled={sidecarImport.loading}>
            {sidecarImport.loading ? 'Importing...' : 'Import'}
          </Button>
        }
      />

      <ToolRow
        title="Rename files to titles"
        description={
          <>
            Rename media files still using the old numeric-ID format (e.g. <code style={{ color: theme.accent }}>43.mp4</code>) to their video title. Sidecars are renamed alongside; files already named by title are skipped.
          </>
        }
        status={rename.status}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setRenameConfirmOpen(true)} disabled={rename.loading}>
            {rename.loading ? 'Renaming...' : 'Rename'}
          </Button>
        }
      />

      <ToolRow
        title="Refresh thumbnails"
        description="Re-fetch thumbnails by querying each video's original page URL — either only for videos missing one, or for the whole library."
        status={thumbs.status}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => handleRefreshThumbnails(false)} disabled={thumbs.loading}>
              {thumbs.loading ? 'Queuing...' : 'Missing only'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handleRefreshThumbnails(true)} disabled={thumbs.loading}>
              All videos
            </Button>
          </>
        }
      />

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
    </Surface>
  )
}
