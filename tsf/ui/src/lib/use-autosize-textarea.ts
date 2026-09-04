import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { computeAutosizeHeightPx } from './textarea-autosize'

// BUG-04 (bug-ledger.json): grows a textarea to fit its real content up to
// a capped max height (never unbounded), re-measuring on every value
// change. Height is reset to 'auto' before reading scrollHeight so a
// shrinking edit (deleting a line) is honestly reflected, not stuck at
// its tallest-ever height. See textarea-autosize.ts for the pure clamp
// this wraps -- kept separate since jsdom/a DOM isn't available in this
// codebase's test setup (see that file's own tests for the real coverage).
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { minPx = 36, maxPx = 200 }: { minPx?: number; maxPx?: number } = {}
) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    el.style.height = 'auto'
    el.style.height = `${computeAutosizeHeightPx(el.scrollHeight, { minPx, maxPx })}px`
  }, [ref, value, minPx, maxPx])
}
