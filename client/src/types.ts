// API types are defined once on the server and re-exported here type-only,
// so client and server can't drift. The import is erased at build time.
export type {
  DesktopId,
  FetchStatus,
  Collection,
  Video,
  Job,
  JobKind,
  JobStatus,
  PaginatedResponse,
  CollectionsResponse,
} from '../../server/src/types/api'
