import { useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { exportData, importData, downloadAllVideos } from '@/api'
import { Button, Surface } from '@/components/ui'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'

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
    <Surface className="p-6 mb-5">
      <h2 className="text-base font-bold mb-1" style={{ color: theme.text }}>App Data</h2>
      <p className="text-xs mb-5" style={{ color: theme.text2 }}>
        Export all your video URLs and collections as a JSON backup. Import restores them without triggering downloads — you can download each video manually afterwards.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          variant="secondary"
          onClick={exportData}
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          }
        >
          Export Settings
        </Button>
        <Button
          variant="secondary"
          onClick={() => importRef.current?.click()}
          disabled={importAction.loading}
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          }
        >
          {importAction.loading ? 'Importing...' : 'Import Settings'}
        </Button>
        <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImport} />
        {importAction.status && (
          <span className="text-sm font-medium" style={{ color: theme.accent }}>{importAction.status}</span>
        )}
      </div>

      <div className="mt-5 pt-5" style={{ borderTop: `1px solid ${theme.border}` }}>
        <p className="text-xs mb-3" style={{ color: theme.text2 }}>
          Download all locally saved videos as a ZIP file. Large collections may take a while to package.
        </p>
        <Button variant="secondary" onClick={downloadAllVideos}>Download all videos</Button>
      </div>
    </Surface>
  )
}
