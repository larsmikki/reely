import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { getSettings, updateSettings } from '@/api'
import { Button, Input } from '@/components/ui'
import SettingsSection, { FieldLabel } from '@/components/settings/SettingsSection'
import FolderPicker from '@/components/FolderPicker'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'

function PathField({
  id, label, hint, value, onChange, onBrowse, placeholder, settingKey,
}: {
  id: string
  label: string
  hint: ReactNode
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
    <form onSubmit={save}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          id={id}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="!flex-1 !w-auto min-w-0"
        />
        <Button type="button" variant="secondary" onClick={onBrowse}>Browse</Button>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Saving…' : 'Save'}
        </Button>
        {status && <span className="text-sm font-medium" style={{ color: theme.accent }}>{status}</span>}
      </div>
      <p className="text-[11px] mt-1.5" style={{ color: theme.text2 }}>{hint}</p>
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
    <SettingsSection
      title="Downloads"
      description="New videos are downloaded automatically with yt-dlp once a folder is set."
    >
      <PathField
        id="download-path"
        label="Download folder"
        hint={<>Local path or network share, e.g. <code style={{ color: theme.accent }}>\\nas\media\videos</code>.</>}
        value={downloadPath}
        onChange={setDownloadPath}
        onBrowse={() => setBrowse('download')}
        placeholder="e.g. C:\Videos"
        settingKey="download_path"
      />

      <div className="mt-5">
        <PathField
          id="ffmpeg-path"
          label="ffmpeg path — optional"
          hint="Used for MP3 downloads. Leave blank to use the bundled ffmpeg."
          value={ffmpegPath}
          onChange={setFfmpegPath}
          onBrowse={() => setBrowse('ffmpeg')}
          placeholder="e.g. C:\ffmpeg\bin"
          settingKey="ffmpeg_path"
        />
      </div>

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
    </SettingsSection>
  )
}
