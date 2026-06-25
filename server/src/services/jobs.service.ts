import { EventEmitter } from 'node:events';
import { copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { jobsRepo, parseJobPayload, setPendingJobListener, type Job, type JobKind } from '../db/repositories/jobs.js';
import { videosRepo } from '../db/repositories/videos.js';
import { settingsRepo } from '../db/repositories/settings.js';
import { config } from '../config.js';
import { errorMessage, isRecoverableDbError, reloadDb } from '../db/connection.js';
import { extractVideoInfo, downloadToPath, downloadMp3ToPath } from './extractor.service.js';
import { sanitizeForFilename } from '../utils/filenames.js';
import { writeSidecarForVideo } from '../utils/sidecar.js';

// How long the worker sleeps when the queue is empty. New pending jobs wake it
// immediately (see setPendingJobListener), so this is only a safety heartbeat.
const IDLE_HEARTBEAT_MS = 2000;
// Pause after a crashed step so a persistent failure can't spin the loop.
const ERROR_BACKOFF_MS = 1000;

export interface JobEvent {
  job: Job;
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function onJobChange(listener: (event: JobEvent) => void): () => void {
  bus.on('change', listener);
  return () => bus.off('change', listener);
}

function emit(jobId: number): void {
  const job = jobsRepo.findById(jobId);
  if (job) bus.emit('change', { job });
}

function outputFilename(localPath: string, title: string | null | undefined): string {
  const sanitized = title ? sanitizeForFilename(title) : '';
  return sanitized ? `${sanitized}${path.extname(localPath)}` : path.basename(localPath);
}

async function runExtractMetadata(job: Job): Promise<void> {
  const videoId = job.video_id!;
  const payload = parseJobPayload(job, 'extract_metadata');
  if (!payload.url) throw new Error('extract_metadata job has no url in payload');

  jobsRepo.setProgress(job.id, 0.1);
  emit(job.id);

  const info = await extractVideoInfo(payload.url);

  videosRepo.update(videoId, {
    title: info.title,
    description: info.description,
    duration: info.duration,
    thumbnailUrl: info.thumbnail_url,
    site: info.site,
    fetchStatus: 'ok',
    fetchError: null,
  });

  jobsRepo.setProgress(job.id, 1);
  jobsRepo.markComplete(job.id);
  emit(job.id);

  // Chain a download job
  jobsRepo.enqueue({
    videoId,
    kind: 'download_video',
    payload: { url: payload.url, outputMp4: payload.outputMp4, downloadMp3: payload.downloadMp3, title: info.title },
  });

  if (payload.downloadMp3) {
    jobsRepo.enqueue({
      videoId,
      kind: 'download_mp3',
      payload: { url: payload.url },
    });
  }
}

async function runDownloadVideo(job: Job): Promise<void> {
  const videoId = job.video_id!;
  const payload = parseJobPayload(job, 'download_video');
  if (!payload.url) throw new Error('download_video job has no url in payload');

  jobsRepo.setProgress(job.id, 0.01);
  emit(job.id);

  const settings = settingsRepo.getMany(['download_path', 'ffmpeg_path']);
  const ffmpegPath = settings['ffmpeg_path'] || config.ffmpegPath;
  const currentLocalPath = videosRepo.findById(videoId)?.local_path;

  // yt-dlp reports each download phase 0→100% (a merged format downloads video
  // then audio); keep the bar monotonic and only persist meaningful steps.
  let lastReported = 0.01;
  const onProgress = (fraction: number) => {
    const next = Math.min(0.99, fraction);
    if (next - lastReported < 0.01) return;
    lastReported = next;
    jobsRepo.setProgress(job.id, next);
    emit(job.id);
  };

  const localPath = await downloadToPath(
    videoId, payload.url, config.videosDir, ffmpegPath, payload.title, currentLocalPath, onProgress,
  );

  videosRepo.update(videoId, { localPath });
  await writeSidecarForVideo(videoId);
  jobsRepo.setProgress(job.id, 1);
  jobsRepo.markComplete(job.id);
  emit(job.id);

  if (payload.outputMp4 && settings['download_path']) {
    jobsRepo.enqueue({
      videoId,
      kind: 'copy_to_output',
      payload: { localPath, title: payload.title ?? null, outputDir: settings['download_path'] },
    });
  }
}

async function runDownloadMp3(job: Job): Promise<void> {
  const payload = parseJobPayload(job, 'download_mp3');
  if (!payload.url) throw new Error('download_mp3 job has no url in payload');
  const settings = settingsRepo.getMany(['download_path', 'ffmpeg_path']);
  const outputPath = settings['download_path'];
  if (!outputPath) {
    throw new Error('download_path setting is not configured');
  }
  const ffmpegPath = settings['ffmpeg_path'] || config.ffmpegPath;

  jobsRepo.setProgress(job.id, 0.2);
  emit(job.id);

  await downloadMp3ToPath(payload.url, outputPath, ffmpegPath);

  jobsRepo.markComplete(job.id);
  emit(job.id);
}

async function runCopyToOutput(job: Job): Promise<void> {
  const payload = parseJobPayload(job, 'copy_to_output');
  if (!payload.localPath) throw new Error('copy_to_output job has no localPath in payload');

  // Jobs enqueued outside the download chain carry no outputDir; resolve it
  // from settings at run time.
  const outputDir = payload.outputDir || settingsRepo.getMany(['download_path'])['download_path'];
  if (!outputDir) throw new Error('download_path setting is not configured');

  const dest = path.join(outputDir, outputFilename(payload.localPath, payload.title));
  await copyFile(payload.localPath, dest);
  jobsRepo.markComplete(job.id);
  emit(job.id);
}

async function runFetchThumbnail(job: Job): Promise<void> {
  const videoId = job.video_id!;
  const payload = parseJobPayload(job, 'fetch_thumbnail');
  if (!payload.url) throw new Error('fetch_thumbnail job has no url in payload');

  jobsRepo.setProgress(job.id, 0.2);
  emit(job.id);

  const info = await extractVideoInfo(payload.url);
  const existing = videosRepo.findById(videoId);

  // Refresh metadata that's cheap to get from yt-dlp's --dump-json, but never
  // touch local_path / fetch_status — this job is for already-downloaded videos.
  videosRepo.update(videoId, {
    thumbnailUrl: info.thumbnail_url,
    title: existing?.title ?? info.title,
    description: existing?.description ?? info.description,
    duration: existing?.duration ?? info.duration,
    site: existing?.site ?? info.site,
  });
  await unlink(path.join(config.thumbsDir, `${videoId}.jpg`)).catch(() => {});
  await writeSidecarForVideo(videoId);

  jobsRepo.setProgress(job.id, 1);
  jobsRepo.markComplete(job.id);
  emit(job.id);
}

const HANDLERS: Record<JobKind, (job: Job) => Promise<void>> = {
  extract_metadata: runExtractMetadata,
  download_video: runDownloadVideo,
  download_mp3: runDownloadMp3,
  copy_to_output: runCopyToOutput,
  fetch_thumbnail: runFetchThumbnail,
};

let running = false;
let stopRequested = false;
let stepPromise: Promise<void> | null = null;
let wake: (() => void) | null = null;

function wakeWorker(): void {
  wake?.();
}

// Resolves when a new pending job is signalled or after timeoutMs, whichever
// comes first.
function waitForWork(timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, timeoutMs);
    wake = done;
    function done(): void {
      clearTimeout(timer);
      wake = null;
      resolve();
    }
  });
}

