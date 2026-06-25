import { useTheme } from '@/contexts/ThemeContext'
import ThemePicker from '@/components/ThemePicker'
import { Surface } from '@/components/ui'
import JobsPanel from '@/components/settings/JobsPanel'
import DesksSection from '@/components/settings/DesksSection'
import DownloadsSection from '@/components/settings/DownloadsSection'
import YouTubeAuthSection from '@/components/settings/YouTubeAuthSection'
import AppDataSection from '@/components/settings/AppDataSection'
import MaintenanceSection from '@/components/settings/MaintenanceSection'

export default function SettingsPage() {
  const { theme } = useTheme()

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: theme.text }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: theme.text2 }}>Customize your Fetchr experience.</p>
      </div>

      <Surface className="p-6 mb-5">
        <h2 className="text-base font-bold mb-1" style={{ color: theme.text }}>Themes</h2>
        <p className="text-xs mb-5" style={{ color: theme.text2 }}>Choose a color theme for the interface.</p>
        <ThemePicker />
      </Surface>

      <JobsPanel />
      <DesksSection />
      <DownloadsSection />
      <YouTubeAuthSection />
      <AppDataSection />
      <MaintenanceSection />
    </div>
  )
}
