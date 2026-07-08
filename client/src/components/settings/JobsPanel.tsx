import { useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { cancelJob, retryJob, ignoreJob, cleanupAndRetryVideo } from '@/api'
import { Button, ConfirmDialog } from '@/components/ui'
import SettingsSection from '@/components/settings/SettingsSection'
import { JOB_KIND_LABEL } from '@/contexts/JobsContext'
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

export default function JobsPanel({ merged, refreshFailed }: { merged: Job[]; refreshFailed: () => void }) {
  const { theme } = useTheme()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cleanupJob, setCleanupJob] = useState<Job | null>(null)

  const statusColor = (status: Job['status']) => {
    switch (status) {
      case 'running': return theme.accent
      case 'ok': return '#16a34a'
      case 'error': return '#dc2626'
      default: return theme.text2
    }
  }

  const runAction = async (job: Job, action: () => Promise<unknown>, failLabel: string) => {
    setBusyId(job.id)
    setError(null)
    try { await action() }
    catch (e) { setError(e instanceof Error ? e.message : failLabel) }
    finally { setBusyId(null); refreshFailed() }
  }

  return (
    <SettingsSection
      title="Job queue"
      description="Cancel a stuck download to unblock the queue, or retry a failed one."
    >
      {merged.length === 0 ? (
        <p className="text-sm" style={{ color: theme.text2 }}>No active jobs or recent failures.</p>
      ) : (
        <ul className="space-y-2">
          {merged.map(job => {
            const pct = Math.round((job.progress ?? 0) * 100)
            const canCancel = job.status === 'pending' || job.status === 'running'
            const canRetry = job.status === 'error' || job.status === 'cancelled'
            const color = statusColor(job.status)
            return (
              <li
                key={job.id}
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{ background: theme.surface2, border: `1px solid ${theme.border}` }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: theme.text }}>
                      #{job.id} · {JOB_KIND_LABEL[job.kind]}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: `${color}15`, color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      {job.status}{job.status === 'running' ? ` ${pct}%` : ''}
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
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: theme.surface }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: theme.accent }} />
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

      {error && <p className="text-xs mt-3 font-medium" style={{ color: '#dc2626' }}>{error}</p>}

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
    </SettingsSection>
  )
}
