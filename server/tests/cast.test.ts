import supertest from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { resetDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';

vi.mock('../src/services/extractor.service.js', () => ({
  extractVideoInfo: vi.fn().mockResolvedValue({
    title: 'Mock Title',
    description: 'Mock description',
    duration: 120,
    thumbnail_url: 'https://example.com/thumb.jpg',
    stream_url: 'https://example.com/stream.mp4',
    site: 'example',
  }),
  getStreamUrl: vi.fn().mockResolvedValue('https://example.com/stream.mp4'),
  downloadToPath: vi.fn().mockResolvedValue('/tmp/test-data/videos/1.mp4'),
  downloadMp3ToPath: vi.fn().mockResolvedValue(undefined),
}));

const mockDevice = {
  id: 'tv1',
  name: 'Living Room TV',
  manufacturer: 'Samsung',
  modelName: 'Smart TV',
  host: '192.168.1.50',
  location: 'http://192.168.1.50:8000/root.xml',
  avTransportControlUrl: 'http://192.168.1.50:8000/av',
  renderingControlUrl: 'http://192.168.1.50:8000/render',
  expiresAt: Date.now() + 60_000,
};

const castMocks = vi.hoisted(() => ({
  discoverCastDevices: vi.fn(),
  listCachedCastDevices: vi.fn(),
  getCachedCastDevice: vi.fn(),
  playOnDevice: vi.fn(),
  pauseDevice: vi.fn(),
  resumeDevice: vi.fn(),
  stopDevice: vi.fn(),
  seekDevice: vi.fn(),
  setDeviceVolume: vi.fn(),
  buildCastStreamUrl: vi.fn(),
}));

vi.mock('../src/services/cast.service.js', () => castMocks);

const app = createApp();

beforeEach(async () => {
  vi.clearAllMocks();
  castMocks.discoverCastDevices.mockResolvedValue([mockDevice]);
  castMocks.listCachedCastDevices.mockReturnValue([mockDevice]);
  castMocks.getCachedCastDevice.mockReturnValue(mockDevice);
  castMocks.playOnDevice.mockResolvedValue(undefined);
  castMocks.pauseDevice.mockResolvedValue(undefined);
  castMocks.resumeDevice.mockResolvedValue(undefined);
  castMocks.stopDevice.mockResolvedValue(undefined);
  castMocks.seekDevice.mockResolvedValue(undefined);
  castMocks.setDeviceVolume.mockResolvedValue(undefined);
  castMocks.buildCastStreamUrl.mockReturnValue('http://192.168.1.10:3031/api/videos/1/stream');
  await resetDb();
  runMigrations();
});

describe('GET /api/cast/devices', () => {
  it('returns discovered DLNA devices', async () => {
    const res = await supertest(app).get('/api/cast/devices');
    expect(res.status).toBe(200);
    expect(res.body.items[0].name).toBe('Living Room TV');
    expect(castMocks.discoverCastDevices).toHaveBeenCalled();
  });
});

describe('POST /api/cast/devices/:id/play', () => {
  it('casts a ready video to the selected device', async () => {
    const created = await supertest(app).post('/api/videos').send({ url: 'https://example.com/v' });
    await supertest(app).post(`/api/videos/${created.body.id}/refresh`);

    const res = await supertest(app).post('/api/cast/devices/tv1/play').send({ video_id: created.body.id });

    expect(res.status).toBe(200);
    expect(castMocks.playOnDevice).toHaveBeenCalledWith(mockDevice, {
      streamUrl: 'http://192.168.1.10:3031/api/videos/1/stream',
      title: 'Mock Title',
      site: 'example',
    });
  });

  it('returns 404 when the cached device is missing', async () => {
    castMocks.getCachedCastDevice.mockReturnValue(null);
    const res = await supertest(app).post('/api/cast/devices/missing/play').send({ video_id: 1 });
    expect(res.status).toBe(404);
  });

  it('rejects videos that are not ready', async () => {
    const created = await supertest(app).post('/api/videos').send({ url: 'https://example.com/v' });
    const res = await supertest(app).post('/api/cast/devices/tv1/play').send({ video_id: created.body.id });
    expect(res.status).toBe(409);
  });
});
