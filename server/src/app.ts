import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { config } from './config.js';
import collectionsRouter from './routes/collections.js';
import videosRouter from './routes/videos.js';
import settingsRouter from './routes/settings.js';
import dataRouter from './routes/data.js';
import browseRouter from './routes/browse.js';
import jobsRouter from './routes/jobs.js';
import authRouter, { makeDesk2Token } from './routes/auth.js';
import { settingsRepo } from './db/repositories/settings.js';

// Gate GET requests for desktop=2 behind the PIN token when one is configured.
function desk2Guard(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' || String(req.query.desktop) !== '2') { next(); return; }
  const pinHash = settingsRepo.getMany(['desk2_pin_hash'])['desk2_pin_hash'] ?? '';
  if (!pinHash) { next(); return; }
  const token = req.headers['x-desk2-token'] as string | undefined;
  if (token === makeDesk2Token(pinHash)) { next(); return; }
  res.status(403).json({ error: 'Desk 2 is locked', code: 'DESK2_LOCKED' });
}

export function createApp() {
  const app = express();

  app.use(compression({
    filter: (req, res) => {
      // Never compress video streams or SSE — both break byte-range / streaming
      if (req.path.includes('/stream')) return false;
      return compression.filter(req, res);
    },
  }));
  if (config.nodeEnv !== 'test') app.use(morgan('dev'));
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/collections', desk2Guard, collectionsRouter);
  app.use('/api/videos', desk2Guard, videosRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/data', dataRouter);
  app.use('/api/browse', browseRouter);
  app.use('/api/jobs', jobsRouter);

  // Serve client build in production
  if (config.nodeEnv === 'production') {
    app.use(express.static(config.clientDistDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(config.clientDistDir, 'index.html'));
    });
  }

  return app;
}
