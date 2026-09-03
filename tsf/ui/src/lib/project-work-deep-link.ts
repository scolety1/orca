// BUG-12 (bug-ledger.json): every Active Work card (Home, Work) linked only
// to the bare project route (/projects/:id), which always lands on the
// Overview tab -- even for a project with a real, exact Keep Going run
// already known (work-feed-summary.mjs already carries item.runId, just
// never threaded into a link). This is the one place that builds the
// exact deep link, reused by every card so they can't drift.
const KNOWN_TABS = new Set([
  'overview',
  'keep-going',
  'estimate',
  'flight-recorder',
  'adoption',
  'evidence',
  'receipts'
])

export function projectDeepLinkTo(
  projectId: string,
  opts: { tab?: string; runId?: string | null } = {}
): string {
  const params = new URLSearchParams()
  if (opts.tab && KNOWN_TABS.has(opts.tab)) {
    params.set('tab', opts.tab)
  }
  if (opts.runId) {
    params.set('runId', opts.runId)
  }
  const query = params.toString()
  return `/projects/${projectId}${query ? `?${query}` : ''}`
}

// ProjectDetailPage's own read side: resolves an untrusted `tab` query
// param (a bookmark, a hand-edited URL, an older link) to a real tab id,
// never crashing the Tabs component on an unrecognized value.
export function resolveProjectDetailTab(tabParam: string | null): string {
  return tabParam && KNOWN_TABS.has(tabParam) ? tabParam : 'overview'
}
