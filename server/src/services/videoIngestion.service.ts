import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { videosRepo } from '../db/repositories/videos.js';
import { collectionsRepo } from '../db/repositories/collections.js';
import { jobsRepo } from '../db/repositories/jobs.js';
import { config } from '../config.js';
import { deleteSidecar, writeSidecarForVideo } from '../utils/sidecar.js';
import type { DesktopId, Video } from '../types/index.js';

async function removeVideoArtifacts(videoId: number, localPath: string | null): Promise<void> {
  if (localPath) {
    await unlink(localPath).catch(err => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[cleanup] failed to remove ${localPath}:`, (err as Error).message);
      }
    });
    await deleteSidecar(localPath);
  }
  // yt-dlp may leave .part / fragment files sharing the same stem in the videos dir
  try {
    const entries = await readdir(config.videosDir);
    const stem = localPath
      ? path.basename(localPath, path.extname(localPath))
      : String(videoId);
    const base = localPath ? path.basename(localPath) : null;
    await Promise.all(
      entries
        .filter(name => name.startsWith(`${stem}.`) && name !== base)
        .map(name => unlink(path.join(config.videosDir, name)).catch(() => {})),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[cleanup] failed to scan videosDir:', (err as Error).message);
    }
  }
}

export interface IngestionOptions {
  outputMp4?: boolean;
  downloadMp3?: boolean;
}

export function ingestNewVideo(
  input: { url: string; collectionId: number | null; notes: string | null; desktopId: DesktopId },
  options: IngestionOptions = {},
): Video {
  const video = videosRepo.create({
    pageUrl: input.url,
    collectionId: input.collectionId,
    notes: input.notes,
    desktopId: input.desktopId,
  });

  jobsRepo.enqueue({
    videoId: video.id,
    kind: 'extract_metadata',
    payload: {
      url: input.url,
      outputMp4: options.outputMp4,
      downloadMp3: options.downloadMp3,
    },
  });

  return video;
}

export function reingestVideo(
  videoId: number,
  newUrl: string,
  options: IngestionOptions = {},
): Video | null {
  jobsRepo.cancelPendingForVideo(videoId);
  const updated = videosRepo.update(videoId, { pageUrl: newUrl, resetMetadata: true });
  if (!updated) return null;

  jobsRepo.enqueue({
    videoId,
    kind: 'extract_metadata',
    payload: {
      url: newUrl,
      outputMp4: options.outputMp4,
      downloadMp3: options.downloadMp3,
    },
  });

  return updated;
}

export function enqueueDownload(videoId: number): boolean {
  const video = videosRepo.findById(videoId);
  if (!video) return false;
  jobsRepo.enqueue({
    videoId,
    kind: 'download_video',
    payload: { url: video.page_url, title: video.title },
  });
  return true;
}

export function enqueueMp3Export(videoId: number): boolean {
  const video = videosRepo.findById(videoId);
  if (!video) return false;
  jobsRepo.enqueue({
    videoId,
    kind: 'download_mp3',
    payload: { url: video.page_url },
  });
  return true;
}

export function enqueueOutputCopy(videoId: number): boolean {
  const video = videosRepo.findById(videoId);
  if (!video || !video.local_path) return false;
  jobsRepo.enqueue({
    videoId,
    kind: 'copy_to_output',
    payload: { localPath: video.local_path, title: video.title },
  });
  return true;
}

export async function cleanupAndRetryVideo(videoId: number): Promise<Video | null> {
  const video = videosRepo.findById(videoId);
  if (!video) return null;

  jobsRepo.cancelPendingForVideo(videoId);
  await removeVideoArtifacts(videoId, video.local_path);

  const updated = videosRepo.update(videoId, {
    localPath: null,
    fetchStatus: 'pending',
    fetchError: null,
  });

  jobsRepo.enqueue({
    videoId,
    kind: 'extract_metadata',
    payload: { url: video.page_url },
  });

  return updated;
}

// Deletes the row, its pending jobs, its downloaded file (incl. sidecar and
// stray .part fragments), and prunes the collection if it became empty.
export async function deleteVideoCascade(videoId: number): Promise<boolean> {
  const video = videosRepo.findById(videoId);
  if (!video) return false;
  jobsRepo.cancelPendingForVideo(videoId);
  const collectionId = video.collection_id;
  videosRepo.delete(videoId);
  collectionsRepo.pruneIfEmpty(collectionId);
  await removeVideoArtifacts(videoId, video.local_path);
  return true;
}

export interface VideoUpdateInput {
  collectionId?: number | null;
  notes?: string | null;
  title?: string | null;
  pageUrl?: string;
  redownload?: boolean;
  outputMp4?: boolean;
  downloadMp3?: boolean;
}

export interface VideoUpdateResult {
  video: Video;
  // The page URL changed — callers holding URL-derived caches must invalidate.
  urlChanged: boolean;
}

// Orchestrates a video update: optional reingest on URL change, collection
// pruning, export jobs, and sidecar rewrite.
export async function applyVideoUpdate(
  videoId: number,
  input: VideoUpdateInput,
): Promise<VideoUpdateResult | null> {
  const existing = videosRepo.findById(videoId);
  if (!existing) return null;

  const newUrl = input.pageUrl?.trim();
  const urlChanged = !!(newUrl && newUrl !== existing.page_url);
  const collectionChanged =
    input.collectionId !== undefined && input.collectionId !== existing.collection_id;

  if (input.redownload && urlChanged) {
    const updated = reingestVideo(videoId, newUrl!, {
      outputMp4: input.outputMp4,
      downloadMp3: input.downloadMp3,
    });
    if (!updated) return null;
    if (collectionChanged) {
      videosRepo.update(videoId, { collectionId: input.collectionId });
      collectionsRepo.pruneIfEmpty(existing.collection_id);
    }
    return { video: videosRepo.findById(videoId) ?? updated, urlChanged };
  }

  const updated = videosRepo.update(videoId, {
    collectionId: input.collectionId,
    notes: input.notes,
    title: input.title,
    pageUrl: urlChanged ? newUrl : undefined,
  });
  if (!updated) return null;

  if (collectionChanged) collectionsRepo.pruneIfEmpty(existing.collection_id);

  if (input.outputMp4 && existing.local_path) enqueueOutputCopy(videoId);
  if (input.downloadMp3) enqueueMp3Export(videoId);

  const titleChanged = input.title !== undefined && input.title !== existing.title;
  if (updated.local_path && (titleChanged || collectionChanged)) {
    await writeSidecarForVideo(videoId);
  }

  return { video: updated, urlChanged };
}

export interface BulkMoveResult {
  moved: number;
  movedCollections: number;
  requested: number;
}

// Move videos to another desktop, remapping each video's collection to the
// same-named collection on the target desktop (creating it on the fly).
// Collections are per-desktop, so the old collection_id can't carry across.
export function bulkMoveVideos(ids: number[], desktopId: DesktopId): BulkMoveResult {
  const collectionRemap = new Map<number, number | null>();
  let moved = 0;
  let movedCollections = 0;
  const sourceCollections = new Set<number>();

  for (const id of ids) {
    const video = videosRepo.findById(id);
    if (!video || video.desktop_id === desktopId) continue;

    let newCollectionId: number | null = null;
    if (video.collection_id != null) {
      const cached = collectionRemap.get(video.collection_id);
      if (cached !== undefined) {
        newCollectionId = cached;
      } else {
        const src = collectionsRepo.findById(video.collection_id);
        if (src) {
          const existing = collectionsRepo.findByNameAndDesktop(src.name, desktopId);
          if (existing) {
            newCollectionId = existing.id;
          } else {
            const created = collectionsRepo.create({
              name: src.name,
              description: src.description,
              color: src.color,
              desktopId,
            });
            newCollectionId = created.id;
            movedCollections++;
          }
          collectionRemap.set(video.collection_id, newCollectionId);
          sourceCollections.add(video.collection_id);
        }
      }
    }

    videosRepo.moveToDesktop(id, desktopId, newCollectionId);
    moved++;
  }

  for (const cid of sourceCollections) collectionsRepo.pruneIfEmpty(cid);

  return { moved, movedCollections, requested: ids.length };
}
