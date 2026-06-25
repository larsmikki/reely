import { useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { getSettings, updateSettings } from '@/api'
import { Button, Input, Surface } from '@/components/ui'
import FolderPicker from '@/components/FolderPicker'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'

function PathForm({
  value, onChange, onBrowse, placeholder, settingKey,
}: {
  value: string
  onChange: (v: string) => void
  onBrowse: () => void
  placeholder: string
  settingKey: string
}) {
  const { theme } = useTheme()
  const { status, loading, run } = useAsyncStatus(2000)

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await updateSettings({ [settingKey]: value })
      return 'Saved'
    })
  }

  return (
    <form onSubmit={save} className="flex items-center gap-2 flex-wrap">
      <Input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="!flex-1 !w-auto min-w-0"
      />
      <Button type="button" variant="secondary" onClick={onBrowse}>Browse</Button>
      <Button type="submit" variant="primary" disabled={loading}>
        {loading ? 'Saving...' : 'Save'}
      </Button>
      {status && <span className="text-sm font-medium" style={{ color: theme.accent }}>{status}</span>}
    </form>
  )
}

export default function DownloadsSection() {
  const { theme } = useTheme()
  const [downloadPath, setDownloadPath] = useState('')
  const [ffmpegPath, setFfmpegPath] = useState('')
  const [browse, setBrowse] = useState<'download' | 'ffmpeg' | null>(null)

  useEffect(() => {
    getSettings().then(s => {
      if (s.download_path) setDownloadPath(s.download_path)
      if (s.ffmpeg_path) setFfmpegPath(s.ffmpeg_path)
    }).catch(() => {})
  }, [])

  return (
    <Surface className="p-6 mb-5">
      <h2 className="text-base font-bold mb-1" style={{ color: theme.text }}>Downloads</h2>
      <p className="text-xs mb-5" style={{ color: theme.text2 }}>
        When set, newly added videos are automatically downloaded to this folder using yt-dlp.
        Supports local paths and network shares (e.g. <code style={{ color: theme.accent }}>\\server\share\videos</code>).
      </p>
      <PathForm
        value={downloadPath}
        onChange={setDownloadPath}
        onBrowse={() => setBrowse('download')}
        placeholder="e.g. C:\Videos or \\nas\media\videos"
        settingKey="download_path"
      />

      <p className="text-xs mt-5 mb-2" style={{ color: theme.text2 }}>
        ffmpeg path override for MP3 downloads. Leave blank to use the bundled ffmpeg.
      </p>
      <PathForm
        value={ffmpegPath}
        onChange={setFfmpegPath}
        onBrowse={() => setBrowse('ffmpeg')}
        placeholder="e.g. C:\ffmpeg\bin"
        settingKey="ffmpeg_path"
      />

      {browse && (
        <FolderPicker
          onSelect={path => {
            if (browse === 'download') setDownloadPath(path)
            else setFfmpegPath(path)
            setBrowse(null)
          }}
          onClose={() => setBrowse(null)}
        />
      )}
    </Surface>
  )
}
