import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui'
import SettingsSection from '@/components/settings/SettingsSection'
import { downloadAndroidApp } from '@/api'
import { isNativeApp } from '@/platform'
import { formatBytes } from '@/utils/format'
import { useAndroidAppStatus } from '@/hooks/useAndroidAppStatus'

const INSTALL_STEPS = [
  'Download the APK on your phone.',
  'Open the file and allow the install when asked.',
  'In the app, enter this server’s address under Settings → Server.',
]

// Offers the sideloadable Android APK for download. Only rendered in the
// browser (not inside the app itself) and only when the server actually has
// an APK — check /api/settings/android-app directly when debugging a
// deployment where the card is unexpectedly absent.
export default function AndroidAppSection() {
  const { theme } = useTheme()
  const { data } = useAndroidAppStatus()

  if (isNativeApp || !data?.present) return null

  return (
    <SettingsSection
      title="Android app"
      description="Fetchr as a native app with real offline storage — no browser limits."
    >
      <ol className="space-y-2 mb-4">
        {INSTALL_STEPS.map((step, i) => (
          <li key={i} className="flex items-center gap-2.5 text-xs" style={{ color: theme.text2 }}>
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: `${theme.accent}15`, color: theme.accent }}
            >
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          variant="primary"
          onClick={downloadAndroidApp}
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          }
        >
          Download APK
        </Button>
        <span className="text-xs" style={{ color: theme.text2 }}>
          {formatBytes(data.size)}
          {data.updatedAt ? ` · built ${new Date(data.updatedAt).toLocaleDateString()}` : ''}
        </span>
      </div>
    </SettingsSection>
  )
}
