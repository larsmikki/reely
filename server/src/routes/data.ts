import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import {
  exportBackup,
  importBackup,
  isValidBackup,
  listVideoZipEntries,
} from '../services/backup.service.js';

const router = Router();

// GET /api/data/export
router.get('/export', (_req: Request, res: Response) => {
  res.setHeader('Content-Disposition', 'attachment; filename="play-backup.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(exportBackup());
});

// POST /api/data/import
router.post('/import', (req: Request, res: Response) => {
  if (!isValidBackup(req.body)) {
    res.status(400).json({ error: 'Invalid backup file' });
    return;
  }
  const { imported } = importBackup(req.body);
  res.json({ status: 'ok', imported });
});

// GET /api/data/videos.zip — stream all downloaded videos as a ZIP (store mode, no recompression)
router.get('/videos.zip', async (_req: Request, res: Response) => {
  const entries = await listVideoZipEntries();
  if (!entries.length) {
    res.status(404).json({ error: 'No downloaded videos found' });
    return;
  }

  res.setHeader('Content-Disposition', 'attachment; filename="play-videos.zip"');
  res.setHeader('Content-Type', 'application/zip');

  // level: 0 = store only (no recompression — videos are already compressed, this is essentially free)
  const archive = archiver('zip', { zlib: { level: 0 } });

  archive.on('error', err => {
    console.error('Archive error:', err);
    // Headers already sent, can't send error response
  });

  archive.pipe(res);

  for (const { filePath, name } of entries) {
    archive.file(filePath, { name });
  }

  await archive.finalize();
});

export default router;
