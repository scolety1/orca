// Phase 1 (UI_DOGFOOD_AGENT_V0): a real, generic clipped-content detector.
// Usable as ui-dogfood-contract.mjs's detectSurfaceFindings for ANY target
// (duck-typed on a Playwright-like Page only) -- checks whether any real,
// visible element inside a given root selector overflows the current
// viewport's width, which is exactly what "clipped content" means at a
// given viewport size. Deliberately conservative to avoid false positives:
// skips deliberately-scrollable containers, zero-size (hidden) elements,
// and requires a non-trivial overflow before reporting anything.
const MIN_OVERFLOW_PX = 20
const MAX_REPORTED = 5

export function createDomOverflowDetector({ rootSelector = 'body', includeSelector } = {}) {
  return async function detectViewportOverflowFindings(page, surface, viewportId) {
    if (includeSelector && !surface.id.startsWith(includeSelector)) {
      return []
    }
    const overflowing = await page.evaluate(
      ({ rootSelector, minOverflowPx, maxReported }) => {
        const root = document.querySelector(rootSelector)
        if (!root) {
          return []
        }
        const vw = document.documentElement.clientWidth
        const found = []
        for (const el of root.querySelectorAll('*')) {
          const style = getComputedStyle(el)
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
            continue
          }
          const rect = el.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) {
            continue
          }
          if (rect.right - vw > minOverflowPx) {
            found.push({
              tag: el.tagName.toLowerCase(),
              cls: String(el.className || '').slice(0, 60),
              right: Math.round(rect.right),
              vw
            })
            if (found.length >= maxReported) {
              break
            }
          }
        }
        return found
      },
      { rootSelector, minOverflowPx: MIN_OVERFLOW_PX, maxReported: MAX_REPORTED }
    )
    if (overflowing.length === 0) {
      return []
    }
    const first = overflowing[0]
    return [
      {
        category: 'CLIPPED_CONTENT',
        description: `${overflowing.length} element(s) overflow the ${viewportId} viewport on ${surface.title} (e.g. <${first.tag} class="${first.cls}"> right=${first.right} vs viewport=${first.vw})`,
        affectsAllViewports: false
      }
    ]
  }
}
