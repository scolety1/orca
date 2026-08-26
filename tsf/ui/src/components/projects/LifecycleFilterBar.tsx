import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { LIFECYCLE_LABEL, type LifecycleBucket } from '@/lib/project-lifecycle'
import { SORT_LABEL, type ProjectSort } from '@/lib/project-filtering'

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

const FILTER_LABEL: Record<LifecycleBucket | 'ALL', string> = {
  ALL: 'All',
  ...LIFECYCLE_LABEL
}

// Compact sticky toolbar (spec section 8): the 8 lifecycle filter chips no
// longer render flat -- they collapse behind one "Filters ▾" trigger, with
// the active filter shown as a small removable chip. Sort is new (logic in
// lib/project-filtering.ts, tested there since it's a pure module -- this
// file is .tsx and can't be imported by the type-stripping test runner).
export function LifecycleFilterBar({
  active,
  onChange,
  counts,
  search,
  onSearchChange,
  sort,
  onSortChange
}: {
  active: LifecycleBucket | 'ALL'
  onChange: (bucket: LifecycleBucket | 'ALL') => void
  counts: Record<LifecycleBucket | 'ALL', number>
  search: string
  onSearchChange: (value: string) => void
  sort: ProjectSort
  onSortChange: (sort: ProjectSort) => void
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-background/95 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu
          trigger={(open) => (
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors',
                open
                  ? 'border-primary/60 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Filters
              {active !== 'ALL' && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                  {FILTER_LABEL[active]}
                </span>
              )}
              <ChevronDown className="size-3.5" />
            </span>
          )}
        >
          {(close) => (
            <>
              {FILTERS.map((bucket) => (
                <DropdownMenuItem
                  key={bucket}
                  active={active === bucket}
                  onClick={() => {
                    onChange(bucket)
                    close()
                  }}
                >
                  <span>{FILTER_LABEL[bucket]}</span>
                  <span className="text-muted-foreground">{counts[bucket] ?? 0}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenu>

        {active !== 'ALL' && (
          <button
            onClick={() => onChange('ALL')}
            className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
            aria-label={`Clear ${FILTER_LABEL[active]} filter`}
          >
            {FILTER_LABEL[active]}
            <X className="size-3" />
          </button>
        )}

        <DropdownMenu
          trigger={(open) => (
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors',
                open
                  ? 'border-primary/60 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Sort: {SORT_LABEL[sort]}
              <ChevronDown className="size-3.5" />
            </span>
          )}
        >
          {(close) => (
            <>
              {(Object.keys(SORT_LABEL) as ProjectSort[]).map((key) => (
                <DropdownMenuItem
                  key={key}
                  active={sort === key}
                  onClick={() => {
                    onSortChange(key)
                    close()
                  }}
                >
                  {SORT_LABEL[key]}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenu>

        <span className="text-[11px] text-muted-foreground">{counts.ALL} known</span>
      </div>

      <div className="relative w-full sm:w-56">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects…"
          className="w-full rounded-md border border-input bg-input py-1.5 pl-8 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Search projects"
        />
      </div>
    </div>
  )
}
