import { Bot, CheckCircle2, UserCheck, Wrench } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { RepairClass } from '@/lib/health-repair-types'

const MAP: Record<RepairClass, { label: string; Icon: typeof Bot; className: string }> = {
  AUTO_REPAIR_SAFE: {
    label: 'Auto-repairable',
    Icon: Bot,
    className: 'text-decision-auto border-border'
  },
  GOVERNED_REPAIR_MISSION: {
    label: 'Needs a repair mission',
    Icon: Wrench,
    className: 'text-decision-recommend border-primary/40 bg-primary/10'
  },
  TIM_REQUIRED: {
    label: 'Needs you',
    Icon: UserCheck,
    className:
      'text-decision-tim border-status-degraded/50 bg-status-degraded/10 shadow-[0_0_0_1px_rgba(245,185,66,0.15)]'
  },
  NOT_A_DEFECT: {
    label: 'Nothing to repair',
    Icon: CheckCircle2,
    className: 'border-transparent bg-status-healthy/15 text-status-healthy'
  }
}

export function RepairClassBadge({
  repairClass,
  className
}: {
  repairClass: RepairClass
  className?: string
}) {
  const { label, Icon, className: variantClass } = MAP[repairClass]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        variantClass,
        className
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  )
}
