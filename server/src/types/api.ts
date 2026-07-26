// Types shared between server and client. This file must stay free of Node
// imports — the client re-exports from it type-only (see client/src/types.ts).

export type DesktopId = 1 | 2;

export type FetchStatus = 'pending' | 'ok' | 'error';

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  video_count: number;
  created_at: string;
}

export interface Video {
  id: number;
  collection_id: number | null;
  page_url: string;
  title: string | null;
  description: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  site: string | null;
  added_at: string;
  updated_at: string;
  fetch_status: FetchStatus;
  fetch_error: string | null;
  notes: string | null;
  local_path: string | null;
  desktop_id: DesktopId;
  source_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  published_at: string | null;
}

export type DiscoveryStatus = 'suggested' | 'dismissed' | 'added';

export interface DiscoverySuggestion {
  id: number;
  desktop_id: DesktopId;
  source_id: string;
  page_url: string;
  title: string;
  description: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  channel_id: string;
  channel_name: string;
  published_at: string | null;
  collection_id: number | null;
  collection_name: string | null;
  reason: string;
  status: DiscoveryStatus;
  discovered_at: string;
  updated_at: string;
}

export interface DiscoveryRefreshResponse {
  items: DiscoverySuggestion[];
  creators_scanned: number;
  videos_considered: number;
  metadata_backfilled: number;
  errors: string[];
}

export type JobKind =
  | 'extract_metadata'
  | 'download_video'
  | 'download_mp3'
  | 'copy_to_output'
  | 'fetch_thumbnail';

export type JobStatus = 'pending' | 'running' | 'ok' | 'error' | 'cancelled' | 'ignored';

export interface Job {
  id: number;
  video_id: number | null;
  kind: JobKind;
  payload: string | null;
  status: JobStatus;
  progress: number;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
  hasPendingAny: boolean;
}

export interface CollectionsResponse {
  items: Collection[];
  totalVideoCount: number;
  uncategorizedCount: number;
}

export interface CastDevice {
  id: string;
  name: string;
  manufacturer: string | null;
  modelName: string | null;
  host: string;
  location: string;
}

export interface CastDevicesResponse {
  items: CastDevice[];
}
