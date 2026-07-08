import type { Collection, Video, Job, PaginatedResponse, CollectionsResponse } from '@/types'
import { apiUrl } from '@/platform'

function getDesk2Token(): string | null {
  try { return sessionStorage.getItem('desk2_token') } catch { return null }
}
export function setDesk2Token(token: string) {
  try { sessionStorage.setItem('desk2_token', token) } catch {}
}
export function clearDesk2Token() {
  try { sessionStorage.removeItem('desk2_token') } catch {}
}
export function isDesk2Unlocked(): boolean {
  return !!getDesk2Token()
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getDesk2Token()
  const extraHeaders: Record<string, string> = {}
  if (token) extraHeaders['X-Desk2-Token'] = token
  const res = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json', ...extraHeaders, ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = `API error ${res.status}`
    let desk2Locked = false
    try { const j = JSON.parse(text); if (j?.error) message = j.error; if (j?.code === 'DESK2_LOCKED') desk2Locked = true } catch {}
    if (res.status === 403 && desk2Locked) {
      window.dispatchEvent(new CustomEvent('desk2-locked'))
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Active desktop — module-level so all API calls pick it up automatically
let _desktop: 1 | 2 = (() => {
  try { return localStorage.getItem('desktop') === '2' ? 2 : 1 } catch { return 1 }
})()

export function getActiveDesktop(): 1 | 2 { return _desktop }

export function setActiveDesktop(d: 1 | 2) {
  _desktop = d
  try { localStorage.setItem('desktop', String(d)) } catch {}
}

// Collections
export function getCollections(): Promise<CollectionsResponse> {
  return request(`/api/collections?desktop=${_desktop}`)
}

export function createCollection(data: {
  name: string
  description?: string
  color?: string
}): Promise<Collection> {
  return request('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ ...data, desktop_id: _desktop }),
  })
}

export function updateCollection(
  id: number,
  data: Partial<Collection>
): Promise<Collection> {
  return request(`/api/collections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteCollection(id: number): Promise<void> {
  return request(`/api/collections/${id}`, { method: 'DELETE' })
}

export function reorderCollections(ids: number[]): Promise<{ status: string }> {
  return request('/api/collections/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}

// Videos
export function getVideos(params: {
  collection_id?: number | 'uncategorized'
  page?: number
  limit?: number
  q?: string
  sort?: string
}): Promise<PaginatedResponse<Video>> {
  const searchParams = new URLSearchParams()
  searchParams.set('desktop', String(_desktop))
  if (params.collection_id !== undefined)
    searchParams.set('collection_id', String(params.collection_id))
  if (params.page !== undefined) searchParams.set('page', String(params.page))
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params.q) searchParams.set('q', params.q)
  if (params.sort) searchParams.set('sort', params.sort)
  return request(`/api/videos?${searchParams.toString()}`)
}

export function addVideo(data: {
  url: string
  collection_id?: number
  notes?: string
  download_mp3?: boolean
  output_mp4?: boolean
}): Promise<Video> {
  return request('/api/videos', {
    method: 'POST',
    body: JSON.stringify({ ...data, desktop_id: _desktop }),
  })
}

export function updateVideo(id: number, data: Partial<Video> & { download_mp3?: boolean; output_mp4?: boolean; redownload?: boolean }): Promise<Video> {
  return request(`/api/videos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function deleteVideo(id: number): Promise<void> {
  return request(`/api/videos/${id}`, { method: 'DELETE' })
}

export function getVideoById(id: number): Promise<Video> {
  return request(`/api/videos/${id}`)
}

export function refreshVideo(id: number): Promise<Video> {
  return request(`/api/videos/${id}/refresh`, { method: 'POST' })
}

export function refreshVideoThumbnail(id: number): Promise<{ ok: boolean }> {
  return request(`/api/videos/${id}/refresh-thumbnail`, { method: 'POST' })
}

export function captureVideoThumbnail(id: number): Promise<{ ok: boolean }> {
  return request(`/api/videos/${id}/capture-thumbnail`, { method: 'POST' })
}

export function bulkMoveVideos(ids: number[], desktopId: 1 | 2): Promise<{ moved: number; movedCollections: number; requested: number }> {
  return request('/api/videos/bulk-move', {
    method: 'POST',
    body: JSON.stringify({ ids, desktop_id: desktopId }),
  })
}

export function redownloadVideo(id: number): Promise<{ ok: boolean }> {
  return request(`/api/videos/${id}/redownload`, { method: 'POST' })
}

export function thumbnailUrl(id: number): string {
  return apiUrl(`/api/videos/${id}/thumbnail`)
}

// Data export / import
export function exportData(): void {
  const a = document.createElement('a')
  a.href = apiUrl('/api/data/export')
  a.download = 'fetchr-backup.json'
  a.click()
}

export function downloadAllVideos(): void {
  const a = document.createElement('a')
  a.href = apiUrl('/api/data/videos.zip')
  a.download = 'fetchr-videos.zip'
  a.click()
}

export function getFailedJobs(): Promise<{ items: Job[] }> {
  return request('/api/jobs?status=error')
}

export function retryJob(id: number): Promise<{ ok: boolean }> {
  return request(`/api/jobs/${id}/retry`, { method: 'POST' })
}

export function cancelJob(id: number): Promise<{ ok: boolean }> {
  return request(`/api/jobs/${id}/cancel`, { method: 'POST' })
}

export function ignoreJob(id: number): Promise<{ ok: boolean }> {
  return request(`/api/jobs/${id}/ignore`, { method: 'POST' })
}

export function cleanupAndRetryVideo(id: number): Promise<{ ok: boolean }> {
  return request(`/api/videos/${id}/cleanup-retry`, { method: 'POST' })
}

export async function importData(file: File): Promise<{ imported: number }> {
  const text = await file.text()
  const data = JSON.parse(text)
  return request('/api/data/import', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// Settings
export function getSettings(): Promise<Record<string, string>> {
  return request('/api/settings')
}

export function updateSettings(data: Record<string, string>): Promise<void> {
  return request('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function regenerateSidecars(): Promise<{ written: number; failed: number; total: number }> {
  return request('/api/settings/regenerate-sidecars', { method: 'POST' })
}

export function importSidecars(): Promise<{ imported: number; replaced: number; skippedNoMedia: number; failed: number; total: number }> {
  return request('/api/settings/import-sidecars', { method: 'POST' })
}

export function renameToTitles(): Promise<{ renamed: number; skipped: number; failed: number; total: number }> {
  return request('/api/settings/rename-to-titles', { method: 'POST' })
}

export function refreshThumbnails(all = false): Promise<{ enqueued: number }> {
  return request(`/api/settings/refresh-thumbnails${all ? '?all=1' : ''}`, { method: 'POST' })
}

// Desk 2 PIN auth
export function verifyDesk2Pin(pin: string): Promise<{ token: string }> {
  return request('/api/auth/desk2', { method: 'POST', body: JSON.stringify({ pin }) })
}
export function setDesk2Pin(pin: string): Promise<{ ok: boolean }> {
  return request('/api/settings/desk2-pin', { method: 'POST', body: JSON.stringify({ pin }) })
}
export function clearDesk2Pin(currentPin: string): Promise<{ ok: boolean }> {
  return request('/api/settings/desk2-pin', { method: 'DELETE', body: JSON.stringify({ currentPin }) })
}

// Android app download (APK built by build-android-client-app.bat)
export function getAndroidAppStatus(): Promise<{ present: boolean; size: number; updatedAt: string | null }> {
  return request('/api/settings/android-app')
}

export function downloadAndroidApp(): void {
  const a = document.createElement('a')
  a.href = apiUrl('/api/settings/android-app/download')
  a.download = 'fetchr-client.apk'
  a.click()
}

export function getCookieStatus(): Promise<{ present: boolean; size: number; updatedAt: string | null }> {
  return request('/api/settings/cookies')
}

export function uploadCookies(content: string): Promise<{ status: string; looksValid: boolean }> {
  return request('/api/settings/cookies', { method: 'POST', body: JSON.stringify({ content }) })
}

export function deleteCookies(): Promise<{ status: string }> {
  return request('/api/settings/cookies', { method: 'DELETE' })
}
