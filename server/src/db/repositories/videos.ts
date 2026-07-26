import type { BindParams } from 'sql.js';
import { getDb, markDirty } from '../connection.js';
import { firstRow, allRows, scalar } from './rows.js';
import type { DesktopId, FetchStatus, Video } from '../../types/index.js';

export type VideoSort = 'newest' | 'oldest' | 'title' | 'duration' | 'site';

const SORT_ORDER: Record<VideoSort, string> = {
  newest: 'added_at DESC',
  oldest: 'added_at ASC',
  title: "COALESCE(title,'') ASC",
  duration: 'duration DESC NULLS LAST',
  site: "COALESCE(site,'') ASC",
};

export interface VideoListFilter {
  desktopId: DesktopId;
  collectionId?: number | 'null';
  q?: string;
  page: number;
  limit: number;
  sort?: VideoSort;
}

export interface VideoCreate {
  pageUrl: string;
  collectionId: number | null;
  notes: string | null;
  desktopId: DesktopId;
  title?: string | null;
  fetchStatus?: FetchStatus;
}

export interface VideoPatch {
  pageUrl?: string;
  title?: string | null;
  description?: string | null;
  duration?: number | null;
  thumbnailUrl?: string | null;
  site?: string | null;
  notes?: string | null;
  collectionId?: number | null;
  localPath?: string | null;
  fetchStatus?: FetchStatus;
  fetchError?: string | null;
  resetMetadata?: boolean;
  sourceId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  publishedAt?: string | null;
}

const COL_MAP: Record<keyof Omit<VideoPatch, 'resetMetadata'>, string> = {
  pageUrl: 'page_url',
  title: 'title',
  description: 'description',
  duration: 'duration',
  thumbnailUrl: 'thumbnail_url',
  site: 'site',
  notes: 'notes',
  collectionId: 'collection_id',
  localPath: 'local_path',
  fetchStatus: 'fetch_status',
  fetchError: 'fetch_error',
  sourceId: 'source_id',
  channelId: 'channel_id',
  channelName: 'channel_name',
  publishedAt: 'published_at',
};

