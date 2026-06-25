import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { getFailedJobs, cancelJob, retryJob, ignoreJob, cleanupAndRetryVideo } from '@/api'
import { Button, Surface, ConfirmDialog } from '@/components/ui'
import { useJobs, JOB_KIND_LABEL } from '@/contexts/JobsContext'
import type { Job } from '@/types'
import { formatAge } from '@/utils/formatAge'

// Ticks on its own 1s interval so the age label updates without re-rendering
// the whole jobs list.
function JobAge({ updatedAt }: { updatedAt: string }) {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{formatAge(updatedAt)}</>
}

export default function JobsPanel() {
  const { theme } = useTheme()
  const { jobs } = useJobs()
  const [failed, setFailed] = useState<Job[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cleanupJob, setCleanupJob] = useState<Job | null>(null)

  const refreshFailed = useCallback(() => {
    getFailedJobs().then(r => setFailed(r.items)).catch(() => {})
  }, [])

  // Fetch persisted failures on mount, and again whenever any live job changes
  // status. A new error must be captured before its SSE entry is dropped (~10s);
  // a later success must drop the now-superseded failure from the list.
  const liveStatusSig = jobs.map(j => `${j.id}:${j.status}`).sort().join(',')
  useEffect(() => { refreshFailed() }, [refreshFailed, liveStatusSig])

  // Live jobs (active + recently-completed from SSE) win over the persisted
  // copy; show most recent activity first.
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

  const runAction = async (job: Job, action: () => Promise<unknown>, failLabel: string) => {
    setBusyId(job.id)
    setError(null)
    try { await action() }
    catch (e) { setError(e instanceof Error ? e.message : failLabel) }
    finally { setBusyId(null); refreshFailed() }
  }

  return (
    <Surface className="p-6 mb-5">
      <h2 className="text-base font-bold mb-1" style={{ color: theme.text }}>Job queue</h2>
      <p className="text-xs mb-5" style={{ color: theme.text2 }}>
        Active jobs and recent failures. Cancel any download that appears stuck to unblock the queue, or retry a failed one.
      </p>

      {merged.length === 0 ? (
        <p className="text-sm" style={{ color: theme.text2 }}>No active jobs or recent failures.</p>
      ) : (
        <ul className="space-y-2">
          {merged.map(job => {
            const pct = Math.round((job.progress ?? 0) * 100)
            const canCancel = job.status === 'pending' || job.status === 'running'
            const canRetry = job.status === 'error' || job.status === 'cancelled'
            return (
              <li
                key={job.id}
                className="flex items-center gap-3 p-3 rounded"
                style={{ background: theme.surface2, border: `1px solid ${theme.border}` }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: theme.text }}>
                      #{job.id} · {JOB_KIND_LABEL[job.kind]}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: theme.surface, color: theme.text2 }}>
                      {job.status}
                    </span>
                    <span className="text-xs" style={{ color: theme.text2 }}>
                      <JobAge updatedAt={job.updated_at} />
                    </span>
                    {job.attempts > 1 && (
                      <span className="text-xs" style={{ color: theme.text2 }}>
                        attempt {job.attempts}/{job.max_attempts}
                      </span>
                    )}
                  </div>
                  {job.status === 'running' && (
                    <div className="mt-1.5 h-1 rounded overflow-hidden" style={{ background: theme.surface }}>
                      <div className="h-full transition-all" style={{ width: `${pct}%`, background: theme.accent }} />
                    </div>
                  )}
                  {job.error && (
                    <p className="text-xs mt-1 break-words whitespace-pre-wrap select-text" style={{ color: theme.text2 }}>
                      {job.error}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {canCancel && (
                    <Button variant="ghost" size="sm" onClick={() => runAction(job, () => cancelJob(job.id), 'Cancel failed')} disabled={busyId === job.id}>
                      Cancel
                    </Button>
                  )}
                  {canRetry && (
                    <Button variant="primary" size="sm" onClick={() => runAction(job, () => retryJob(job.id), 'Retry failed')} disabled={busyId === job.id}>
                      Retry
                    </Button>
                  )}
                  {canRetry && job.video_id != null && (
                    <Button variant="danger" size="sm" onClick={() => setCleanupJob(job)} disabled={busyId === job.id}>
                      Clean & retry
                    </Button>
                  )}
                  {canRetry && (
                    <Button variant="ghost" size="sm" onClick={() => runAction(job, () => ignoreJob(job.id), 'Ignore failed')} disabled={busyId === job.id}>
                      Ignore
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="text-xs mt-3" style={{ color: theme.accent }}>{error}</p>}

      <ConfirmDialog
        open={cleanupJob != null}
        title="Clean & retry"
        message="Cancel all jobs for this video, delete any partial files, and restart the download from scratch?"
        confirmLabel="Clean & retry"
        destructive
        onConfirm={() => {
          const job = cleanupJob
          if (job?.video_id != null) {
            void runAction(job, () => cleanupAndRetryVideo(job.video_id!), 'Cleanup failed')
          }
        }}
        onClose={() => setCleanupJob(null)}
      />
    </Surface>
  )
}
