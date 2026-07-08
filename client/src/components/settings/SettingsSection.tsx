import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Surface } from '@/components/ui'

// Shared shell for every settings section: title with an optional status
// badge, one-line description, then the section body.
export default function SettingsSection({
  title, description, badge, children,
}: {
  title: string
  description: ReactNode
  badge?: ReactNode
  children: ReactNode
}) {
  const { theme } = useTheme()
  return (
    <Surface className="p-6 mb-5">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold leading-tight" style={{ color: theme.text }}>{title}</h2>
          {badge && <span className="ml-auto shrink-0">{badge}</span>}
        </div>
        <p className="text-xs mt-0.5" style={{ color: theme.text2 }}>{description}</p>
      </div>
      {children}
    </Surface>
  )
}

// Tinted dot-and-label pill for at-a-glance state in a section header.
export function StatusBadge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {children}
    </span>
  )
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const { theme } = useTheme()
  return (
    <label htmlFor={htmlFor} className="block text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: theme.text2 }}>
      {children}
    </label>
  )
}

// Collapsible help block — keeps long instructions out of the default view.
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-80"
        style={{ color: theme.accent }}
      >
        <svg
          className="h-3.5 w-3.5 transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : undefined }}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}
