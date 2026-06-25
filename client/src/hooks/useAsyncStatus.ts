import { useCallback, useEffect, useRef, useState } from 'react'

// Shared state machine for fire-and-report actions: tracks a loading flag and
// a status message that auto-clears. The action returns the success message
// (or null for none); thrown errors become the status message.
export function useAsyncStatus(clearAfterMs = 4000) {
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const run = useCallback(async (action: () => Promise<string | null>) => {
    setLoading(true)
    setStatus(null)
    clearTimeout(timer.current)
    try {
      const message = await action()
      setStatus(message)
      if (message) timer.current = setTimeout(() => setStatus(null), clearAfterMs)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed')
      timer.current = setTimeout(() => setStatus(null), clearAfterMs)
    } finally {
      setLoading(false)
    }
  }, [clearAfterMs])

  return { status, loading, run }
}
