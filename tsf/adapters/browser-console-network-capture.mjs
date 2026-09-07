// Phase 1 (UI_DOGFOOD_AGENT_V0): shared console+network-error capture for
// any Playwright-like Page. Factored out of the ad-hoc pageerror/console
// listener pair tests/e2e/worktree.spec.ts already hand-rolled -- one real
// mechanism, reused, instead of every dogfood/e2e call site reinventing it.
// Duck-typed on purpose (page.on/off only) so it works against a real
// Playwright Page and against a fake in unit tests alike.
export function attachConsoleNetworkCapture(page) {
  const consoleErrors = []
  const failedRequests = []

  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location?.() ?? null })
    }
  }
  const onPageError = (err) => {
    consoleErrors.push({ text: String(err?.message ?? err), location: null })
  }
  const onRequestFailed = (req) => {
    failedRequests.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure?.()?.errorText ?? 'unknown'
    })
  }
  const onResponse = (res) => {
    if (res.status() >= 400) {
      failedRequests.push({
        url: res.url(),
        method: res.request().method(),
        failure: `HTTP ${res.status()}`
      })
    }
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('requestfailed', onRequestFailed)
  page.on('response', onResponse)

  return {
    consoleErrors,
    failedRequests,
    // Clears accumulated errors in place (same array identity) without
    // detaching -- lets one attach cover many sequential navigations
    // (e.g. one per surface/viewport) while still scoping findings to
    // whichever window is "since the last reset".
    reset: () => {
      consoleErrors.length = 0
      failedRequests.length = 0
    },
    detach: () => {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
      page.off('requestfailed', onRequestFailed)
      page.off('response', onResponse)
    }
  }
}
