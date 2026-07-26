ALTER TABLE videos ADD COLUMN source_id TEXT;
ALTER TABLE videos ADD COLUMN channel_id TEXT;
ALTER TABLE videos ADD COLUMN channel_name TEXT;
ALTER TABLE videos ADD COLUMN published_at TEXT;

CREATE INDEX idx_videos_channel ON videos(desktop_id, channel_id);
CREATE INDEX idx_videos_source ON videos(desktop_id, source_id);

CREATE TABLE IF NOT EXISTS discovery_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desktop_id INTEGER NOT NULL DEFAULT 1,
  source_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration INTEGER,
  thumbnail_url TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  published_at TEXT,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(desktop_id, source_id)
);

CREATE INDEX idx_discovery_status ON discovery_suggestions(desktop_id, status, published_at DESC);

CREATE TABLE IF NOT EXISTS discovery_channel_scans (
  desktop_id INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(desktop_id, channel_id)
);
