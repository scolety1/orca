import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useClickOutside } from '@/lib/use-click-outside'

// Minimal hand-rolled dropdown -- no @radix-ui/react-dropdown-menu is
// installed in this standalone app (see tsf/ui/package.json). Used for the
// compact Projects toolbar's "Filters ▾"/"Sort ▾" and BulkActionBar's
// "Active Fleet ▾"/"Work Set ▾". Adversarial-review finding: the first
// version had none of the ARIA menu semantics or Escape handling a Radix
// primitive would have given for free -- added here rather than pulling in
// a new dependency mid-fix. Still not a full focus trap/roving-tabindex
// implementation (a real gap disclosed, not hidden) -- but a
// keyboard/screen-reader user can now tell the trigger is a menu, know
// whether it's open, and close it with Escape.
export function DropdownMenu({
  trigger,
  children,
  align = 'start'
}: {
  trigger: (open: boolean) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  useEffect(() => {
    if (!open) {
      return
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex"
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-20 mt-1 min-w-[11rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            align === 'end' ? 'right-0' : 'left-0'
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function DropdownMenuItem({
  onClick,
  active,
  disabled,
  children
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-accent/60 text-accent-foreground'
      )}
    >
      {children}
    </button>
  )
}
