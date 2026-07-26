import { useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button, Input } from '@/components/ui'
import SettingsSection, { FieldLabel } from '@/components/settings/SettingsSection'
import { getServerUrl, isNativeApp, setServerUrl } from '@/platform'

// Only rendered in the native (Capacitor) app, where the client bundle is
// local and needs to be told where the Play server lives.
export default function ServerSection() {
  const { theme } = useTheme()
  const [url, setUrl] = useState(getServerUrl())
  const [status, setStatus] = useState<'ok' | 'fail' | null>(null)
  const [checking, setChecking] = useState(false)

  if (!isNativeApp) return null

  const handleSave = async () => {
    const trimmed = url.trim().replace(/\/+$/, '')
    setChecking(true)
    setStatus(null)
    try {
      const res = await fetch(`${trimmed}/api/health`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setServerUrl(trimmed)
      setUrl(trimmed)
      setStatus('ok')
    } catch {
      setStatus('fail')
    } finally {
      setChecking(false)
    }
  }

  return (
    <SettingsSection
      title="Server"
      description="Where this app finds your Play server."
    >
      <FieldLabel htmlFor="server-url">Server address</FieldLabel>
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          id="server-url"
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://192.168.1.10:3030"
          className="!flex-1 !w-auto min-w-[220px]"
        />
        <Button variant="primary" onClick={() => void handleSave()} disabled={checking || !url.trim()}>
          {checking ? 'Checking…' : 'Test & save'}
        </Button>
      </div>
      {status === 'ok' && (
        <p className="text-xs font-medium mt-2" style={{ color: '#16a34a' }}>✓ Connected — server saved</p>
      )}
      {status === 'fail' && (
        <p className="text-xs font-medium mt-2" style={{ color: '#dc2626' }}>Could not reach a Play server at that address</p>
      )}
      <p className="text-[11px] mt-2" style={{ color: theme.text2 }}>
        Include protocol and port — e.g. https://play.tail1234.ts.net or http://192.168.1.10:3030.
      </p>
    </SettingsSection>
  )
}
