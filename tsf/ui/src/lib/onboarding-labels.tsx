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
