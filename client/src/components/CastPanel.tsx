import { useEffect, useState } from 'react'
import { castVideo, getCastDevices, pauseCast, resumeCast, stopCast } from '@/api'
import type { CastDevice, Video } from '@/types'
import { useTheme } from '@/contexts/ThemeContext'
import { Button, Select } from '@/components/ui'

export default function CastPanel({ video }: { video: Video }) {
  const { theme } = useTheme()
  const [devices, setDevices] = useState<CastDevice[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadDevices(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadDevices(refresh = true) {
    setLoading(true)
    setMessage(refresh ? 'Searching for TVs...' : '')
    try {
      const res = await getCastDevices(refresh)
      setDevices(res.items)
      setSelectedId(current => res.items.some(device => device.id === current) ? current : res.items[0]?.id || '')
      setMessage(res.items.length || !refresh ? '' : 'No DLNA TVs found on this network.')
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setLoading(true)
    setMessage('')
    try {
      await action()
      setMessage(success)
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const selected = devices.find(device => device.id === selectedId)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide" style={{ color: theme.text2 }}>Cast to TV</p>
        <button
          type="button"
          onClick={() => void loadDevices(true)}
          disabled={loading}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ color: theme.text2, background: theme.surface2, border: `1px solid ${theme.border}` }}
          title="Search for DLNA TVs"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 14A7 7 0 0 0 17 18.5M18.5 10A7 7 0 0 0 7 5.5" />
          </svg>
        </button>
      </div>

      {devices.length > 0 && (
        <Select value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={loading}>
          {devices.map(device => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </Select>
      )}

      {selected && (
        <p className="text-xs truncate" style={{ color: theme.text2 }}>
          {[selected.manufacturer, selected.modelName, selected.host].filter(Boolean).join(' - ')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!selectedId || loading || video.fetch_status !== 'ok'}
          onClick={() => void run(async () => {
            await castVideo(selectedId, video.id)
            setActiveId(selectedId)
          }, 'Playing on TV.')}
        >
          Cast
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading}
          onClick={() => void loadDevices(true)}
        >
          Search
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!activeId || loading}
          onClick={() => void run(() => pauseCast(activeId), 'Paused on TV.')}
        >
          Pause
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!activeId || loading}
          onClick={() => void run(() => resumeCast(activeId), 'Resumed on TV.')}
        >
          Resume
        </Button>
      </div>

      <Button
        size="sm"
        variant="ghost"
        disabled={!activeId || loading}
        onClick={() => void run(async () => {
          await stopCast(activeId)
          setActiveId('')
        }, 'Stopped casting.')}
        fullWidth
      >
        Stop casting
      </Button>

      {message && <p className="text-xs leading-snug" style={{ color: message.includes('No DLNA') ? theme.text2 : theme.text }}>{message}</p>}
    </div>
  )
}
