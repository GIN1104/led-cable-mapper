import { useState, type ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  titleExtra?: ReactNode
  defaultExpanded?: boolean
  children: ReactNode
  className?: string
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
        expanded ? 'rotate-180' : ''
      }`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export default function CollapsibleSection({
  title,
  titleExtra,
  defaultExpanded = true,
  children,
  className = '',
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className={`no-print flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-slate-50/80 ${
          expanded ? 'border-b border-slate-100' : ''
        }`}
      >
        <h3 className="text-sm font-semibold text-slate-900">
          {title}
          {titleExtra}
        </h3>
        <ChevronIcon expanded={expanded} />
      </button>

      <div className="print-only border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {title}
          {titleExtra}
        </h3>
      </div>

      <div
        className={`collapsible-panel grid transition-[grid-template-rows] duration-200 ease-in-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
