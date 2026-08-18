import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide', {
  variants: {
    variant: {
      neutral: 'border-border bg-muted text-muted-foreground',
      primary: 'border-transparent bg-primary/15 text-accent-foreground',
      healthy: 'border-transparent bg-status-healthy/15 text-status-healthy',
      degraded: 'border-transparent bg-status-degraded/15 text-status-degraded',
      blocked: 'border-transparent bg-status-blocked/15 text-status-blocked',
      unknown: 'border-border bg-transparent text-muted-foreground',
      fixture: 'border-dashed border-border text-muted-foreground'
    }
  },
  defaultVariants: { variant: 'neutral' }
})

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
