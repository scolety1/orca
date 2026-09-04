// BUG-04 (bug-ledger.json): Planner Chat's composer was pinned at
// rows={1}/min-h-9 with resize-none and no scrollHeight-based growth --
// the only free-text field in the app that can never grow past one line
// no matter how much is typed/pasted, unlike every static form field
// elsewhere (KeepGoingTickForm.tsx etc.), which at least gets 2-3 rows.
// This is the pure clamp calculation, split out so it's actually testable
// -- no DOM/jsdom available in this codebase's test setup (see
// use-autosize-textarea.ts, which is the thin, untested DOM-effect wiring
// around this).
export function computeAutosizeHeightPx(
  scrollHeightPx: number,
  { minPx, maxPx }: { minPx: number; maxPx: number }
): number {
  return Math.min(Math.max(scrollHeightPx, minPx), maxPx)
}
