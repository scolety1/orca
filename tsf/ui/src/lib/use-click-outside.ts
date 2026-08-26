import { useEffect } from 'react'
import type { RefObject } from 'react'

// No @radix-ui/react-popover or -dropdown-menu is installed in this
// standalone app (see tsf/ui/package.json) -- a hand-rolled toggle + this
// hook is the smallest real fix, consistent with how this codebase already
// hand-rolls other UI (PlannerChatPanel, the plain <select> mode pickers)
// rather than adding a new dependency mid-fix.
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [ref, onOutside])
}
