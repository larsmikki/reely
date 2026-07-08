// IndexedDB storage for offline video downloads. Used from both the React app
// (writes) and the service worker (reads) — sw.ts imports this module directly,
// so there is a single source of truth for the schema.
//
// v2 stores videos as fixed-size chunks so a movie never has to exist in
// memory as one contiguous buffer (v1 stored a single Blob, which meant
// buffering multi-GB files in RAM during download). v1 records remain
// readable: their meta row carries a `blob` and no `chunkSize`.

export const DB_NAME = 'offline'
export const DB_VERSION = 2
export const STORE_VIDEOS = 'videos'
export const STORE_CHUNKS = 'chunks'
export const CHUNK_SIZE = 8 * 1024 * 1024

export interface OfflineVideoMeta {
  id: number
  mimeType: string
  size: number
  downloadedAt: number
  /** Uniform chunk length in STORE_CHUNKS; the last chunk may be shorter. */
  chunkSize?: number
  chunkCount?: number
  /** Legacy v1 records stored the whole file as one blob. */
  blob?: Blob
}

export interface OfflineChunk {
  videoId: number
  index: number
  data: Blob
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: ['videoId', 'index'] })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

function chunkRange(videoId: number): IDBKeyRange {
  return IDBKeyRange.bound([videoId, 0], [videoId, Infinity])
}

export async function putOfflineVideoMeta(meta: OfflineVideoMeta): Promise<void> {
  await withStore(STORE_VIDEOS, 'readwrite', store => store.put(meta))
}

export async function putOfflineChunk(chunk: OfflineChunk): Promise<void> {
  await withStore(STORE_CHUNKS, 'readwrite', store => store.put(chunk))
}

export async function getOfflineVideo(id: number): Promise<OfflineVideoMeta | undefined> {
  return withStore<OfflineVideoMeta | undefined>(STORE_VIDEOS, 'readonly', store => store.get(id))
}

export async function hasOfflineVideo(id: number): Promise<boolean> {
  const key = await withStore<IDBValidKey | undefined>(STORE_VIDEOS, 'readonly', store => store.getKey(id))
  return key !== undefined
}

/** Removes the meta record and any chunks (including partial downloads). */
export async function deleteOfflineVideo(id: number): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_VIDEOS, STORE_CHUNKS], 'readwrite')
    tx.objectStore(STORE_VIDEOS).delete(id)
    tx.objectStore(STORE_CHUNKS).delete(chunkRange(id))
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function listOfflineVideoIds(): Promise<number[]> {
  const keys = await withStore<IDBValidKey[]>(STORE_VIDEOS, 'readonly', store => store.getAllKeys())
  return keys.map(k => Number(k))
}

/**
 * Reads bytes [start, end] (inclusive) of a downloaded video as a Blob.
 * Chunk blobs are disk-backed, so composing them does not load the bytes
 * into memory — the Response streams them straight from disk.
 */
export async function readOfflineRange(meta: OfflineVideoMeta, start: number, end: number): Promise<Blob> {
  if (meta.blob) return meta.blob.slice(start, end + 1, meta.mimeType)
  const chunkSize = meta.chunkSize ?? CHUNK_SIZE
  const first = Math.floor(start / chunkSize)
  const last = Math.floor(end / chunkSize)
  const records = await withStore<OfflineChunk[]>(STORE_CHUNKS, 'readonly', store =>
    store.getAll(IDBKeyRange.bound([meta.id, first], [meta.id, last])))
  if (records.length !== last - first + 1) {
    throw new Error(`offline video ${meta.id}: expected ${last - first + 1} chunks, found ${records.length}`)
  }
  const joined = new Blob(records.map(r => r.data), { type: meta.mimeType })
  const offset = start - first * chunkSize
  return joined.slice(offset, offset + (end - start + 1), meta.mimeType)
}
