import { access, rename } from 'node:fs/promises';
import path from 'node:path';
import { videosRepo } from '../db/repositories/videos.js';
import { jobsRepo } from '../db/repositories/jobs.js';
import { writeSidecarForVideo } from '../utils/sidecar.js';
import { sanitizeForFilename } from '../utils/filenames.js';

export interface RegenerateSidecarsResult {
  written: number;
  failed: number;
  total: number;
}

// Write a JSON sidecar next to every downloaded video.
export async function regenerateAllSidecars(): Promise<RegenerateSidecarsResult> {
  const rows = videosRepo.listDownloaded();
  let written = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await writeSidecarForVideo(row.id);
      written++;
    } catch {
      failed++;
    }
  }
  return { written, failed, total: rows.length };
}

export interface RenameToTitlesResult {
  renamed: number;
  skipped: number;
  failed: number;
  total: number;
}

// Rename numeric-id media files (e.g. "43.mp4") to their video title,
// carrying the sidecar along and updating the stored path.
export async function renameFilesToTitles(): Promise<RenameToTitlesResult> {
  const rows = videosRepo.listRenameCandidates();

  let renamed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const stem = path.basename(row.local_path, path.extname(row.local_path));
    if (!/^\d+$/.test(stem)) { skipped++; continue; }

    const sanitized = sanitizeForFilename(row.title);
    if (!sanitized) { skipped++; continue; }

    const ext = path.extname(row.local_path);
    const dir = path.dirname(row.local_path);
    const newPath = path.join(dir, `${sanitized}${ext}`);

    if (newPath === row.local_path) { skipped++; continue; }

    try {
      await access(row.local_path);
    } catch {
      skipped++;
      continue;
    }

    try {
      await access(newPath);
      // Target already exists — skip to avoid overwriting
      skipped++;
      continue;
    } catch { /* target doesn't exist, safe to rename */ }

    try {
      await rename(row.local_path, newPath);

      const oldSidecar = `${row.local_path}.json`;
      const newSidecar = `${newPath}.json`;
      try {
        await rename(oldSidecar, newSidecar);
      } catch { /* sidecar may not exist */ }

      videosRepo.update(row.id, { localPath: newPath });
      renamed++;
    } catch (err) {
      console.error(`[rename-to-titles] failed for video ${row.id}:`, (err as Error).message);
      failed++;
    }
  }

  return { renamed, skipped, failed, total: rows.length };
}

// Enqueue a fetch_thumbnail job for every video with a page URL but no
// thumbnail, or for every video when `all` is set.
export function enqueueThumbnailRefresh(all: boolean): { enqueued: number } {
  const rows = videosRepo.listWithPageUrl(!all);
  for (const row of rows) {
    jobsRepo.enqueue({
      videoId: row.id,
      kind: 'fetch_thumbnail',
      payload: { url: row.page_url },
    });
  }
  return { enqueued: rows.length };
}
