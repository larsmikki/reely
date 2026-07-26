import { Router, Request, Response } from 'express';
import { writeFile, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { settingsRepo } from '../db/repositories/settings.js';
import { importSidecars } from '../utils/sidecar.js';
import {
  regenerateAllSidecars,
  renameFilesToTitles,
  enqueueThumbnailRefresh,
} from '../services/maintenance.service.js';
import { config } from '../config.js';

const router = Router();

// Settings that may be written via the API. Anything else is rejected so a
// typo'd or stale client can't litter the settings table.
const ALLOWED_SETTINGS = new Set([
  'download_path',
  'ffmpeg_path',
  'youtube_cookies_mode',
  'youtube_cookies_browser',
  'desk_1_name',
  'desk_2_name',
]);

router.get('/', (_req: Request, res: Response) => {
  const all = settingsRepo.getAll();
  if (all['desk2_pin_hash']) all['desk2_pin_set'] = '1';
  delete all['desk2_pin_hash'];
  res.json(all);
});

router.patch('/', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Body must be a key-value object' });
    return;
  }
  const invalid = Object.entries(body)
    .filter(([k, v]) => !ALLOWED_SETTINGS.has(k) || typeof v !== 'string')
    .map(([k]) => k);
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown or non-string setting(s): ${invalid.join(', ')}` });
    return;
  }
  settingsRepo.setMany(body as Record<string, string>);
  res.json({ status: 'ok' });
});

// First existing APK from the configured locations (data dir beats bundled).
async function findAndroidApk(): Promise<{ path: string; size: number; mtime: Date } | null> {
  for (const p of config.androidApkFiles) {
    try {
      const info = await stat(p);
      return { path: p, size: info.size, mtime: info.mtime };
    } catch { /* try next location */ }
  }
  return null;
}

// GET /api/settings/android-app — whether a built APK is available to download
router.get('/android-app', async (_req: Request, res: Response) => {
  const apk = await findAndroidApk();
  if (apk) {
    res.json({ present: true, size: apk.size, updatedAt: apk.mtime.toISOString() });
  } else {
    res.json({ present: false, size: 0, updatedAt: null });
  }
});

// GET /api/settings/android-app/download — the sideloadable APK itself,
// baked into the image by build-android-client-app.bat + docker build.
router.get('/android-app/download', async (_req: Request, res: Response) => {
  const apk = await findAndroidApk();
  if (!apk) {
    res.status(404).json({ error: 'No APK available — run build-android-client-app.bat first' });
    return;
  }
  res.download(apk.path, 'play-client.apk', err => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to send APK' });
    }
  });
});

// GET /api/settings/cookies — whether an uploaded cookies.txt is present
router.get('/cookies', async (_req: Request, res: Response) => {
  try {
    const info = await stat(config.cookiesFile);
    res.json({ present: true, size: info.size, updatedAt: info.mtime.toISOString() });
  } catch {
    res.json({ present: false, size: 0, updatedAt: null });
  }
});

// POST /api/settings/cookies — store an uploaded cookies.txt and switch to file mode
router.post('/cookies', async (req: Request, res: Response) => {
  const { content } = (req.body ?? {}) as { content?: string };
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content (cookies.txt text) is required' });
    return;
  }
  // Netscape cookie jars start with this header line; warn but don't hard-fail,
  // since some exporters omit it.
  const looksValid = /# (Netscape )?HTTP Cookie File/i.test(content) || /\t/.test(content);
  await writeFile(config.cookiesFile, content, 'utf8');
  settingsRepo.set('youtube_cookies_mode', 'file');
  res.json({ status: 'ok', looksValid });
});

// DELETE /api/settings/cookies — remove the uploaded file
router.delete('/cookies', async (_req: Request, res: Response) => {
  await unlink(config.cookiesFile).catch(err => {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  });
  res.json({ status: 'ok' });
});

router.post('/regenerate-sidecars', async (_req: Request, res: Response) => {
  res.json(await regenerateAllSidecars());
});

router.post('/import-sidecars', async (_req: Request, res: Response) => {
  try {
    const result = await importSidecars();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/rename-to-titles', async (_req: Request, res: Response) => {
  res.json(await renameFilesToTitles());
});

// POST /api/settings/desk2-pin — set PIN (hash stored, raw value never persisted)
router.post('/desk2-pin', (req: Request, res: Response) => {
  const { pin } = req.body as { pin?: string };
  if (typeof pin !== 'string' || !pin.trim()) {
    res.status(400).json({ error: 'pin is required' });
    return;
  }
  const existing = settingsRepo.getMany(['desk2_pin_hash'])['desk2_pin_hash'] ?? '';
  if (existing) {
    res.status(409).json({ error: 'A PIN is already set; remove it first' });
    return;
  }
  settingsRepo.set('desk2_pin_hash', createHash('sha256').update(pin).digest('hex'));
  res.json({ ok: true });
});

// DELETE /api/settings/desk2-pin — remove PIN (requires current PIN)
router.delete('/desk2-pin', (req: Request, res: Response) => {
  const { currentPin } = req.body as { currentPin?: string };
  if (typeof currentPin !== 'string' || !currentPin.trim()) {
    res.status(400).json({ error: 'currentPin is required' });
    return;
  }
  const pinHash = settingsRepo.getMany(['desk2_pin_hash'])['desk2_pin_hash'] ?? '';
  if (!pinHash) { res.json({ ok: true }); return; }
  if (createHash('sha256').update(currentPin).digest('hex') !== pinHash) {
    res.status(401).json({ error: 'Wrong PIN' });
    return;
  }
  settingsRepo.set('desk2_pin_hash', '');
  res.json({ ok: true });
});

// Enqueue a fetch_thumbnail job for every video that has a page URL but no
// thumbnail. Pass ?all=1 to re-fetch for every video regardless.
router.post('/refresh-thumbnails', (req: Request, res: Response) => {
  const all = req.query.all === '1' || req.query.all === 'true';
  res.json(enqueueThumbnailRefresh(all));
});

export default router;
