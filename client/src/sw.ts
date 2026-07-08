/// <reference lib="webworker" />
// Service worker. Built by vite-plugin-pwa (injectManifest strategy), which
// replaces self.__WB_MANIFEST with the list of every built asset + revision.
//
// - Precaches the full app shell (index.html + hashed bundles) so the app
//   launches offline even right after a deploy.
// - Intercepts GET /api/videos/:id/stream and serves bytes from IndexedDB when
//   the user has downloaded the video. Honors HTTP Range for seeking.
// - Video/collection lists are network-first with a cache fallback, thumbnails
//   stale-while-revalidate, so the grid renders without the server. Lists must
//   be network-first: serving the cached copy first would show data one launch
//   behind, and a bad cached entry (e.g. from before the native app's server
//   URL was configured) would permanently mask live data. Desk 2 lists are
//   deliberately never cached — cached copies would be readable without the PIN.

import { getOfflineVideo, readOfflineRange, type OfflineVideoMeta } from './offline/db'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}

const manifest = (self.__WB_MANIFEST || []).map(e =>
  typeof e === 'string' ? { url: e, revision: null } : e,
)

// Cache name derived from the manifest contents: any changed asset produces a
// new cache, and activate() drops the old one.
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const VERSION = fnv1a(manifest.map(e => `${e.url}@${e.revision}`).sort().join('|'))
const STATIC_CACHE = `static-${VERSION}`
// v2: list entries switched from stale-while-revalidate to network-first;
// the bump drops caches that may hold a stale/broken list response.
const API_CACHE = 'api-v2'

const PRECACHE_URLS = [...new Set(
  manifest.map(e => new URL(e.url, self.location.origin).pathname),
)]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS)).catch(err => {
      console.warn('[sw] precache failed:', err)
    }),
  )
  void self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== API_CACHE).map(k => caches.delete(k)),
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin

  if (url.pathname.startsWith('/api/')) {
    // Plain-HTTP cross-origin (native app → LAN server): fetches made *by the
    // service worker* are mixed-content blocked even when the webview allows
    // them from the page, so stay out of the way entirely and let the page
    // request these directly. With an HTTPS server the caching applies again.
    if (!sameOrigin && url.protocol !== 'https:') return

    const streamMatch = url.pathname.match(/^\/api\/videos\/(\d+)\/stream$/)
    if (streamMatch) {
      // Web only — in the native app offline playback uses a local file src.
      if (sameOrigin) event.respondWith(handleVideoStream(Number(streamMatch[1]), req))
      return
    }
    // List/thumbnail caching applies to any origin: the native app talks to
    // the server cross-origin but still wants an offline grid.
    if (url.pathname.startsWith('/api/videos/') && url.pathname.endsWith('/thumbnail')) {
      event.respondWith(staleWhileRevalidate(req))
      return
    }
    if (
      (url.pathname === '/api/videos' || url.pathname === '/api/collections') &&
      url.searchParams.get('desktop') !== '2'
    ) {
      event.respondWith(networkFirst(req))
      return
    }
    // Other API responses are stateful (jobs, settings, auth) — network only.
    return
  }

  if (!sameOrigin) return

  // App shell + assets — cache first, falling back to network.
  event.respondWith(cacheFirst(req))
})

async function handleVideoStream(id: number, req: Request): Promise<Response> {
  let meta: OfflineVideoMeta | undefined
  try {
    meta = await getOfflineVideo(id)
  } catch {
    meta = undefined
  }
  if (!meta) return fetch(req)
  try {
    return await buildRangeResponse(meta, req.headers.get('Range'))
  } catch (err) {
    console.warn('[sw] offline read failed, falling back to network:', err)
    return fetch(req)
  }
}

async function buildRangeResponse(meta: OfflineVideoMeta, rangeHeader: string | null): Promise<Response> {
  const size = meta.size
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null

  if (!match || (match[1] === '' && match[2] === '')) {
    const blob = await readOfflineRange(meta, 0, size - 1)
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': meta.mimeType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    })
  }

  let start: number
  let end: number
  if (match[1] === '') {
    // Suffix range: bytes=-N means the last N bytes.
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    })
  }

  const blob = await readOfflineRange(meta, start, end)
  return new Response(blob, {
    status: 206,
    headers: {
      'Content-Type': meta.mimeType,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  })
}

async function networkFirst(req: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
    return res
  } catch (err) {
    const cached = await cache.match(req)
    if (cached) return cached
    throw err
  }
}

async function staleWhileRevalidate(req: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE)
  const cached = await cache.match(req)
  const fetchPromise = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
    return res
  }).catch(err => {
    if (cached) return cached
    throw err
  })
  return cached || fetchPromise
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
    return res
  } catch (err) {
    // Last-resort fallback for navigations: serve the cached shell.
    if (req.mode === 'navigate') {
      const shell = await cache.match('/index.html')
      if (shell) return shell
    }
    throw err
  }
}
