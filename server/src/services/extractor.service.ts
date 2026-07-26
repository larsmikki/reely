import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { mkdtemp, readdir, rename, copyFile, unlink, rm } from 'fs/promises';
import { config } from '../config.js';
import { settingsRepo } from '../db/repositories/settings.js';
import { sanitizeForFilename } from '../utils/filenames.js';
import type { ExtractedInfo } from '../types/index.js';

const execFileAsync = promisify(execFile);

// --dump-json output for long videos can be large; downloads also stream
// progress text through stdout/stderr.
const DUMP_JSON_MAX_BUFFER = 10 * 1024 * 1024;
const DOWNLOAD_MAX_BUFFER = 50 * 1024 * 1024;

// Cookie auth args for yt-dlp, driven by the `youtube_cookies_mode` setting:
//   'file'    → --cookies <uploaded cookies.txt> (recommended; works in Docker)
//   'browser' → --cookies-from-browser <name>    (needs that browser on the host)
function cookieArgs(): string[] {
  const s = settingsRepo.getMany(['youtube_cookies_mode', 'youtube_cookies_browser']);
  const mode = s['youtube_cookies_mode'];
  if (mode === 'browser') {
    const browser = s['youtube_cookies_browser']?.trim();
    return browser ? ['--cookies-from-browser', browser] : [];
  }
  if (mode === 'file' && existsSync(config.cookiesFile)) {
    return ['--cookies', config.cookiesFile];
  }
  return [];
}

interface YtDlpFormat {
  ext: string;
  height?: number;
  url: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
}

interface YtDlpOutput {
  id?: string;
  title?: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url: string; preference?: number }>;
  formats?: YtDlpFormat[];
  url?: string;
  ext?: string;
  protocol?: string;
  channel_id?: string;
  channel?: string;
  uploader?: string;
  timestamp?: number;
  release_timestamp?: number;
  upload_date?: string;
  webpage_url?: string;
  entries?: YtDlpOutput[];
}

export interface ChannelUpload {
  source_id: string;
  page_url: string;
  title: string;
  description: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  channel_id: string;
  channel_name: string;
  published_at: string | null;
}

