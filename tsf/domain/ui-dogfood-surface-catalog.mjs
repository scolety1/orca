// Phase 1 (UI_DOGFOOD_AGENT_V0): generic surface + viewport catalog.
// Mirrors the SHAPE of the renderer's settings-search entries
// (title/description/keywords -- src/renderer/src/components/settings/
// settings-search.ts) as a naming idiom, not a literal import: those ~27
// *-search.ts files are React-coupled and never aggregate into one
// cross-cutting registry today, so this small parallel catalog exists for
// the (non-React) dogfood domain instead. A target-specific enumeration
// strategy (e.g. tsf/adapters/orca-dogfood-surfaces.mjs) supplies the real
// entries; nothing in this file knows what "a surface" means for any one
// app.
export const DOGFOOD_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ id: 'desktop', width: 1440, height: 900 }),
  laptop: Object.freeze({ id: 'laptop', width: 1280, height: 800 }),
  mobile: Object.freeze({ id: 'mobile', width: 390, height: 844 })
})

export function normalizeSurface(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('ui-dogfood surface must be an object')
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new Error('ui-dogfood surface: id is required')
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    throw new Error(`ui-dogfood surface ${raw.id}: title is required`)
  }
  if (typeof raw.open !== 'function') {
    throw new Error(`ui-dogfood surface ${raw.id}: open(page) is required`)
  }
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? '',
    keywords: [...(raw.keywords ?? [])],
    // A surface on the app's primary user journey -- findings here default
    // to blocksCoreFlow when a detector doesn't say otherwise.
    coreFlow: raw.coreFlow === true,
    open: raw.open
  }
}

// Pluggable enumeration: a target supplies its own list (or a function that
// discovers it dynamically from `context`, e.g. a live page). The contract
// never hardcodes what "a surface" means for any one app.
export function enumerateSurfaces(strategy, context) {
  const raw = typeof strategy === 'function' ? strategy(context) : strategy
  if (!Array.isArray(raw)) {
    throw new Error('ui-dogfood surface enumeration strategy must return an array')
  }
  return raw.map(normalizeSurface)
}
