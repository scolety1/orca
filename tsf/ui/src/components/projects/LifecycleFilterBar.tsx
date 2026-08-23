import { cn } from '@/lib/cn'
import { LIFECYCLE_LABEL, type LifecycleBucket } from '@/lib/project-lifecycle'
import type { ProjectCard } from '@/lib/types'

const FILTERS: (LifecycleBucket | 'ALL')[] = [
  'ALL',
  'NEEDS_YOU',
  'NEEDS_REPAIR',
  'READY_FOR_WORK',
  'WORKING',
  'READY_FOR_ADOPTION',
  'PAUSED',
  'BLOCKED'
]

export function LifecycleFilterBar({
  active,
  onChange,
  counts,
  search,
  onSearchChange
}: {
  active: LifecycleBucket | 'ALL'
  onChange: (bucket: LifecycleBucket | 'ALL') => void
  counts: Record<LifecycleBucket | 'ALL', number>
  search: string
  onSearchChange: (value: string) => void
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((bucket) => (
          <button
            key={bucket}
            onClick={() => onChange(bucket)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              active === bucket
                ? 'border-primary bg-primary/15 text-foreground'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )}
          >
            {bucket === 'ALL' ? 'All' : LIFECYCLE_LABEL[bucket]}
            <span className="ml-1 opacity-60">{counts[bucket] ?? 0}</span>
          </button>
        ))}
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search projects…"
        className="w-full rounded-md border border-input bg-input px-3 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
        aria-label="Search projects"
      />
    </div>
  )
}

export function matchesSearch(project: ProjectCard, search: string): boolean {
  if (!search.trim()) {
    return true
  }
  const q = search.trim().toLowerCase()
  return (
    project.displayName.toLowerCase().includes(q) ||
    project.id.toLowerCase().includes(q) ||
    (project.migrationClassification ?? '').toLowerCase().includes(q)
  )
}
