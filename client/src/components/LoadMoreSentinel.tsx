import { useEffect, useRef } from 'react'

// Invisible marker at the end of a grid; fires onVisible when scrolled near
// (600px lookahead) so the next page loads before the user hits the bottom.
export default function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) onVisible() },
      { rootMargin: '600px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onVisible])

  return <div ref={ref} className="h-px" aria-hidden />
}
