import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { settingsRepo } from '../db/repositories/settings.js';

// Derived once at startup — invalidated by server restart (clients re-enter PIN).
const desk2Secret = randomBytes(32).toString('hex');

export function makeDesk2Token(pinHash: string): string {
  return createHash('sha256').update(`${desk2Secret}:${pinHash}`).digest('hex');
}

const router = Router();

// GET /api/auth/desk2 — is a PIN configured?
router.get('/desk2', (_req: Request, res: Response) => {
  const pinHash = settingsRepo.getMany(['desk2_pin_hash'])['desk2_pin_hash'] ?? '';
  res.json({ pinSet: !!pinHash });
});

// POST /api/auth/desk2 — verify PIN, return token
router.post('/desk2', (req: Request, res: Response) => {
  const { pin } = req.body as { pin?: string };
  if (typeof pin !== 'string' || !pin.trim()) {
    res.status(400).json({ error: 'pin required' });
    return;
  }
  const pinHash = settingsRepo.getMany(['desk2_pin_hash'])['desk2_pin_hash'] ?? '';
  if (!pinHash) {
    res.json({ token: '' });
    return;
  }
  const inputHash = createHash('sha256').update(pin).digest('hex');
  if (inputHash !== pinHash) {
    res.status(401).json({ error: 'Wrong PIN' });
    return;
  }
  res.json({ token: makeDesk2Token(pinHash) });
});

export default router;
