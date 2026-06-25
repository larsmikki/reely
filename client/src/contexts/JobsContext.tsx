import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useToast } from '@/components/ui'
import { getVideoById } from '@/api'
import type { Job, JobKind, JobStatus } from '@/types'

export type { Job, JobKind, JobStatus }

// How long completed/failed jobs stay visible after their terminal SSE event.
const COMPLETED_RETENTION_MS = 10000

const FAILURE_LABEL: Record<JobKind, string> = {
  extract_metadata: 'Fetching video info failed',
  download_video: 'Download failed',
  download_mp3: 'MP3 export failed',
  copy_to_output: 'Copy to output folder failed',
  fetch_thumbnail: 'Thumbnail refresh failed',
}

interface JobsContextValue {
  jobs: Job[]
  jobsByVideoId: Map<number, Job[]>
}

const JobsContext = createContext<JobsContextValue>({ jobs: [], jobsByVideoId: new Map() })

const ACTIVE_STATES = new Set<JobStatus>(['pending', 'running'])

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Map<number, Job>>(new Map())
  const { addToast } = useToast()
  // Last seen status per job, to toast only on real transitions (a reconnect
  // snapshot or a repeated progress event must not re-toast).
  const lastStatus = useRef(new Map<number, JobStatus>())

  useEffect(() => {
    let cancelled = false
    let source: EventSource | null = null

    const notify = (job: Job, fromSnapshot: boolean) => {
      const prev = lastStatus.current.get(job.id)
      lastStatus.current.set(job.id, job.status)
      if (fromSnapshot || prev === job.status) return
      if (job.kind === 'download_video' && job.status === 'ok') {
        if (job.video_id != null) {
          getVideoById(job.video_id)
            .then(v => addToast(`Downloaded "${v.title || 'Untitled'}"`, 'success'))
            .catch(() => addToast('Video downloaded', 'success'))
        } else {
          addToast('Video downloaded', 'success')
        }
      } else if (job.status === 'error') {
        const detail = job.error
          ? `: ${job.error.length > 90 ? `${job.error.slice(0, 90)}…` : job.error}`
          : ''
        addToast(`${FAILURE_LABEL[job.kind]}${detail}`, 'error')
      }
    }

    const handle = (job: Job, fromSnapshot: boolean) => {
      if (cancelled) return
      notify(job, fromSnapshot)
      setJobs(prev => {
        const next = new Map(prev)
        // Keep active jobs and recently-completed ones for ~10s
        if (ACTIVE_STATES.has(job.status)) {
          next.set(job.id, job)
        } else {
          next.set(job.id, job)
          setTimeout(() => {
            setJobs(p => {
              if (p.get(job.id)?.updated_at !== job.updated_at) return p
              const m = new Map(p)
              m.delete(job.id)
              lastStatus.current.delete(job.id)
              return m
            })
          }, COMPLETED_RETENTION_MS)
        }
        return next
      })
    }

    try {
      source = new EventSource('/api/jobs/stream')
      source.addEventListener('snapshot', e => {
        try { handle(JSON.parse((e as MessageEvent).data) as Job, true) } catch {}
      })
      source.addEventListener('change', e => {
        try { handle(JSON.parse((e as MessageEvent).data) as Job, false) } catch {}
      })
      source.onerror = () => {
        // EventSource auto-reconnects; nothing to do here
      }
    } catch {
      // SSE not supported — silently no-op
    }

    return () => {
      cancelled = true
      source?.close()
    }
  }, [addToast])

  const value = useMemo<JobsContextValue>(() => {
    const list = Array.from(jobs.values())
    const byVideo = new Map<number, Job[]>()
    for (const job of list) {
      if (job.video_id == null) continue
      const arr = byVideo.get(job.video_id) ?? []
      arr.push(job)
      byVideo.set(job.video_id, arr)
    }
    return { jobs: list, jobsByVideoId: byVideo }
  }, [jobs])

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export function useJobs() { return useContext(JobsContext) }

export function useVideoJobs(videoId: number): Job[] {
  const { jobsByVideoId } = useJobs()
  return jobsByVideoId.get(videoId) ?? []
}

export function useActiveVideoJob(videoId: number): Job | null {
  const jobs = useVideoJobs(videoId)
  const active = jobs.find(j => ACTIVE_STATES.has(j.status))
  return active ?? null
}

export const JOB_KIND_LABEL: Record<JobKind, string> = {
  extract_metadata: 'Fetching info…',
  download_video: 'Downloading…',
  download_mp3: 'Exporting MP3…',
  copy_to_output: 'Copying file…',
  fetch_thumbnail: 'Fetching thumbnail…',
}
