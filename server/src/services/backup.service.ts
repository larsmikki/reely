import { access } from 'node:fs/promises';
import path from 'node:path';
import { saveDb } from '../db/connection.js';
import { collectionsRepo } from '../db/repositories/collections.js';
import { videosRepo } from '../db/repositories/videos.js';
import { sanitizeForFilename } from '../utils/filenames.js';
import { parseDesktopId } from '../utils/desktop.js';

export const BACKUP_VERSION = 1;

export interface BackupPayload {
  version: number;
  exported_at: string;
  collections: ReturnType<typeof collectionsRepo.exportAll>;
  videos: ReturnType<typeof videosRepo.exportAll>;
}

export function exportBackup(): BackupPayload {
  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    collections: collectionsRepo.exportAll(),
    videos: videosRepo.exportAll(),
  };
}

export function isValidBackup(body: unknown): body is { collections: unknown[]; videos: unknown[] } {
  const b = body as { version?: number; collections?: unknown; videos?: unknown } | null;
  return !!b && b.version === BACKUP_VERSION && Array.isArray(b.collections) && Array.isArray(b.videos);
}

// Restore collections and videos from a backup. Existing rows (matched by
// name+desktop for collections, page_url+desktop for videos) are kept as-is.
export function importBackup(body: { collections: unknown[]; videos: unknown[] }): { imported: number } {
  const collectionKey = (name: string, desktopId: number) => `${name}:${desktopId}`;
  const nameToId = new Map<string, number>();

  for (const col of body.collections as Record<string, unknown>[]) {
    if (typeof col.name !== 'string' || !col.name) continue;
    const desktopId = parseDesktopId(col.desktop_id);

    const existing = collectionsRepo.findByNameAndDesktop(col.name, desktopId);
    if (existing) {
      nameToId.set(collectionKey(col.name, desktopId), existing.id);
    } else {
      const created = collectionsRepo.create({
        name: col.name,
        description: (col.description as string | undefined) ?? null,
        color: (col.color as string | undefined) ?? '#e11d48',
        sortOrder: Number(col.sort_order) || 0,
        desktopId,
      });
      nameToId.set(collectionKey(col.name, desktopId), created.id);
    }
  }

  let imported = 0;
  for (const vid of body.videos as Record<string, unknown>[]) {
    if (typeof vid.page_url !== 'string' || !vid.page_url) continue;
    const desktopId = parseDesktopId(vid.desktop_id);

    if (videosRepo.existsByUrl(vid.page_url, desktopId)) continue;

    const collectionId =
      typeof vid.collection_name === 'string' && vid.collection_name
        ? (nameToId.get(collectionKey(vid.collection_name, desktopId)) ?? null)
        : null;

    videosRepo.create({
      pageUrl: vid.page_url,
      title: (vid.title as string | undefined) ?? null,
      notes: (vid.notes as string | undefined) ?? null,
      collectionId,
      desktopId,
      fetchStatus: 'pending',
    });
    imported++;
  }

  saveDb();
  return { imported };
}

export interface ZipEntry {
  filePath: string;
  name: string;
}

// Downloaded videos that exist on disk, with collision-free archive names.
export async function listVideoZipEntries(): Promise<ZipEntry[]> {
  const rows = videosRepo.listDownloaded();

  // Deduplicate filenames: if two files share a basename, suffix with index
  const usedNames = new Map<string, number>();
  const entries: ZipEntry[] = [];

  for (const row of rows) {
    const ext = path.extname(row.local_path);
    const base = path.basename(row.local_path, ext);
    const title = sanitizeForFilename(row.title || base);

    const count = usedNames.get(`${title}${ext}`) ?? 0;
    usedNames.set(`${title}${ext}`, count + 1);
    entries.push({
      filePath: row.local_path,
      name: count === 0 ? `${title}${ext}` : `${title} (${count})${ext}`,
    });
  }

  // Keep only files that actually exist on disk
  const checks = await Promise.all(
    entries.map(entry => access(entry.filePath).then(() => entry, () => null)),
  );
  return checks.filter((e): e is ZipEntry => e !== null);
}
