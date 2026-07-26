import { getDb, markDirty } from '../connection.js';
import { allRows, firstRow } from './rows.js';
import type { DesktopId, DiscoverySuggestion } from '../../types/index.js';

export interface DiscoverySuggestionInput {
  desktopId: DesktopId;
  sourceId: string;
  pageUrl: string;
  title: string;
  description: string | null;
  duration: number | null;
  thumbnailUrl: string | null;
  channelId: string;
  channelName: string;
  publishedAt: string | null;
  collectionId: number | null;
  reason: string;
}

const SELECT_WITH_COLLECTION = `
  SELECT s.*, c.name AS collection_name
  FROM discovery_suggestions s
  LEFT JOIN collections c ON c.id = s.collection_id`;

export const discoveryRepo = {
  channelScanTimes(desktopId: DesktopId): Map<string, string> {
    const rows = allRows<{ channel_id: string; scanned_at: string }>(
      getDb().exec(
        `SELECT channel_id, scanned_at FROM discovery_channel_scans WHERE desktop_id = $d`,
        { $d: desktopId },
      ),
    );
    return new Map(rows.map(row => [row.channel_id, row.scanned_at]));
  },

  markChannelScanned(desktopId: DesktopId, channelId: string): void {
    getDb().run(
      `INSERT INTO discovery_channel_scans (desktop_id, channel_id, scanned_at)
       VALUES ($d, $channel, datetime('now'))
       ON CONFLICT(desktop_id, channel_id) DO UPDATE SET scanned_at = datetime('now')`,
      { $d: desktopId, $channel: channelId },
    );
    markDirty();
  },

  list(desktopId: DesktopId): DiscoverySuggestion[] {
    return allRows<DiscoverySuggestion>(
      getDb().exec(
        `${SELECT_WITH_COLLECTION}
         WHERE s.desktop_id = $d AND s.status = 'suggested'
           AND NOT EXISTS (
             SELECT 1 FROM videos v
             WHERE v.desktop_id = s.desktop_id
               AND (v.source_id = s.source_id OR v.page_url = s.page_url)
           )
         ORDER BY s.published_at DESC NULLS LAST, s.discovered_at DESC`,
        { $d: desktopId },
      ),
    );
  },

  findById(id: number): DiscoverySuggestion | null {
    return firstRow<DiscoverySuggestion>(
      getDb().exec(`${SELECT_WITH_COLLECTION} WHERE s.id = $id`, { $id: id }),
    );
  },

  upsert(input: DiscoverySuggestionInput): void {
    getDb().run(
      `INSERT INTO discovery_suggestions (
         desktop_id, source_id, page_url, title, description, duration, thumbnail_url,
         channel_id, channel_name, published_at, collection_id, reason
       ) VALUES ($d, $sid, $url, $title, $description, $duration, $thumb,
                 $cid, $cname, $published, $collection, $reason)
       ON CONFLICT(desktop_id, source_id) DO UPDATE SET
         page_url = excluded.page_url,
         title = excluded.title,
         description = excluded.description,
         duration = excluded.duration,
         thumbnail_url = excluded.thumbnail_url,
         channel_id = excluded.channel_id,
         channel_name = excluded.channel_name,
         published_at = excluded.published_at,
         collection_id = excluded.collection_id,
         reason = excluded.reason,
         updated_at = datetime('now')`,
      {
        $d: input.desktopId,
        $sid: input.sourceId,
        $url: input.pageUrl,
        $title: input.title,
        $description: input.description,
        $duration: input.duration,
        $thumb: input.thumbnailUrl,
        $cid: input.channelId,
        $cname: input.channelName,
        $published: input.publishedAt,
        $collection: input.collectionId,
        $reason: input.reason,
      },
    );
    markDirty();
  },

  setStatus(id: number, status: 'dismissed' | 'added'): boolean {
    const existing = this.findById(id);
    if (!existing) return false;
    getDb().run(
      `UPDATE discovery_suggestions
       SET status = $status, updated_at = datetime('now') WHERE id = $id`,
      { $status: status, $id: id },
    );
    markDirty();
    return true;
  },
};