export const videosRepo = {
  hasPendingAny(desktopId: DesktopId): boolean {
    return (scalar<number>(
      getDb().exec(
        `SELECT COUNT(*) FROM videos WHERE desktop_id = $d AND fetch_status IN ('pending', 'running')`,
        { $d: desktopId },
      ),
    ) ?? 0) > 0;
  },

  list(filter: VideoListFilter): { items: Video[]; total: number } {
    const db = getDb();
    const conditions = ['desktop_id = $desktop_id'];
    const params: BindParams = { $desktop_id: filter.desktopId };

    if (filter.collectionId !== undefined) {
      if (filter.collectionId === 'null') {
        conditions.push('collection_id IS NULL');
      } else {
        conditions.push('collection_id = $collection_id');
        params.$collection_id = filter.collectionId;
      }
    }
    if (filter.q) {
      conditions.push('(title LIKE $q OR notes LIKE $q OR page_url LIKE $q)');
      params.$q = `%${filter.q}%`;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const total = scalar<number>(db.exec(`SELECT COUNT(*) FROM videos ${where}`, params)) ?? 0;

    const offset = (filter.page - 1) * filter.limit;
    const order = SORT_ORDER[filter.sort ?? 'newest'];
    const items = allRows<Video>(
      db.exec(
        `SELECT * FROM videos ${where} ORDER BY ${order} LIMIT $limit OFFSET $offset`,
        { ...params, $limit: filter.limit, $offset: offset },
      ),
    );
    return { items, total };
  },

  findById(id: number): Video | null {
    return firstRow<Video>(getDb().exec('SELECT * FROM videos WHERE id = $id', { $id: id }));
  },

  existsByUrl(pageUrl: string, desktopId: DesktopId): boolean {
    return !!firstRow(
      getDb().exec('SELECT id FROM videos WHERE page_url = $url AND desktop_id = $d', {
        $url: pageUrl,
        $d: desktopId,
      }),
    );
  },

  create(input: VideoCreate): Video {
    const db = getDb();
    db.run(
      `INSERT INTO videos (page_url, title, collection_id, notes, fetch_status, desktop_id)
       VALUES ($url, $title, $cid, $notes, $status, $d)`,
      {
        $url: input.pageUrl,
        $title: input.title ?? null,
        $cid: input.collectionId,
        $notes: input.notes,
        $status: input.fetchStatus ?? 'pending',
        $d: input.desktopId,
      },
    );
    const id = scalar<number>(db.exec('SELECT last_insert_rowid()'))!;
    markDirty();
    return this.findById(id)!;
  },

  update(id: number, patch: VideoPatch): Video | null {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) return null;

    const updates: string[] = ["updated_at = datetime('now')"];
    const params: BindParams = { $id: id };

    if (patch.resetMetadata) {
      updates.push(
        "fetch_status = 'pending'",
        'fetch_error = NULL',
        'title = NULL',
        'description = NULL',
        'duration = NULL',
        'thumbnail_url = NULL',
        'site = NULL',
        'local_path = NULL',
        'source_id = NULL',
        'channel_id = NULL',
        'channel_name = NULL',
        'published_at = NULL',
      );
    }

    for (const [key, col] of Object.entries(COL_MAP) as Array<[keyof typeof COL_MAP, string]>) {
      const value = patch[key];
      if (value === undefined) continue;
      if (patch.resetMetadata && key !== 'pageUrl' && key !== 'collectionId' && key !== 'notes') continue;
      const placeholder = `$${col}`;
      updates.push(`${col} = ${placeholder}`);
      params[placeholder] = value as never;
    }

    db.run(`UPDATE videos SET ${updates.join(', ')} WHERE id = $id`, params);
    markDirty();
    return this.findById(id);
  },

  delete(id: number): boolean {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) return false;
    db.run('DELETE FROM videos WHERE id = $id', { $id: id });
    markDirty();
    return true;
  },

  // Reassign a video to another desktop, remapping its collection in the same
  // statement (collections are per-desktop).
  moveToDesktop(id: number, desktopId: DesktopId, collectionId: number | null): void {
    getDb().run(
      `UPDATE videos SET desktop_id = $d, collection_id = $cid, updated_at = datetime('now') WHERE id = $id`,
      { $d: desktopId, $cid: collectionId, $id: id },
    );
    markDirty();
  },

  countInCollection(collectionId: number): number {
    return scalar<number>(
      getDb().exec('SELECT COUNT(*) FROM videos WHERE collection_id = $cid', { $cid: collectionId }),
    ) ?? 0;
  },

  // Videos with a downloaded local file.
  listDownloaded(): Array<{ id: number; title: string | null; local_path: string }> {
    return allRows(
      getDb().exec(
        'SELECT id, title, local_path FROM videos WHERE local_path IS NOT NULL ORDER BY added_at',
      ),
    );
  },

  // Downloaded videos with a non-empty title — candidates for id → title renames.
  listRenameCandidates(): Array<{ id: number; local_path: string; title: string }> {
    return allRows(
      getDb().exec(
        `SELECT id, local_path, title FROM videos
         WHERE local_path IS NOT NULL AND title IS NOT NULL AND title != ''`,
      ),
    );
  },

  // Videos with a page URL; optionally only those missing a thumbnail.
  listWithPageUrl(missingThumbnailOnly: boolean): Array<{ id: number; page_url: string }> {
    const sql = missingThumbnailOnly
      ? `SELECT id, page_url FROM videos
         WHERE page_url IS NOT NULL AND page_url != '' AND (thumbnail_url IS NULL OR thumbnail_url = '')`
      : `SELECT id, page_url FROM videos WHERE page_url IS NOT NULL AND page_url != ''`;
    return allRows(getDb().exec(sql));
  },

  listMissingCreatorMetadata(desktopId: DesktopId, limit = 25): Array<{ id: number; page_url: string }> {
    return allRows(
      getDb().exec(
        `SELECT id, page_url FROM videos
         WHERE desktop_id = $d
           AND (site = 'youtube' OR site = 'youtu' OR page_url LIKE '%youtube.com/%' OR page_url LIKE '%youtu.be/%')
           AND (channel_id IS NULL OR channel_id = '')
         ORDER BY added_at DESC LIMIT $lim`,
        { $d: desktopId, $lim: limit },
      ),
    );
  },

  listCreatorSources(desktopId: DesktopId): Array<{
    source_id: string | null;
    channel_id: string;
    channel_name: string | null;
    published_at: string | null;
    collection_id: number | null;
    collection_name: string | null;
  }> {
    return allRows(
      getDb().exec(
        `SELECT v.source_id, v.channel_id, v.channel_name, v.published_at,
                v.collection_id, c.name AS collection_name
         FROM videos v
         LEFT JOIN collections c ON c.id = v.collection_id
         WHERE v.desktop_id = $d AND v.channel_id IS NOT NULL AND v.channel_id != ''`,
        { $d: desktopId },
      ),
    );
  },

  // All videos with their collection name, for the JSON backup export.
  exportAll(): Array<{
    title: string | null;
    page_url: string;
    notes: string | null;
    desktop_id: DesktopId;
    collection_name: string | null;
  }> {
    return allRows(
      getDb().exec(
        `SELECT v.title, v.page_url, v.notes, v.desktop_id, c.name AS collection_name
         FROM videos v
         LEFT JOIN collections c ON v.collection_id = c.id
         ORDER BY v.desktop_id, v.added_at`,
      ),
    );
  },
};
