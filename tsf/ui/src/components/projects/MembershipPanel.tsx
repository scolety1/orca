// Operator UX pass (spec section 10): explains Known/Active Fleet/Work Set
// compactly, and -- when a control is unavailable -- says why and offers
// the real next action, rather than leaving an unexplained disabled
// checkbox. Reuses server/onboarding.mjs's real gating (portfolioGating,
// already returned on the onboarding record) rather than re-deriving it.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { ProjectDetail } from '@/lib/types'
import { ACTIVE_FLEET_EXPLANATION, WORK_SET_EXPLANATION } from '@/lib/membership-tier-copy'

// Mirrors domain/onboarding.mjs's portfolioGatingForClassification exactly
// -- DIRTY_PRESERVE, in particular, allows Active Fleet but not Work Set;
// showing the same reason for both fields would be actively misleading.
const ACTIVE_FLEET_BLOCKED_REASON: Record<string, string> = {
  READ_ONLY_ONBOARDING_ONLY: 'Read-only by classification -- not eligible for autonomous work.',
  SENSITIVE: 'Sensitive source-admission decision requires Tim.',
  UNRESOLVED_HANDOFF_DISCREPANCY: 'An unresolved handoff discrepancy needs your decision first.',
  TIM_REQUIRED: 'A repository-identity conflict needs your decision first.',
  NOT_READY: 'Repository is not yet in an analyzable state.'
}
const WORK_SET_BLOCKED_REASON: Record<string, string> = {
  ...ACTIVE_FLEET_BLOCKED_REASON,
  DIRTY_PRESERVE: 'Working tree has real uncommitted work -- review it before Work Set is safe.'
}

function Row({
  label,
  active,
  unavailableReason,
  onToggle,
  busy
}: {
  label: string
  active: boolean
  unavailableReason: string | null
  onToggle: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-2.5 text-xs">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          <Badge variant={active ? 'healthy' : 'neutral'}>{active ? 'On' : 'Off'}</Badge>
        </div>
        {!active && unavailableReason && (
          <p className="mt-1 text-[11px] text-muted-foreground">{unavailableReason}</p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || (!active && !!unavailableReason)}
        onClick={onToggle}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : active ? 'Remove' : 'Add'}
      </Button>
    </div>
  )
}

export function MembershipPanel({
  project,
  onChanged
}: {
  project: ProjectDetail
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<'activeFleet' | 'workSet' | null>(null)
  const classification = project.evidence.onboarding?.migrationClassification.classification ?? null
  const fleetReason =
    !project.activeFleet && classification
      ? (ACTIVE_FLEET_BLOCKED_REASON[classification] ?? null)
      : null
  const workSetReason = project.workSet
    ? null
    : !project.activeFleet
      ? 'Work Set requires Active Fleet membership first.'
      : classification
        ? (WORK_SET_BLOCKED_REASON[classification] ?? null)
        : null

  async function toggle(field: 'activeFleet' | 'workSet') {
    setBusy(field)
    try {
      await (field === 'activeFleet'
        ? api.setActiveFleetMembership([project.id], !project.activeFleet)
        : api.setWorkSetMembership([project.id], !project.workSet))
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">
        <strong className="text-foreground">Known</strong> -- TSF remembers/analyzes this project.
        Always on once onboarded.
      </div>
      <Row
        label={`Active Fleet -- ${ACTIVE_FLEET_EXPLANATION}`}
        active={project.activeFleet}
        unavailableReason={fleetReason}
        onToggle={() => toggle('activeFleet')}
        busy={busy === 'activeFleet'}
      />
      <Row
        label={`Work Set -- ${WORK_SET_EXPLANATION}`}
        active={project.workSet}
        unavailableReason={workSetReason}
        onToggle={() => toggle('workSet')}
        busy={busy === 'workSet'}
      />
      {(fleetReason || workSetReason) && (
        <Link to="/projects">
          <Button size="sm" variant="ghost">
            Resolve on Projects
          </Button>
        </Link>
      )}
    </div>
  )
}