// Returns true when a job was claimed (so the loop should immediately try the
// next one), false when the queue was empty.
async function step(): Promise<boolean> {
  const job = jobsRepo.claimNext();
  if (!job) return false;
  emit(job.id);

  try {
    const handler = HANDLERS[job.kind];
    if (!handler) throw new Error(`unknown job kind: ${job.kind}`);
    await handler(job);
  } catch (err) {
    // A closed/poisoned DB handle surfaces here too; rethrow so the worker loop
    // can reload it instead of trying (and failing) to write the failure back.
    if (isRecoverableDbError(err)) throw err;
    const message = errorMessage(err);
    const fresh = jobsRepo.findById(job.id);
    const attempts = fresh?.attempts ?? job.attempts;
    const maxAttempts = fresh?.max_attempts ?? job.max_attempts;
    const retry = attempts < maxAttempts;
    jobsRepo.markFailed(job.id, message, retry);
    emit(job.id);

    if (!retry && job.video_id != null && job.kind === 'extract_metadata') {
      videosRepo.update(job.video_id, { fetchStatus: 'error', fetchError: message });
    }
  }
  return true;
}

async function loop(idleMs: number): Promise<void> {
  while (!stopRequested) {
    let claimed = false;
    try {
      claimed = await step();
    } catch (err) {
      console.error('[jobs] worker step crashed:', errorMessage(err));
      if (isRecoverableDbError(err)) {
        try {
          await reloadDb();
          console.warn('[jobs] recoverable DB error — handle reloaded from disk');
        } catch (recoverErr) {
          console.error('[jobs] DB reload failed:', errorMessage(recoverErr));
        }
      }
      await new Promise(resolve => setTimeout(resolve, ERROR_BACKOFF_MS));
      continue;
    }
    // Drain the queue back-to-back; only sleep once it's empty.
    if (!claimed && !stopRequested) await waitForWork(idleMs);
  }
  running = false;
}

export function startJobWorker(idleMs = IDLE_HEARTBEAT_MS): void {
  if (running) return;
  jobsRepo.resetRunningToPending();
  running = true;
  stopRequested = false;
  setPendingJobListener(wakeWorker);
  stepPromise = loop(idleMs);
}

export async function stopJobWorker(): Promise<void> {
  stopRequested = true;
  setPendingJobListener(null);
  wakeWorker();
  if (stepPromise) await stepPromise;
}

// Exposed for tests — drains the queue synchronously, one step at a time.
export async function drainJobsForTest(maxSteps = 100): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const pending = jobsRepo.listActive().find(j => j.status === 'pending');
    if (!pending) return;
    await step();
  }
}
