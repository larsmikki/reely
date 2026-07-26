import { Router, Request, Response } from 'express';
import { pipeline } from 'node:stream';
import { access, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fetch from 'node-fetch';
import { videosRepo, type VideoSort } from '../db/repositories/videos.js';
import { jobsRepo } from '../db/repositories/jobs.js';
import { settingsRepo } from '../db/repositories/settings.js';
import { getStreamUrl, extractVideoInfo } from '../services/extractor.service.js';
import {
  ingestNewVideo,
  enqueueDownload,
  deleteVideoCascade,
  cleanupAndRetryVideo,
  applyVideoUpdate,
  bulkMoveVideos,
} from '../services/videoIngestion.service.js';
import { guardOutboundUrl } from '../utils/url-guard.js';
import { writeSidecarForVideo } from '../utils/sidecar.js';
import { parseDesktopId } from '../utils/desktop.js';
import { config } from '../config.js';

const router = Router();
const execFileAsync = promisify(execFile);

// Cache stream URLs to avoid re-running yt-dlp on every browser range request.
// The in-flight promise is cached (not just the resolved URL) so concurrent
// range requests on a cache miss share a single yt-dlp process.
// ponytail: FIFO eviction via Map insertion order, upgrade to LRU if cache pressure shows
const STREAM_URL_CACHE_MAX = 200;
const STREAM_URL_TTL_MS = 4 * 60 * 60 * 1000;
const streamUrlCache = new Map<number, { promise: Promise<string>; expiresAt: number }>();

function getCachedStreamUrl(id: number, pageUrl: string): Promise<string> {
  const now = Date.now();
  const cached = streamUrlCache.get(id);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) streamUrlCache.delete(id);

  // Evict oldest entry when at capacity
  if (streamUrlCache.size >= STREAM_URL_CACHE_MAX) {
    streamUrlCache.delete(streamUrlCache.keys().next().value!);
  }

  const promise = getStreamUrl(pageUrl);
  streamUrlCache.set(id, { promise, expiresAt: now + STREAM_URL_TTL_MS });
  promise.catch(() => { if (streamUrlCache.get(id)?.promise === promise) streamUrlCache.delete(id); });
  return promise;
}

// GET /api/videos
router.get('/', (req: Request, res: Response) => {
  const collectionId = req.query.collection_id as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
  const q = (req.query.q as string | undefined)?.trim() || undefined;
  const desktopId = parseDesktopId(req.query.desktop);

  let collection: number | 'null' | undefined;
  if (collectionId === 'null' || collectionId === '') collection = 'null';
  else if (collectionId !== undefined) collection = Number(collectionId);

  const SORTS = new Set(['newest', 'oldest', 'title', 'duration', 'site']);
  const sort = SORTS.has(req.query.sort as string) ? (req.query.sort as VideoSort) : 'newest';

  const { items, total } = videosRepo.list({ desktopId, collectionId: collection, q, page, limit, sort });
  const hasPendingAny = videosRepo.hasPendingAny(desktopId);
  res.json({ items, total, page, totalPages: Math.ceil(total / limit), hasPendingAny });
});

// POST /api/videos
router.post('/', (req: Request, res: Response) => {
  const { url, collection_id, notes, download_mp3, output_mp4, desktop_id } = req.body as {
    url: string;
    collection_id?: number | null;
    notes?: string;
    download_mp3?: boolean;
    output_mp4?: boolean;
    desktop_id?: number;
  };

  if (!url || typeof url !== 'string' || !url.trim()) {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  const desktopId = parseDesktopId(desktop_id);
  const trimmed = url.trim();

  if (videosRepo.existsByUrl(trimmed, desktopId)) {
    res.status(409).json({ error: 'This URL has already been added to this desktop.' });
    return;
  }

  const video = ingestNewVideo(
    { url: trimmed, collectionId: collection_id ?? null, notes: notes ?? null, desktopId },
    { outputMp4: output_mp4, downloadMp3: download_mp3 },
  );

  res.status(201).json(video);
});

// GET /api/videos/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const video = videosRepo.findById(id);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json(video);
});

