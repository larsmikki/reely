import { useCallback, useEffect, useMemo, useState } from 'react'
import { getFailedJobs } from '@/api'
import { useJobs } from '@/contexts/JobsContext'
import type { Job } from '@/types'

// Live jobs (active + recently-completed from SSE) merged with persisted
// failures. Shared by the settings page (Jobs tab badge) and JobsPanel (list).
export function useMergedJobs() {
  const { jobs } = useJobs()
  const [failed, setFailed] = useState<Job[]>([])

  const refreshFailed = useCallback(() => {
    getFailedJobs().then(r => setFailed(r.items)).catch(() => {})
  }, [])

  // Fetch persisted failures on mount, and again whenever any live job changes
  // status. A new error must be captured before its SSE entry is dropped (~10s);
  // a later success must drop the now-superseded failure from the list.
  const liveStatusSig = jobs.map(j => `${j.id}:${j.status}`).sort().join(',')
  useEffect(() => { refreshFailed() }, [refreshFailed, liveStatusSig])

  // Live jobs win over the persisted copy; show most recent activity first.
  const merged = useMemo(() => {
    const byId = new Map<number, Job>()
    for (const j of failed) byId.set(j.id, j)
    for (const j of jobs) byId.set(j.id, j)
    const all = Array.from(byId.values())
    const superseded = (j: Job) =>
      j.status === 'error' &&
      all.some(s => s.status === 'ok' && s.video_id === j.video_id && s.kind === j.kind && s.id > j.id)
    return all
      .filter(j => !superseded(j))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id)
  }, [failed, jobs])

  return { merged, refreshFailed }
}
