import { useTheme } from '@/contexts/ThemeContext'
import ThemePicker from '@/components/ThemePicker'
import SettingsSection from '@/components/settings/SettingsSection'
import JobsPanel from '@/components/settings/JobsPanel'
import DesksSection from '@/components/settings/DesksSection'
import DownloadsSection from '@/components/settings/DownloadsSection'
import YouTubeAuthSection from '@/components/settings/YouTubeAuthSection'
import AppDataSection from '@/components/settings/AppDataSection'
import MaintenanceSection from '@/components/settings/MaintenanceSection'
import ServerSection from '@/components/settings/ServerSection'
import AndroidAppSection from '@/components/settings/AndroidAppSection'
import { useMergedJobs } from '@/hooks/useMergedJobs'

export default function SettingsPage() {
  const { theme } = useTheme()
  const { merged, refreshFailed } = useMergedJobs()

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: theme.text }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: theme.text2 }}>Customize your Fetchr experience.</p>
      </div>

      <ServerSection />
      <SettingsSection title="Themes" description="Choose how Fetchr looks to you.">
        <ThemePicker />
      </SettingsSection>
      <DesksSection />
      <AndroidAppSection />

      <DownloadsSection />
      <YouTubeAuthSection />

      <JobsPanel merged={merged} refreshFailed={refreshFailed} />

      <AppDataSection />
      <MaintenanceSection />
    </div>
  )
}