function normalizePublishedAt(output: YtDlpOutput): string | null {
  const timestamp = output.release_timestamp ?? output.timestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return new Date(timestamp * 1000).toISOString();
  }
  const date = output.upload_date;
  if (date && /^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`;
  }
  return null;
}

function extractSite(pageUrl: string): string | null {
  try {
    const hostname = new URL(pageUrl).hostname;
    // Strip www. prefix
    const parts = hostname.replace(/^www\./, '').split('.');
    // Return second-to-last part (e.g. "xhamster" from "xhamster.com")
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  } catch {
    return null;
  }
}

function isDirectPlayable(f: YtDlpFormat): boolean {
  const notHlsDash = f.protocol !== 'm3u8' && f.protocol !== 'm3u8_native' && f.protocol !== 'dash';
  const hasVideo = f.vcodec !== 'none' && f.vcodec !== undefined;
  const hasAudio = f.acodec !== 'none';
  return notHlsDash && !!f.url && hasVideo && hasAudio;
}

// Prefer H.264 (avc) for broadest browser compatibility, then highest resolution.
function bestByCompatibility(formats: YtDlpFormat[]): YtDlpFormat | null {
  if (formats.length === 0) return null;
  const h264 = formats.filter(f => !f.vcodec || f.vcodec.startsWith('avc'));
  const candidates = h264.length > 0 ? h264 : formats;
  return [...candidates].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
}

function pickBestStreamUrl(output: YtDlpOutput): string | null {
  const formats = output.formats ?? [];
  // Strict pass: direct https/http MP4 with both streams; loose pass: any
  // direct playable format; last resort: yt-dlp's top-level url.
  const strict = formats.filter(f =>
    f.ext === 'mp4' &&
    (f.protocol === 'https' || f.protocol === 'http' || !f.protocol) &&
    isDirectPlayable(f),
  );
  const best = bestByCompatibility(strict) ?? bestByCompatibility(formats.filter(isDirectPlayable));
  return best?.url ?? output.url ?? null;
}

function pickBestThumbnail(output: YtDlpOutput): string | null {
  if (output.thumbnail) return output.thumbnail;
  if (output.thumbnails && output.thumbnails.length > 0) {
    // Sort by preference descending if available
    const sorted = [...output.thumbnails].sort(
      (a, b) => (b.preference ?? 0) - (a.preference ?? 0),
    );
    return sorted[0].url ?? null;
  }
  return null;
}

export async function extractVideoInfo(pageUrl: string): Promise<ExtractedInfo & { site: string | null }> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      config.ytdlpPath,
      [...cookieArgs(), '--dump-json', '--no-playlist', pageUrl],
      { maxBuffer: DUMP_JSON_MAX_BUFFER },
    );
    stdout = result.stdout;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { stderr?: string; code?: string | number };
    if (error.code === 'ENOENT') {
      throw new Error('yt-dlp is not installed or not found in PATH');
    }
    const stderr = error.stderr ?? '';
    throw new Error(`yt-dlp failed: ${stderr || error.message}`);
  }

  let parsed: YtDlpOutput;
  try {
    parsed = JSON.parse(stdout) as YtDlpOutput;
  } catch {
    throw new Error('Failed to parse yt-dlp JSON output');
  }

  const description = parsed.description
    ? parsed.description.slice(0, 500)
    : null;

  return {
    title: parsed.title ?? null,
    description,
    duration: typeof parsed.duration === 'number' ? Math.round(parsed.duration) : null,
    thumbnail_url: pickBestThumbnail(parsed),
    stream_url: pickBestStreamUrl(parsed),
    site: extractSite(pageUrl),
    source_id: parsed.id ?? null,
    channel_id: parsed.channel_id ?? null,
    channel_name: parsed.channel ?? parsed.uploader ?? null,
    published_at: normalizePublishedAt(parsed),
  };
}

export async function listRecentChannelUploads(channelId: string, limit = 12): Promise<ChannelUpload[]> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      config.ytdlpPath,
      [
        ...cookieArgs(),
        '--flat-playlist',
        '--dump-single-json',
        '--no-warnings',
        '--playlist-end', String(limit),
        `https://www.youtube.com/channel/${channelId}/videos`,
      ],
      { maxBuffer: DUMP_JSON_MAX_BUFFER, timeout: 60_000 },
    );
    stdout = result.stdout;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { stderr?: string };
    if (error.code === 'ENOENT') throw new Error('yt-dlp is not installed or not found in PATH');
    throw new Error(`Could not scan channel ${channelId}: ${error.stderr || error.message}`);
  }

  const parsed = JSON.parse(stdout) as YtDlpOutput;
  const fallbackName = parsed.channel ?? parsed.uploader ?? channelId;
  return (parsed.entries ?? []).flatMap(entry => {
    if (!entry.id || !entry.title) return [];
    return [{
      source_id: entry.id,
      page_url: entry.webpage_url ?? `https://www.youtube.com/watch?v=${entry.id}`,
      title: entry.title,
      description: entry.description?.slice(0, 500) ?? null,
      duration: typeof entry.duration === 'number' ? Math.round(entry.duration) : null,
      thumbnail_url: pickBestThumbnail(entry),
      channel_id: entry.channel_id ?? channelId,
      channel_name: entry.channel ?? entry.uploader ?? fallbackName,
      published_at: normalizePublishedAt(entry),
    }];
  });
}

export async function getStreamUrl(pageUrl: string): Promise<string> {
  const info = await extractVideoInfo(pageUrl);
  if (!info.stream_url) {
    throw new Error('Could not extract a playable stream URL');
  }
  return info.stream_url;
}

// Marker for --progress-template so progress lines are unambiguous on stdout.
const PROGRESS_PREFIX = 'download-progress:';
const PROGRESS_LINE = new RegExp(`^${PROGRESS_PREFIX}\\s*([\\d.]+)%`);

