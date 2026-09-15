import type { ReactNode } from 'react'

// TSF UI FINDINGS #2-#16, Global rule: SHAs/branches/worktrees/provider-
// worker details/verification gates/receipts/raw checkpoints/diagnostic
// internals belong under Inspect/Advanced unless a specific owner-facing
// situation genuinely requires them -- progressive disclosure, not deletion.
// A plain native <details> (collapsed by default, zero new dependency) is
// the one shared surface every such disclosure on this page reuses, rather
// than each card inventing its own toggle.
export function AdvancedDisclosure({
  label = 'Advanced',
  children
}: {
  label?: string
  children: ReactNode
}) {
  return (
    <details className="group rounded-md border border-dashed border-border p-2 text-[12px]">
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  )
}
