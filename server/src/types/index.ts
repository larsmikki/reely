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
} from './api.js';

export interface ExtractedInfo {
  title: string | null;
  description: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  stream_url: string | null;
}
