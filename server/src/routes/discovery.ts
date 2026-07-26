import { Router, type Request, type Response } from 'express';
import { discoveryRepo } from '../db/repositories/discovery.js';
import { videosRepo } from '../db/repositories/videos.js';
import { refreshDiscovery } from '../services/discovery.service.js';
import { ingestNewVideo } from '../services/videoIngestion.service.js';
import { parseDesktopId } from '../utils/desktop.js';

const router = Router();

// GET /api/discovery?desktop=1
router.get('/', (req: Request, res: Response) => {
  const desktopId = parseDesktopId(req.query.desktop);
  res.json({ items: discoveryRepo.list(desktopId) });
});

// POST /api/discovery/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const desktopId = parseDesktopId((req.body as { desktop_id?: number }).desktop_id);
  try {
    res.json(await refreshDiscovery(desktopId));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// POST /api/discovery/:id/add
router.post('/:id/add', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const suggestion = discoveryRepo.findById(id);
  if (!suggestion) {
    res.status(404).json({ error: 'Suggestion not found' });
    return;
  }
  if (videosRepo.existsByUrl(suggestion.page_url, suggestion.desktop_id)) {
    discoveryRepo.setStatus(id, 'added');
    res.status(409).json({ error: 'This video is already in the library.' });
    return;
  }

  const requestedCollection = (req.body as { collection_id?: number | null }).collection_id;
  const video = ingestNewVideo({
    url: suggestion.page_url,
    collectionId: requestedCollection === undefined ? suggestion.collection_id : requestedCollection,
    notes: null,
    desktopId: suggestion.desktop_id,
  });
  discoveryRepo.setStatus(id, 'added');
  res.status(201).json(video);
});

// POST /api/discovery/:id/dismiss
router.post('/:id/dismiss', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!discoveryRepo.setStatus(id, 'dismissed')) {
    res.status(404).json({ error: 'Suggestion not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
