import supertest from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { resetDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { videosRepo } from '../src/db/repositories/videos.js'

vi.mock('../src/services/extractor.service.js', () => ({
  extractVideoInfo: vi.fn().mockResolvedValue({
    title: 'Saved song',
    description: null,
    duration: 180,
    thumbnail_url: null,
    stream_url: null,
    site: 'youtube',
    source_id: 'saved-video',
    channel_id: 'artist-channel',
    channel_name: 'Example Artist',
    published_at: '2024-01-01T00:00:00.000Z',
  }),
  listRecentChannelUploads: vi.fn().mockResolvedValue([
    {
      source_id: 'new-release',
      page_url: 'https://www.youtube.com/watch?v=new-release',
      title: 'New Release',
      description: 'A new track',
      duration: 200,
      thumbnail_url: 'https://example.com/new.jpg',
      channel_id: 'artist-channel',
      channel_name: 'Example Artist',
      published_at: '2025-01-01T00:00:00.000Z',
    },
  ]),
  getStreamUrl: vi.fn().mockResolvedValue('https://example.com/stream.mp4'),
  downloadToPath: vi.fn().mockResolvedValue('/tmp/test-data/videos/1.mp4'),
  downloadMp3ToPath: vi.fn().mockResolvedValue(undefined),
}))

const app = createApp()

beforeEach(async () => {
  await resetDb()
  runMigrations()
})

async function seedCreator() {
  const collection = await supertest(app).post('/api/collections').send({ name: 'Music' })
  const created = await supertest(app).post('/api/videos').send({
    url: 'https://www.youtube.com/watch?v=saved-video',
    collection_id: collection.body.id,
  })
  videosRepo.update(created.body.id, {
    site: 'youtube',
    sourceId: 'saved-video',
    channelId: 'artist-channel',
    channelName: 'Example Artist',
    publishedAt: '2024-01-01T00:00:00.000Z',
    fetchStatus: 'ok',
  })
  return collection.body
}

describe('discovery', () => {
  it('finds recent creator uploads and associates the strongest collection', async () => {
    const collection = await seedCreator()

    const refresh = await supertest(app).post('/api/discovery/refresh').send({ desktop_id: 1 })

    expect(refresh.status).toBe(200)
    expect(refresh.body.creators_scanned).toBe(1)
    expect(refresh.body.items).toHaveLength(1)
    expect(refresh.body.items[0]).toMatchObject({
      source_id: 'new-release',
      title: 'New Release',
      collection_id: collection.id,
      collection_name: 'Music',
      status: 'suggested',
    })
    expect(refresh.body.items[0].reason).toContain('Example Artist')
  })

  it('keeps dismissed suggestions hidden after later scans', async () => {
    await seedCreator()
    const refresh = await supertest(app).post('/api/discovery/refresh').send({ desktop_id: 1 })
    const id = refresh.body.items[0].id

    expect((await supertest(app).post(`/api/discovery/${id}/dismiss`)).status).toBe(200)
    expect((await supertest(app).post('/api/discovery/refresh').send({ desktop_id: 1 })).body.items).toEqual([])
  })

  it('adds a suggestion to the library and removes it from discovery', async () => {
    const collection = await seedCreator()
    const refresh = await supertest(app).post('/api/discovery/refresh').send({ desktop_id: 1 })
    const id = refresh.body.items[0].id

    const added = await supertest(app).post(`/api/discovery/${id}/add`).send({})

    expect(added.status).toBe(201)
    expect(added.body.page_url).toBe('https://www.youtube.com/watch?v=new-release')
    expect(added.body.collection_id).toBe(collection.id)
    expect((await supertest(app).get('/api/discovery?desktop=1')).body.items).toEqual([])
  })
})
