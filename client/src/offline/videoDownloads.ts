import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  CHUNK_SIZE,
  deleteOfflineVideo,
  getOfflineVideo,
  hasOfflineVideo,
  listOfflineVideoIds,
  putOfflineChunk,
  putOfflineVideoMeta,
} from './db'
import { nativeDelete, nativeDownload, nativeList, nativeSaveMeta, type NativeOfflineVideo } from './nativeStore'
import { apiUrl, isNativeApp } from '@/platform'
import { getVideoById } from '@/api'
import type { Video } from '@/types'

export type OfflineState =
  | { status: 'absent' }
  | { status: 'downloading'; progress: number }
  // `src` is set on native, where the copy is a sandbox file the <video>
  // element must load directly. On web it is absent — playback keeps using
  // the stream URL and the service worker serves it from IndexedDB.
  | { status: 'available'; size: number; src?: string }
  | { status: 'error'; message: string }

type Listener = () => void

const ABSENT: OfflineState = { status: 'absent' }
const states = new Map<number, OfflineState>()
const listeners = new Map<number, Set<Listener>>()
const inflight = new Map<number, AbortController>()
let initialized = false
let initPromise: Promise<void> | null = null

function notify(id: number): void {
  const set = listeners.get(id)
  if (!set) return
  for (const fn of set) fn()
}

function setState(id: number, state: OfflineState): void {
  states.set(id, state)
  notify(id)
}

// Entries saved by builds that predate stored metadata can't render in the
// offline library — fetch their metadata once while the server is reachable.
function backfillNativeMeta(entries: NativeOfflineVideo[]): void {
  for (const entry of entries) {
    if (entry.meta) continue
    getVideoById(entry.id)
      .then(video => nativeSaveMeta(entry.id, video))
      .catch(() => { /* offline or video deleted — retried on next launch */ })
  }
}

async function hydrate(): Promise<void> {
  if (initialized) return
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      if (isNativeApp) {
        const entries = await nativeList()
        for (const v of entries) {
          states.set(v.id, { status: 'available', size: v.size, src: v.src })
        }
        backfillNativeMeta(entries)
      } else {
        const ids = await listOfflineVideoIds()
        for (const id of ids) {
          const meta = await getOfflineVideo(id)
          if (meta) states.set(id, { status: 'available', size: meta.size })
        }
      }
    } catch (err) {
      console.warn('[offline] hydrate failed:', err)
    }
    initialized = true
    for (const id of states.keys()) notify(id)
  })()
  return initPromise
}

function subscribe(id: number, listener: Listener): () => void {
  let set = listeners.get(id)
  if (!set) {
    set = new Set()
    listeners.set(id, set)
  }
  set.add(listener)
  void hydrate()
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listeners.delete(id)
  }
}

function getSnapshot(id: number): OfflineState {
  return states.get(id) ?? ABSENT
}

export function useOfflineState(id: number): OfflineState {
  return useSyncExternalStore(
    cb => subscribe(id, cb),
    () => getSnapshot(id),
    () => getSnapshot(id),
  )
}

export function useOfflineHydrated(): boolean {
  const [ready, setReady] = useState(initialized)
  useEffect(() => {
    if (initialized) return
    void hydrate().then(() => setReady(true))
  }, [])
  return ready
}

function reportProgress(id: number, received: number, total: number): void {
  if (total > 0) {
    setState(id, { status: 'downloading', progress: received / total })
  } else {
    // Unknown size — still surface activity by asymptotically approaching 1
    setState(id, { status: 'downloading', progress: Math.min(0.99, received / (received + 1_000_000)) })
  }
}

