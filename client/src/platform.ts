import { Capacitor } from '@capacitor/core'

// In the browser the client is served by the Fetchr server itself, so API
// paths are same-origin and need no prefix. In the native (Capacitor) app the
// bundle is loaded from the app sandbox, so every API call must be prefixed
// with the user-configured server URL.

export const isNativeApp = Capacitor.isNativePlatform()

const SERVER_URL_KEY = 'server_url'

export function getServerUrl(): string {
  if (!isNativeApp) return ''
  try { return (localStorage.getItem(SERVER_URL_KEY) ?? '').replace(/\/+$/, '') } catch { return '' }
}

export function setServerUrl(url: string): void {
  try { localStorage.setItem(SERVER_URL_KEY, url.trim().replace(/\/+$/, '')) } catch {}
}

export function apiUrl(path: string): string {
  return getServerUrl() + path
}
