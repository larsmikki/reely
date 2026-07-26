import { discoveryRepo } from '../db/repositories/discovery.js';
import { videosRepo } from '../db/repositories/videos.js';
import { extractVideoInfo, listRecentChannelUploads } from './extractor.service.js';
import type { DesktopId, DiscoveryRefreshResponse } from '../types/index.js';

const MAX_CREATORS_PER_REFRESH = 12;
const UPLOADS_PER_CREATOR = 12;
const BACKFILL_PER_REFRESH = 25;
const SCAN_CONCURRENCY = 3;

interface CreatorSummary {
  channelId: string;
  channelName: string;
  savedCount: number;
  sourceIds: Set<string>;
  latestPublishedMs: number | null;
  collections: Map<number, { name: string; count: number }>;
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function backfillCreatorMetadata(desktopId: DesktopId, errors: string[]): Promise<number> {
  const missing = videosRepo.listMissingCreatorMetadata(desktopId, BACKFILL_PER_REFRESH);
  let updated = 0;
  await mapConcurrent(missing, SCAN_CONCURRENCY, async video => {
    try {
      const info = await extractVideoInfo(video.page_url);
      videosRepo.update(video.id, {
        sourceId: info.source_id,
        channelId: info.channel_id,
        channelName: info.channel_name,
        publishedAt: info.published_at,
      });
      if (info.channel_id) updated++;
    } catch (err) {
      errors.push(`Metadata for ${video.page_url}: ${(err as Error).message}`);
    }
  });
  return updated;
}

function summarizeCreators(desktopId: DesktopId): CreatorSummary[] {
  const creators = new Map<string, CreatorSummary>();
  for (const source of videosRepo.listCreatorSources(desktopId)) {
    let creator = creators.get(source.channel_id);
    if (!creator) {
      creator = {
        channelId: source.channel_id,
        channelName: source.channel_name ?? source.channel_id,
        savedCount: 0,
        sourceIds: new Set(),
        latestPublishedMs: null,
        collections: new Map(),
      };
      creators.set(source.channel_id, creator);
    }
    creator.savedCount++;
    if (source.source_id) creator.sourceIds.add(source.source_id);
    if (source.published_at) {
      const ms = Date.parse(source.published_at);
      if (Number.isFinite(ms) && (creator.latestPublishedMs == null || ms > creator.latestPublishedMs)) {
        creator.latestPublishedMs = ms;
      }
    }
    if (source.collection_id != null && source.collection_name) {
      const current = creator.collections.get(source.collection_id);
      creator.collections.set(source.collection_id, {
        name: source.collection_name,
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  const scanTimes = discoveryRepo.channelScanTimes(desktopId);
  return [...creators.values()]
    .sort((a, b) => {
      const aScan = scanTimes.get(a.channelId);
      const bScan = scanTimes.get(b.channelId);
      if (!aScan && bScan) return -1;
      if (aScan && !bScan) return 1;
      if (aScan && bScan && aScan !== bScan) return aScan.localeCompare(bScan);
      return b.savedCount - a.savedCount;
    })
    .slice(0, MAX_CREATORS_PER_REFRESH);
}

export async function refreshDiscovery(desktopId: DesktopId): Promise<DiscoveryRefreshResponse> {
  const errors: string[] = [];
  const metadataBackfilled = await backfillCreatorMetadata(desktopId, errors);
  const creators = summarizeCreators(desktopId);
  const allLibrarySourceIds = new Set(
    videosRepo.listCreatorSources(desktopId).flatMap(v => v.source_id ? [v.source_id] : []),
  );
  let videosConsidered = 0;

  await mapConcurrent(creators, SCAN_CONCURRENCY, async creator => {
    try {
      const uploads = await listRecentChannelUploads(creator.channelId, UPLOADS_PER_CREATOR);
      const collection = [...creator.collections.entries()]
        .sort((a, b) => b[1].count - a[1].count)[0] ?? null;
      const collectionId = collection?.[0] ?? null;
      const collectionName = collection?.[1].name ?? null;
      const reason = collectionName
        ? `New from ${creator.channelName}, based on ${creator.savedCount} saved in ${collectionName}`
        : `New from ${creator.channelName}, based on ${creator.savedCount} saved video${creator.savedCount === 1 ? '' : 's'}`;

      for (const upload of uploads) {
        videosConsidered++;
        if (allLibrarySourceIds.has(upload.source_id) || creator.sourceIds.has(upload.source_id)) continue;
        const publishedMs = upload.published_at ? Date.parse(upload.published_at) : null;
        if (
          creator.latestPublishedMs != null &&
          publishedMs != null &&
          Number.isFinite(publishedMs) &&
          publishedMs <= creator.latestPublishedMs
        ) continue;

        discoveryRepo.upsert({
          desktopId,
          sourceId: upload.source_id,
          pageUrl: upload.page_url,
          title: upload.title,
          description: upload.description,
          duration: upload.duration,
          thumbnailUrl: upload.thumbnail_url,
          channelId: upload.channel_id,
          channelName: upload.channel_name,
          publishedAt: upload.published_at,
          collectionId,
          reason,
        });
      }
      discoveryRepo.markChannelScanned(desktopId, creator.channelId);
    } catch (err) {
      errors.push(`${creator.channelName}: ${(err as Error).message}`);
    }
  });

  return {
    items: discoveryRepo.list(desktopId),
    creators_scanned: creators.length,
    videos_considered: videosConsidered,
    metadata_backfilled: metadataBackfilled,
    errors,
  };
}
