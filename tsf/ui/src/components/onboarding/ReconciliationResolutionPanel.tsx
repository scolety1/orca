import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { RESOLUTION_MODE_META } from '@/lib/onboarding-labels'
import type { HandoffReconciliation, ReconciliationResolutionMode } from '@/lib/onboarding-types'

// V1 stabilization finding (onboarding reconciliation deadlock): Review
// could detect a handoff/live-repo disagreement but gave Tim no control
// anywhere to ever resolve it, which forced TIM_REQUIRED and left Known
// Projects/Active Fleet/Work Set all permanently disabled. This shows the
// actual competing evidence per field and lets Tim pick an authoritative
// source — never silently discarding either side.

const FIELD_LABELS: Record<string, string> = {
  head: 'HEAD',
  branch: 'Branch',
  workingTree: 'Working tree',
  repository: 'Repository'
}

const RESOLUTION_MODES: ReconciliationResolutionMode[] = [
  'USE_LIVE_REPO_FOR_CURRENT_STATE',
  'KEEP_UNRESOLVED',
  'USE_HANDOFF'
]

export function ReconciliationResolutionPanel({
  reconciliation,
  resolving,
  onResolve
}: {
  reconciliation: HandoffReconciliation
  resolving: boolean
  onResolve: (mode: ReconciliationResolutionMode) => void
}) {
  const activeMode = reconciliation.resolution?.mode ?? null

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      {reconciliation.identityAmbiguous && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Neither the claimed branch nor the claimed commit exists anywhere in this repository —
            this may be the wrong repository. Known Projects stays unavailable until this is
            resolved.
          </span>
        </div>
      )}

      {reconciliation.discrepancyDetails.length > 0 && (
        <div className="overflow-x-auto tsf-scrollbar">
          <table className="w-full min-w-[360px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-1 pr-3 font-medium">Field</th>
                <th className="pb-1 pr-3 font-medium">Live repository</th>
                <th className="pb-1 font-medium">Handoff</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.discrepancyDetails.map((d, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-1 pr-3 text-muted-foreground">
                    {FIELD_LABELS[d.field] ?? d.field}
                  </td>
                  <td className="py-1 pr-3 font-mono text-foreground">{d.liveRepo.value}</td>
                  <td className="py-1 font-mono text-foreground">{d.handoff.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          {activeMode ? 'Resolution' : 'Pick an authoritative source'}
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row">
          {RESOLUTION_MODES.map((mode) => (
            <Button
              key={mode}
              variant={activeMode === mode ? 'default' : 'outline'}
              size="sm"
              className={cn(
                'flex-1 flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left',
                activeMode === mode && 'ring-2 ring-primary/50'
              )}
              disabled={resolving}
              onClick={() => onResolve(mode)}
              title={RESOLUTION_MODE_META[mode].description}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium">
                {resolving ? <Loader2 className="size-3 animate-spin" /> : null}
                {RESOLUTION_MODE_META[mode].label}
              </span>
              <span className="text-[10px] font-normal opacity-80">
                {RESOLUTION_MODE_META[mode].description}
              </span>
            </Button>
          ))}
        </div>
      </div>

      {activeMode && (
        <div className="text-[10px] text-muted-foreground">
          Resolved:{' '}
          <span className="text-foreground">{RESOLUTION_MODE_META[activeMode].label}</span>. The
          original handoff text above is preserved as historical evidence either way.
        </div>
      )}
    </div>
  )
}
