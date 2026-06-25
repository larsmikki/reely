import supertest from 'supertest'
import { describe, it, expect, beforeEach } from 'vitest'
import { unlink } from 'node:fs/promises'
import { createApp } from '../src/app.js'
import { resetDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { config } from '../src/config.js'

const app = createApp()

beforeEach(async () => {
  await resetDb()
  runMigrations()
  await unlink(config.cookiesFile).catch(() => {})
})

describe('GET /api/settings', () => {
  it('returns empty object when no settings exist', async () => {
    const res = await supertest(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })
})

describe('PATCH /api/settings', () => {
  it('sets and retrieves multiple settings', async () => {
    await supertest(app)
      .patch('/api/settings')
      .send({ download_path: '/tmp/videos', ffmpeg_path: '/usr/bin' })

    const res = await supertest(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.download_path).toBe('/tmp/videos')
    expect(res.body.ffmpeg_path).toBe('/usr/bin')
  })

  it('updates an existing key', async () => {
    await supertest(app).patch('/api/settings').send({ download_path: 'old' })
    await supertest(app).patch('/api/settings').send({ download_path: 'new' })

    const res = await supertest(app).get('/api/settings')
    expect(res.body.download_path).toBe('new')
  })

  it('rejects unknown setting keys', async () => {
    const res = await supertest(app).patch('/api/settings').send({ theme: 'dark' })
    expect(res.status).toBe(400)

    const settings = await supertest(app).get('/api/settings')
    expect(settings.body.theme).toBeUndefined()
  })

  it('rejects non-string setting values', async () => {
    const res = await supertest(app).patch('/api/settings').send({ download_path: 42 })
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-object body', async () => {
    const res = await supertest(app)
      .patch('/api/settings')
      .send([{ key: 'value' }])
    expect(res.status).toBe(400)
  })
})

describe('cookies upload', () => {
  it('reports no cookie file initially', async () => {
    const res = await supertest(app).get('/api/settings/cookies')
    expect(res.status).toBe(200)
    expect(res.body.present).toBe(false)
  })

  it('stores an uploaded cookie file and switches to file mode', async () => {
    const content = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n'
    const up = await supertest(app).post('/api/settings/cookies').send({ content })
    expect(up.status).toBe(200)
    expect(up.body.looksValid).toBe(true)

    const status = await supertest(app).get('/api/settings/cookies')
    expect(status.body.present).toBe(true)
    expect(status.body.size).toBeGreaterThan(0)

    const settings = await supertest(app).get('/api/settings')
    expect(settings.body.youtube_cookies_mode).toBe('file')
  })

  it('rejects an empty upload', async () => {
    const res = await supertest(app).post('/api/settings/cookies').send({ content: '   ' })
    expect(res.status).toBe(400)
  })

  it('removes the uploaded cookie file', async () => {
    await supertest(app).post('/api/settings/cookies').send({ content: 'x\ty' })
    await supertest(app).delete('/api/settings/cookies')
    const status = await supertest(app).get('/api/settings/cookies')
    expect(status.body.present).toBe(false)
  })
})
