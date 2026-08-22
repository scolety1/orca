import { AlertTriangle, CheckCircle2, CircleSlash, HelpCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { MigrationClassificationLabel } from '@/lib/types'

export const CLASSIFICATION_META: Record<MigrationClassificationLabel, { label: string; tone: 'healthy' | 'degraded' | 'blocked' | 'unknown'; description: string }> = {
  SAFE_TO_ONBOARD_NOW: { label: 'Safe to onboard now', tone: 'healthy', description: 'Clean, understood, no sensitive-runtime signals.' },
  DIRTY_PRESERVE: { label: 'Dirty — preserve', tone: 'degraded', description: 'Uncommitted work exists and must be preserved, not reset or cleaned.' },
  READ_ONLY_ONBOARDING_ONLY: { label: 'Read-only onboarding only', tone: 'degraded', description: 'Low discovery confidence — known to TSF, not yet eligible for autonomous work.' },
  SENSITIVE: { label: 'Sensitive', tone: 'blocked', description: 'Production, credential, or real-user signals — elevated caution required.' },
  NOT_READY: { label: 'Not ready', tone: 'blocked', description: 'Repository could not be safely understood.' },
  TIM_REQUIRED: { label: 'Needs your decision', tone: 'blocked', description: 'Repository state cannot be reconciled automatically — you have to pick the authoritative source.' }
}

export function classificationBadge(classification: MigrationClassificationLabel) {
  const meta = CLASSIFICATION_META[classification]
  const Icon = meta.tone === 'healthy' ? CheckCircle2 : meta.tone === 'blocked' ? CircleSlash : meta.tone === 'degraded' ? AlertTriangle : HelpCircle
  return (
    <Badge variant={meta.tone}>
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  )
}

export function healthBadge(status: string) {
  const tone = status === 'HEALTHY' ? 'healthy' : status === 'BLOCKED' ? 'blocked' : status === 'UNKNOWN' ? 'unknown' : 'degraded'
  return <Badge variant={tone}>{status.replace(/_/g, ' ')}</Badge>
}

// Defect 3 (M7 real-migration finding): Orca reachability must read as
// distinct honest states, not a single "unreachable" bucket that conflates
// "not registered yet" with "the CLI hiccuped" with "no real signal either
// way".
const ORCA_STATUS_META: Record<string, { label: string; tone: 'healthy' | 'degraded' | 'blocked' | 'unknown' }> = {
  REGISTERED: { label: 'already registered', tone: 'healthy' },
  NOT_REGISTERED: { label: 'not registered yet', tone: 'unknown' },
  ORCA_TEMPORARILY_UNAVAILABLE: { label: 'temporarily unavailable — probably transient', tone: 'degraded' },
  ORCA_UNKNOWN: { label: 'unknown — no Orca CLI found', tone: 'unknown' }
}

export function orcaStatusLabel(status: string | undefined): { label: string; tone: 'healthy' | 'degraded' | 'blocked' | 'unknown' } {
  return ORCA_STATUS_META[status ?? ''] ?? { label: 'unknown', tone: 'unknown' }
}

// Defect 5 (M7 real-migration finding): the Review screen made it hard to
// tell which conclusions came from live Git facts, the pasted/attached
// handoff, deterministic reconciliation between the two, the live planner,
// or an honest fallback. A small provenance tag next to each conclusion
// answers that without dumping internal logs or redesigning the page.
export type ProvenanceKind = 'LIVE_REPO' | 'HANDOFF' | 'RECONCILED' | 'PLANNER' | 'FALLBACK'

const PROVENANCE_META: Record<ProvenanceKind, { label: string; title: string }> = {
  LIVE_REPO: { label: 'live repo', title: 'Read directly from Git/the filesystem just now.' },
  HANDOFF: { label: 'handoff', title: 'From the pasted/attached migration context — untrusted prose evidence, not authority.' },
  RECONCILED: { label: 'reconciled', title: 'Compared against observed repository truth; repository truth always wins.' },
  PLANNER: { label: 'planner', title: 'From a live PLANNER_DEEP call, grounded only in the facts shown above it.' },
  FALLBACK: { label: 'fallback', title: 'The live planner was unavailable — this is the honest recorded-state fallback, not a live answer.' }
}

export function ProvenanceTag({ kind }: { kind: ProvenanceKind }) {
  const meta = PROVENANCE_META[kind]
  return (
    <span
      title={meta.title}
      className="rounded-full border border-border/60 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
    >
      {meta.label}
    </span>
  )
}
