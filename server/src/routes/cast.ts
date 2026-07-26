import { Router, type Request, type Response } from 'express';
import { videosRepo } from '../db/repositories/videos.js';
import {
  buildCastStreamUrl,
  discoverCastDevices,
  getCachedCastDevice,
  inspectCastDiscovery,
  listCachedCastDevices,
  pauseDevice,
  playOnDevice,
  resumeDevice,
  seekDevice,
  setDeviceVolume,
  stopDevice,
} from '../services/cast.service.js';

const router = Router();

router.get('/devices', async (req: Request, res: Response) => {
  const refresh = req.query.refresh !== '0';
  try {
    const items = refresh ? await discoverCastDevices() : listCachedCastDevices();
    res.json({ items });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get('/diagnostics', async (_req: Request, res: Response) => {
  try {
    res.json({ items: await inspectCastDiscovery() });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post('/devices/:id/play', async (req: Request, res: Response) => {
  const device = getCachedCastDevice(String(req.params.id));
  if (!device) {
    res.status(404).json({ error: 'Cast device not found. Search again and retry.' });
    return;
  }

  const videoId = Number(req.body?.video_id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    res.status(400).json({ error: 'video_id is required' });
    return;
  }

  const video = videosRepo.findById(videoId);
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  if (video.fetch_status !== 'ok') {
    res.status(409).json({ error: 'This video is not ready to cast yet' });
    return;
  }

  const streamUrl = buildCastStreamUrl(video.id, device.host);
  try {
    await playOnDevice(device, {
      streamUrl,
      title: video.title ?? 'Untitled',
      site: video.site,
    });
    res.json({ ok: true, stream_url: streamUrl });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post('/devices/:id/pause', (req, res) => void withDevice(req, res, pauseDevice));
router.post('/devices/:id/resume', (req, res) => void withDevice(req, res, resumeDevice));
router.post('/devices/:id/stop', (req, res) => void withDevice(req, res, stopDevice));

router.post('/devices/:id/seek', (req, res) => void withDevice(req, res, device => {
  const seconds = Number(req.body?.seconds);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('seconds must be a non-negative number');
  return seekDevice(device, seconds);
}));

router.post('/devices/:id/volume', (req, res) => void withDevice(req, res, device => {
  const volume = Number(req.body?.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 100) throw new Error('volume must be between 0 and 100');
  return setDeviceVolume(device, volume);
}));

async function withDevice(
  req: Request,
  res: Response,
  action: (device: NonNullable<ReturnType<typeof getCachedCastDevice>>) => Promise<void>,
): Promise<void> {
  const device = getCachedCastDevice(String(req.params.id));
  if (!device) {
    res.status(404).json({ error: 'Cast device not found. Search again and retry.' });
    return;
  }
  try {
    await action(device);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

export default router;
