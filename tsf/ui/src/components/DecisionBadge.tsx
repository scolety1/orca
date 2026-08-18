import { Bot, ThumbsUp, UserCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { DecisionClass } from '@/lib/types'

const MAP: Record<DecisionClass, { label: string; Icon: typeof Bot; className: string }> = {
  AUTO_DECIDE: { label: 'Auto-decided', Icon: Bot, className: 'text-decision-auto border-border' },
  RECOMMEND_AND_PROCEED: { label: 'Recommended', Icon: ThumbsUp, className: 'text-decision-recommend border-primary/40 bg-primary/10' },
  TIM_REQUIRED: { label: 'Needs you', Icon: UserCheck, className: 'text-decision-tim border-status-degraded/50 bg-status-degraded/10 shadow-[0_0_0_1px_rgba(245,185,66,0.15)]' }
}

export function DecisionBadge({ decisionClass, className }: { decisionClass: DecisionClass; className?: string }) {
  const { label, Icon, className: variantClass } = MAP[decisionClass]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', variantClass, className)}>
      <Icon className="size-3" />
      {label}
    </span>
  )
}
