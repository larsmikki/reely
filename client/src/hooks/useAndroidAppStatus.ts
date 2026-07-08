import { useQuery } from '@tanstack/react-query'
import { getAndroidAppStatus } from '@/api'
import { isNativeApp } from '@/platform'

// Whether the server has a sideloadable APK to offer. Shared by the Android
// app settings section and the page-level group label around it.
export function useAndroidAppStatus() {
  return useQuery({
    queryKey: ['android-app-status'],
    queryFn: getAndroidAppStatus,
    enabled: !isNativeApp,
  })
}