// GET /api/videos/:id/stream — serve local file if downloaded, otherwise proxy via yt-dlp
router.get('/:id/stream', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const video = videosRepo.findById(id);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  if (video.local_path) {
    try {
      await access(video.local_path);
      res.sendFile(video.local_path, err => {
        if (err && !res.headersSent) res.status(500).json({ error: 'Failed to serve local file' });
      });
      return;
    } catch {
      // fall through to proxy
    }
  }

  let streamUrl: string;
  try {
    streamUrl = await getCachedStreamUrl(id, video.page_url);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
    return;
  }

  const guard = await guardOutboundUrl(streamUrl);
  if (!guard.ok) {
    res.status(502).json({ error: `Stream URL rejected: ${guard.reason}` });
    return;
  }

  const proxyHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': (() => { try { return new URL(video.page_url).origin + '/'; } catch { return video.page_url; } })(),
  };
  if (req.headers.range) proxyHeaders['Range'] = req.headers.range as string;

  try {
    const upstream = await fetch(streamUrl, { headers: proxyHeaders });

    if (upstream.status === 403 || upstream.status === 410) {
      streamUrlCache.delete(id);
      const freshUrl = await getCachedStreamUrl(id, video.page_url);
      const freshGuard = await guardOutboundUrl(freshUrl);
      if (!freshGuard.ok) {
        res.status(502).json({ error: `Refreshed stream URL rejected: ${freshGuard.reason}` });
        return;
      }
      const retried = await fetch(freshUrl, { headers: proxyHeaders });
      if (retried.status >= 400) {
        streamUrlCache.delete(id);
        if (!res.headersSent) res.status(502).json({ error: 'Stream URL unavailable' });
        return;
      }
      pipeUpstream(retried, res);
      return;
    }

    pipeUpstream(upstream, res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: (err as Error).message });
  }
});

function pipeUpstream(upstream: import('node-fetch').Response, res: Response): void {
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('Accept-Ranges', 'bytes');
  if (!upstream.body) { res.end(); return; }
  pipeline(upstream.body as unknown as NodeJS.ReadableStream, res, err => {
    if (err && !res.destroyed) res.destroy(err);
  });
}

// POST /api/videos/:id/refresh — synchronously re-extract metadata
router.post('/:id/refresh', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const video = videosRepo.findById(id);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  videosRepo.update(id, { fetchStatus: 'pending', fetchError: null });
  try {
    const info = await extractVideoInfo(video.page_url);
    const updated = videosRepo.update(id, {
      title: info.title,
      description: info.description,
      duration: info.duration,
      thumbnailUrl: info.thumbnail_url,
      site: info.site,
      sourceId: info.source_id,
      channelId: info.channel_id,
      channelName: info.channel_name,
      publishedAt: info.published_at,
      fetchStatus: 'ok',
      fetchError: null,
    });
    await unlink(path.join(config.thumbsDir, `${id}.jpg`)).catch(() => {});
    if (updated?.local_path) await writeSidecarForVideo(id);
    res.json(updated);
  } catch (err) {
    const message = (err as Error).message;
    const updated = videosRepo.update(id, { fetchStatus: 'error', fetchError: message });
    res.json(updated);
  }
});

// POST /api/videos/:id/redownload
router.post('/:id/redownload', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!enqueueDownload(id)) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.status(202).json({ ok: true });
});

// POST /api/videos/:id/cleanup-retry — cancel in-flight jobs, delete partial files, re-run pipeline
router.post('/:id/cleanup-retry', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const updated = await cleanupAndRetryVideo(id);
  if (!updated) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.status(202).json({ ok: true });
});