// Streams the response into fixed-size IndexedDB chunk records so at most
// one chunk is ever held in memory, regardless of file size.
async function downloadToIndexedDb(id: number, signal: AbortSignal): Promise<number> {
  const res = await fetch(apiUrl(`/api/videos/${id}/stream`), { signal })
  if (!res.ok || !res.body) throw new Error(`Stream request failed: ${res.status}`)

  const total = Number(res.headers.get('Content-Length') ?? 0)
  const mimeType = res.headers.get('Content-Type') ?? 'video/mp4'

  const reader = res.body.getReader()
  let pending: BlobPart[] = []
  let pendingBytes = 0
  let chunkIndex = 0
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength

    // Cut exact CHUNK_SIZE boundaries — readOfflineRange relies on every
    // chunk except the last having the same length.
    let part = value as Uint8Array<ArrayBuffer>
    while (pendingBytes + part.byteLength >= CHUNK_SIZE) {
      const take = CHUNK_SIZE - pendingBytes
      pending.push(part.subarray(0, take))
      await putOfflineChunk({ videoId: id, index: chunkIndex++, data: new Blob(pending) })
      pending = []
      pendingBytes = 0
      part = part.subarray(take)
    }
    if (part.byteLength > 0) {
      pending.push(part)
      pendingBytes += part.byteLength
    }
    reportProgress(id, received, total)
  }
  if (pendingBytes > 0) {
    await putOfflineChunk({ videoId: id, index: chunkIndex++, data: new Blob(pending) })
  }

  await putOfflineVideoMeta({
    id,
    mimeType,
    size: received,
    chunkSize: CHUNK_SIZE,
    chunkCount: chunkIndex,
    downloadedAt: Date.now(),
  })
  return received
}

export async function downloadVideo(video: Video): Promise<void> {
  const id = video.id
  if (inflight.has(id)) return
  const ctrl = new AbortController()
  inflight.set(id, ctrl)
  setState(id, { status: 'downloading', progress: 0 })

  // Best-effort: ask the browser not to evict our storage under pressure.
  // Chrome grants this silently for installed PWAs; Safari requires the app
  // to be added to the home screen.
  if (!isNativeApp) void navigator.storage?.persist?.().catch(() => {})

  try {
    if (isNativeApp) {
      const v = await nativeDownload(video, ctrl.signal, (received, total) => reportProgress(id, received, total))
      setState(id, { status: 'available', size: v.size, src: v.src })
    } else {
      const size = await downloadToIndexedDb(id, ctrl.signal)
      setState(id, { status: 'available', size })
    }
  } catch (err) {
    // Clear any partially written data so a retry starts clean.
    if (!isNativeApp) await deleteOfflineVideo(id).catch(() => {})
    if ((err as Error).name === 'AbortError') {
      setState(id, { status: 'absent' })
    } else {
      console.error('[offline] download failed:', err)
      setState(id, { status: 'error', message: (err as Error).message })
    }
  } finally {
    inflight.delete(id)
  }
}

export function cancelDownload(id: number): void {
  inflight.get(id)?.abort()
}

export async function removeOfflineVideo(id: number): Promise<void> {
  cancelDownload(id)
  if (isNativeApp) {
    await nativeDelete(id)
  } else {
    await deleteOfflineVideo(id)
  }
  setState(id, { status: 'absent' })
}

export async function isAvailableOffline(id: number): Promise<boolean> {
  if (isNativeApp) {
    await hydrate()
    return states.get(id)?.status === 'available'
  }
  return hasOfflineVideo(id)
}

export interface OfflineLibraryEntry {
  video: Video
  size: number
  thumbSrc?: string
}

// The videos saved on this device that can be browsed with no server —
// native only; entries without metadata (not yet backfilled) are skipped.
export async function listOfflineLibrary(desktop: 1 | 2): Promise<OfflineLibraryEntry[]> {
  if (!isNativeApp) return []
  const entries = await nativeList()
  return entries
    .filter((e): e is NativeOfflineVideo & { meta: Video } => !!e.meta && e.meta.desktop_id === desktop)
    .sort((a, b) => (b.meta.added_at > a.meta.added_at ? 1 : -1))
    .map(e => ({ video: e.meta, size: e.size, thumbSrc: e.thumbSrc }))
}
