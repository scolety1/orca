import { AlertTriangle, CheckCircle2, CircleSlash, HelpCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { HealthStatus } from '@/lib/types'

const MAP: Record<HealthStatus, { label: string; variant: 'healthy' | 'degraded' | 'blocked' | 'unknown'; Icon: typeof CheckCircle2 }> = {
  HEALTHY: { label: 'Healthy', variant: 'healthy', Icon: CheckCircle2 },
  DEGRADED: { label: 'Degraded', variant: 'degraded', Icon: AlertTriangle },
  BLOCKED: { label: 'Blocked', variant: 'blocked', Icon: CircleSlash },
  UNKNOWN: { label: 'Unknown', variant: 'unknown', Icon: HelpCircle }
}

export function StatusChip({ status, className }: { status: HealthStatus; className?: string }) {
  const { label, variant, Icon } = MAP[status] ?? MAP.UNKNOWN
  return (
    <Badge variant={variant} className={className}>
      <Icon className="size-3" />
      {label}
    </Badge>
  )
}