// GET /api/videos/:id/thumbnail — serves from disk cache; fetches and caches on first request
router.get('/:id/thumbnail', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const video = videosRepo.findById(id);
  if (!video) {
    res.status(404).json({ error: 'No thumbnail available' });
    return;
  }

  const cachePath = path.join(config.thumbsDir, `${id}.jpg`);
  try {
    await access(cachePath);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(cachePath);
    return;
  } catch { /* not cached yet */ }

  if (!video.thumbnail_url) {
    res.status(404).json({ error: 'No thumbnail available' });
    return;
  }

  const guard = await guardOutboundUrl(video.thumbnail_url);
  if (!guard.ok) {
    res.status(502).json({ error: `Thumbnail URL rejected: ${guard.reason}` });
    return;
  }

  try {
    const response = await fetch(video.thumbnail_url);
    if (!response.ok) { res.status(502).json({ error: 'Failed to fetch thumbnail' }); return; }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buf = Buffer.from(await response.arrayBuffer());
    writeFile(cachePath, buf).catch(() => {}); // fire-and-forget
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// PUT /api/videos/:id
router.put('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as {
    collection_id?: number | null;
    notes?: string | null;
    title?: string | null;
    download_mp3?: boolean;
    output_mp4?: boolean;
    page_url?: string;
    redownload?: boolean;
  };

  const result = await applyVideoUpdate(id, {
    collectionId: body.collection_id,
    notes: body.notes,
    title: body.title,
    pageUrl: body.page_url,
    redownload: body.redownload,
    outputMp4: body.output_mp4,
    downloadMp3: body.download_mp3,
  });
  if (!result) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  if (result.urlChanged) streamUrlCache.delete(id);
  res.json(result.video);
});

// POST /api/videos/:id/refresh-thumbnail — enqueue a fetch_thumbnail job
router.post('/:id/refresh-thumbnail', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const video = videosRepo.findById(id);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  if (!video.page_url) {
    res.status(400).json({ error: 'Video has no page URL' });
    return;
  }
  jobsRepo.enqueue({
    videoId: id,
    kind: 'fetch_thumbnail',
    payload: { url: video.page_url },
  });
  res.json({ ok: true });
});

// POST /api/videos/:id/capture-thumbnail — grab a frame from the local video file with ffmpeg
router.post('/:id/capture-thumbnail', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const video = videosRepo.findById(id);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  if (!video.local_path) {
    res.status(400).json({ error: 'No local video file to capture a frame from' });
    return;
  }
  try {
    await access(video.local_path);
  } catch {
    res.status(400).json({ error: 'Local video file is missing' });
    return;
  }

  const ffmpegPath = settingsRepo.getMany(['ffmpeg_path'])['ffmpeg_path'] || config.ffmpegPath;
  const cachePath = path.join(config.thumbsDir, `${id}.jpg`);
  // ponytail: grab the frame at 1s (skips a likely-black opening frame); fall back to 0s for very short clips
  try {
    await execFileAsync(ffmpegPath, ['-y', '-ss', '1', '-i', video.local_path, '-frames:v', '1', '-q:v', '3', cachePath]);
  } catch {
    try {
      await execFileAsync(ffmpegPath, ['-y', '-ss', '0', '-i', video.local_path, '-frames:v', '1', '-q:v', '3', cachePath]);
    } catch (err) {
      res.status(500).json({ error: `Failed to capture frame: ${(err as Error).message}` });
      return;
    }
  }
  res.json({ ok: true });
});

// POST /api/videos/bulk-move — move many videos to another desktop
router.post('/bulk-move', (req: Request, res: Response) => {
  const body = req.body as { ids?: unknown; desktop_id?: unknown };
  const desktopId = Number(body.desktop_id);
  if (desktopId !== 1 && desktopId !== 2) {
    res.status(400).json({ error: 'desktop_id must be 1 or 2' });
    return;
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    res.status(400).json({ error: 'ids must be a non-empty array' });
    return;
  }
  const ids = body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    res.status(400).json({ error: 'ids must contain positive integers' });
    return;
  }

  res.json(bulkMoveVideos(ids, desktopId));
});

// DELETE /api/videos/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!(await deleteVideoCascade(id))) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  streamUrlCache.delete(id);
  res.json({ status: 'ok' });
});

// GET /api/videos/:id/jobs — recent jobs for this video
router.get('/:id/jobs', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!videosRepo.findById(id)) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  res.json({ items: jobsRepo.listForVideo(id) });
});

export default router;
