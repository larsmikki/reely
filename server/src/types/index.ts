export type {
  DesktopId,
  FetchStatus,
  Collection,
  Video,
  JobKind,
  JobStatus,
  Job,
  PaginatedResponse,
  CollectionsResponse,
  DiscoveryStatus,
  DiscoverySuggestion,
  DiscoveryRefreshResponse,
} from './api.js';

export interface ExtractedInfo {
  title: string | null;
  description: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  stream_url: string | null;
  source_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  published_at: string | null;
}
