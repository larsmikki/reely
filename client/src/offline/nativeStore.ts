// Offline video storage for the native (Capacitor) app. Videos are written to
// the app's private data directory via the Filesystem plugin — unlike browser
// storage there is no quota and the OS never evicts it behind our back.
// A small index in localStorage tracks what is stored, including the video's
// metadata and a locally saved thumbnail so the library can be browsed with
// no server connection.

import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { apiUrl } from '@/platform'
import type { Video } from '@/types'

const DIR = Directory.Data
const FOLDER = 'offline-videos'
const INDEX_KEY = 'offline_native_index'

// Streamed download flush size. Each flush is base64-encoded and appended to
// the file, so this bounds peak memory per write.
const FLUSH_BYTES = 4 * 1024 * 1024

interface NativeIndexEntry {
  path: string
  size: number
  mimeType: string
  downloadedAt: number
  /** Full video metadata — lets the offline library render without a server.
      Missing on entries saved by builds that predate it (backfilled later). */
  meta?: Video
  /** Locally saved thumbnail, if the download of it succeeded. */
  thumbPath?: string
}

export interface NativeOfflineVideo {
  id: number
  size: number
  /** webview-servable URL for use as a <video> src */
  src: string
  meta?: Video
  /** webview-servable URL for use as an <img> src */
  thumbSrc?: string
}

function readIndex(): Record<string, NativeIndexEntry> {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}') } catch { return {} }
}

function writeIndex(index: Record<string, NativeIndexEntry>): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('matroska')) return 'mkv'
  return 'mp4'
}

const MIME_FOR_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

// The index lives in localStorage, which can vanish while the files survive —
// e.g. the webview origin changed between app versions. Re-adopt any video
// file on disk that the index doesn't know about; its metadata is backfilled
// later by backfillNativeMeta while the server is reachable.
async function reconcileIndexWithDisk(index: Record<string, NativeIndexEntry>): Promise<void> {
  let files
  try {
    files = (await Filesystem.readdir({ directory: DIR, path: FOLDER })).files
      .filter(f => f.type === 'file')
  } catch {
    return // folder doesn't exist yet — nothing downloaded
  }
  const thumbs = new Set(files.map(f => f.name).filter(n => n.endsWith('.jpg')))
  let changed = false
  for (const f of files) {
    const m = f.name.match(/^(\d+)\.([a-z0-9]+)$/i)
    if (!m) continue
    const mimeType = MIME_FOR_EXTENSION[m[2].toLowerCase()]
    if (!mimeType || index[m[1]]) continue
    index[m[1]] = {
      path: `${FOLDER}/${f.name}`,
      size: f.size,
      mimeType,
      downloadedAt: f.mtime ?? Date.now(),
      ...(thumbs.has(`${m[1]}.jpg`) ? { thumbPath: `${FOLDER}/${m[1]}.jpg` } : {}),
    }
    changed = true
  }
  if (changed) writeIndex(index)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    // result is a data: URL — strip the "data:...;base64," prefix
    fr.onload = () => resolve(String(fr.result).slice(String(fr.result).indexOf(',') + 1))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

async function toSrc(path: string): Promise<string> {
  const { uri } = await Filesystem.getUri({ directory: DIR, path })
  return Capacitor.convertFileSrc(uri)
}

// Best-effort: fetch the thumbnail and store it next to the video file.
// Returns the stored path, or undefined when the fetch failed (offline
// library falls back to a placeholder).
async function saveThumbnail(id: number): Promise<string | undefined> {
  try {
    const res = await fetch(apiUrl(`/api/videos/${id}/thumbnail`))
    if (!res.ok) return undefined
    const data = await blobToBase64(await res.blob())
    const path = `${FOLDER}/${id}.jpg`
    await Filesystem.writeFile({ directory: DIR, path, data, recursive: true })
    return path
  } catch {
    return undefined
  }
}

async function entryToOfflineVideo(idStr: string, entry: NativeIndexEntry): Promise<NativeOfflineVideo> {
  let thumbSrc: string | undefined
  if (entry.thumbPath) {
    try { thumbSrc = await toSrc(entry.thumbPath) } catch { /* placeholder */ }
  }
  return { id: Number(idStr), size: entry.size, src: await toSrc(entry.path), meta: entry.meta, thumbSrc }
}

export async function nativeList(): Promise<NativeOfflineVideo[]> {
  const index = readIndex()
  await reconcileIndexWithDisk(index)
  const result: NativeOfflineVideo[] = []
  for (const [idStr, entry] of Object.entries(index)) {
    try {
      await Filesystem.stat({ directory: DIR, path: entry.path })
      result.push(await entryToOfflineVideo(idStr, entry))
    } catch {
      // File vanished (e.g. cleared app data selectively) — drop the index row.
      const fresh = readIndex()
      delete fresh[idStr]
      writeIndex(fresh)
    }
  }
  return result
}

// Attach metadata (and a thumbnail) to an already-stored download — used to
// backfill entries saved by builds that didn't store meta yet.
export async function nativeSaveMeta(id: number, meta: Video): Promise<void> {
  const index = readIndex()
  const entry = index[String(id)]
  if (!entry) return
  const thumbPath = entry.thumbPath ?? (await saveThumbnail(id))
  // Re-read: saveThumbnail awaited, another write may have landed meanwhile.
  const fresh = readIndex()
  if (!fresh[String(id)]) return
  fresh[String(id)] = { ...fresh[String(id)], meta, ...(thumbPath ? { thumbPath } : {}) }
  writeIndex(fresh)
}

export async function nativeDelete(id: number): Promise<void> {
  const index = readIndex()
  const entry = index[String(id)]
  if (entry) {
    await Filesystem.deleteFile({ directory: DIR, path: entry.path }).catch(() => {})
    if (entry.thumbPath) {
      await Filesystem.deleteFile({ directory: DIR, path: entry.thumbPath }).catch(() => {})
    }
    delete index[String(id)]
    writeIndex(index)
  }
}

export async function nativeDownload(
  video: Video,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
): Promise<NativeOfflineVideo> {
  const id = video.id
  const res = await fetch(apiUrl(`/api/videos/${id}/stream`), { signal })
  if (!res.ok || !res.body) throw new Error(`Stream request failed: ${res.status}`)

  const total = Number(res.headers.get('Content-Length') ?? 0)
  const mimeType = res.headers.get('Content-Type') ?? 'video/mp4'
  const path = `${FOLDER}/${id}.${extensionFor(mimeType)}`

  const reader = res.body.getReader()
  let pending: BlobPart[] = []
  let pendingBytes = 0
  let received = 0
  let fileStarted = false

  const flush = async () => {
    if (pendingBytes === 0) return
    const data = await blobToBase64(new Blob(pending))
    pending = []
    pendingBytes = 0
    if (fileStarted) {
      await Filesystem.appendFile({ directory: DIR, path, data })
    } else {
      await Filesystem.writeFile({ directory: DIR, path, data, recursive: true })
      fileStarted = true
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending.push(value)
      pendingBytes += value.byteLength
      received += value.byteLength
      if (pendingBytes >= FLUSH_BYTES) await flush()
      onProgress(received, total)
    }
    await flush()

    const thumbPath = await saveThumbnail(id)

    const index = readIndex()
    index[String(id)] = { path, size: received, mimeType, downloadedAt: Date.now(), meta: video, thumbPath }
    writeIndex(index)
    return entryToOfflineVideo(String(id), index[String(id)])
  } catch (err) {
    // Remove the partial file so a retry starts clean.
    await Filesystem.deleteFile({ directory: DIR, path }).catch(() => {})
    throw err
  }
}