// Spawn yt-dlp and stream its stdout, reporting download progress (0..1) for
// each phase yt-dlp prints (a merged download reports video then audio).
function runYtDlpWithProgress(
  args: string[],
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.ytdlpPath,
      ['--newline', '--progress-template', `download:${PROGRESS_PREFIX}%(progress._percent_str)s`, ...args],
      { windowsHide: true },
    );
    let stderrTail = '';
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const match = PROGRESS_LINE.exec(line);
        if (match && onProgress) {
          const pct = Number(match[1]);
          if (Number.isFinite(pct)) onProgress(Math.min(1, Math.max(0, pct / 100)));
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') reject(new Error('yt-dlp is not installed or not found in PATH'));
      else reject(err);
    });
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderrTail.trim() || `yt-dlp exited with code ${code}`));
    });
  });
}

// Filename stem of a media file or its sidecar ("Title.mp4.json" → "Title").
function mediaStem(filename: string): string {
  const base = filename.endsWith('.json') ? filename.slice(0, -'.json'.length) : filename;
  return path.parse(base).name;
}

export async function downloadToPath(
  videoId: number,
  pageUrl: string,
  outputDir: string,
  ffmpegPath: string,
  title?: string | null,
  currentLocalPath?: string | null,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const sanitized = title ? sanitizeForFilename(title) : '';
  let stem = sanitized || String(videoId);

  // Avoid clobbering another video that already uses this stem (same title).
  // Re-downloading this video's own file keeps its stem so it overwrites.
  const ownStem = currentLocalPath ? mediaStem(path.basename(currentLocalPath)) : null;
  if (stem !== ownStem) {
    const existing = await readdir(outputDir).catch(() => [] as string[]);
    if (existing.some(f => mediaStem(f) === stem)) {
      stem = `${stem} [${videoId}]`;
    }
  }

  const outputTemplate = path.join(outputDir, `${stem}.%(ext)s`);
  try {
    await runYtDlpWithProgress(
      [
        ...cookieArgs(),
        '--ffmpeg-location', ffmpegPath,
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '-o', outputTemplate,
        pageUrl,
      ],
      onProgress,
    );
  } catch (err: unknown) {
    const error = err as Error;
    if (error.message.includes('not found in PATH')) throw error;
    throw new Error(`yt-dlp download failed: ${error.message}`);
  }
  const files = await readdir(outputDir);
  const match = files.find(
    f => !f.endsWith('.json') && !f.endsWith('.part') && mediaStem(f) === stem,
  );
  if (!match) throw new Error('Downloaded file not found after yt-dlp completed');
  return path.join(outputDir, match);
}

export async function downloadMp3ToPath(pageUrl: string, outputDir: string, ffmpegPath: string): Promise<void> {
  // Download and convert in a local temp dir to avoid hammering a network share
  // during ffmpeg conversion, then move the finished file in one shot.
  const tempDir = await mkdtemp(path.join(tmpdir(), 'mp3-'));
  const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');
  const args = [
    ...cookieArgs(),
    '--ffmpeg-location', ffmpegPath,
    '--no-keep-video',
    '--windows-filenames',
    '--audio-quality', '0',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--output', outputTemplate,
    '--no-playlist',
    pageUrl,
  ];
  try {
    await execFileAsync(config.ytdlpPath, args, { maxBuffer: DOWNLOAD_MAX_BUFFER });

    const files = await readdir(tempDir);
    if (files.length === 0) {
      throw new Error('yt-dlp completed but produced no MP3 file');
    }

    await Promise.all(files.map(async file => {
      const src = path.join(tempDir, file);
      const dst = path.join(outputDir, file);
      try {
        await rename(src, dst);
      } catch (e) {
        // Cross-device move (temp dir and output on different volumes)
        if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
          await copyFile(src, dst);
          await unlink(src);
        } else {
          throw e;
        }
      }
    }));
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { stderr?: string };
    if (error.code === 'ENOENT') throw new Error('yt-dlp is not installed or not found in PATH');
    throw new Error(`yt-dlp MP3 download failed: ${error.stderr || (error as Error).message}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
