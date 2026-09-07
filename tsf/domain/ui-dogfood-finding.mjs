// Phase 1 (UI_DOGFOOD_AGENT_V0): generic finding taxonomy for UI dogfooding.
// Pure and target-agnostic -- nothing here knows about Orca, Electron, or
// Playwright, so the same functions score a dogfood pass against any app.
export const FINDING_CATEGORIES = Object.freeze([
  'BROKEN_INTERACTION',
  'INACCESSIBLE_INTERACTION',
  'CLIPPED_CONTENT',
  'UNUSABLE_RESPONSIVE_STATE',
  'INCONSISTENT_NAVIGATION',
  'DUPLICATE_CONTROL',
  'MISLEADING_LABEL',
  'DEAD_LINK',
  'WRONG_LOADING_STATE',
  'WRONG_ERROR_STATE',
  'WRONG_EMPTY_STATE',
  'STATE_LOSS',
  'LAYOUT_PROBLEM',
  'ACCESSIBILITY_DEFECT',
  'CONSOLE_ERROR',
  'FAILED_NETWORK_REQUEST',
  'SUBJECTIVE_AESTHETIC'
])

export const SEVERITY_LEVELS = Object.freeze(['P0', 'P1', 'P2', 'P3'])

// Owner directive, verbatim scope boundary: only strongly-objective, bounded
// defects are ever eligible for autonomous fixing. Subjective redesign is
// never in this set, no matter what severity it scores.
const AUTO_FIX_ELIGIBLE_CATEGORIES = new Set([
  'BROKEN_INTERACTION',
  'INACCESSIBLE_INTERACTION',
  'CLIPPED_CONTENT',
  'UNUSABLE_RESPONSIVE_STATE',
  'INCONSISTENT_NAVIGATION',
  'DUPLICATE_CONTROL',
  'MISLEADING_LABEL',
  'DEAD_LINK',
  'WRONG_LOADING_STATE',
  'WRONG_ERROR_STATE',
  'WRONG_EMPTY_STATE',
  'STATE_LOSS'
])

function fail(message) {
  throw new Error(`ui-dogfood finding: ${message}`)
}

// Fail-closed normalization, matching normalizeEvalPack's own convention
// (evaluation-pack.mjs) -- a malformed finding is a thrown error, never a
// silently-patched guess.
export function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object') {
    fail('must be an object')
  }
  if (!FINDING_CATEGORIES.includes(raw.category)) {
    fail(`unknown category ${raw.category}`)
  }
  if (typeof raw.surfaceId !== 'string' || !raw.surfaceId.trim()) {
    fail('surfaceId is required')
  }
  if (typeof raw.description !== 'string' || !raw.description.trim()) {
    fail('description is required')
  }
  return {
    category: raw.category,
    surfaceId: raw.surfaceId,
    viewport: raw.viewport ?? 'desktop',
    description: raw.description,
    // Explicit, detector-set signal -- never inferred from category alone.
    // Separates a provably bounded defect (e.g. a control with no
    // accessible name) from a subjective opinion inside the same broad
    // category (e.g. "contrast could be nicer"). Detectors default to
    // objective=true; a detector that emits a judgment call must say so.
    objective: raw.objective !== false,
    blocksCoreFlow: raw.blocksCoreFlow === true,
    affectsAllViewports: raw.affectsAllViewports === true,
    evidence: raw.evidence ?? null
  }
}

export function classifyAutoFixEligibility(finding) {
  if (finding.category === 'SUBJECTIVE_AESTHETIC' || finding.category === 'LAYOUT_PROBLEM') {
    // Explicitly out of auto-fix scope, always -- recommend only, per the
    // "never silently replace established product identity" mandate.
    return false
  }
  if (finding.category === 'ACCESSIBILITY_DEFECT') {
    return finding.objective === true
  }
  return AUTO_FIX_ELIGIBLE_CATEGORIES.has(finding.category)
}

export function classifySeverity(finding) {
  switch (finding.category) {
    case 'BROKEN_INTERACTION':
    case 'DEAD_LINK':
    case 'STATE_LOSS':
    case 'INACCESSIBLE_INTERACTION':
      return finding.blocksCoreFlow ? 'P0' : 'P1'
    case 'FAILED_NETWORK_REQUEST':
    case 'CONSOLE_ERROR':
      return finding.blocksCoreFlow ? 'P1' : 'P2'
    case 'UNUSABLE_RESPONSIVE_STATE':
    case 'CLIPPED_CONTENT':
      return finding.affectsAllViewports ? 'P1' : 'P2'
    case 'INCONSISTENT_NAVIGATION':
    case 'WRONG_ERROR_STATE':
    case 'WRONG_EMPTY_STATE':
    case 'WRONG_LOADING_STATE':
    case 'DUPLICATE_CONTROL':
    case 'MISLEADING_LABEL':
      return 'P2'
    case 'ACCESSIBILITY_DEFECT':
      return finding.objective ? 'P2' : 'P3'
    default:
      // LAYOUT_PROBLEM, SUBJECTIVE_AESTHETIC -- real but never urgent enough
      // to justify an autonomous fix.
      return 'P3'
  }
}

// Normalized dedup signature: same surface+category+viewport-independent
// description prefix is one real defect, not N near-duplicate detections
// from N navigations/viewports.
function dedupeKey(finding) {
  return `${finding.surfaceId}::${finding.category}::${finding.description.trim().toLowerCase().slice(0, 40)}`
}

export function deduplicateFindings(findings) {
  const seen = new Map()
  for (const finding of findings) {
    const key = dedupeKey(finding)
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, { ...finding, occurrences: 1, viewports: [finding.viewport] })
      continue
    }
    existing.occurrences += 1
    if (!existing.viewports.includes(finding.viewport)) {
      existing.viewports.push(finding.viewport)
    }
    existing.affectsAllViewports =
      existing.affectsAllViewports || finding.affectsAllViewports || existing.viewports.length > 1
  }
  return [...seen.values()]
}

// Attaches severity + auto-fix eligibility and produces the summary a
// Command response / eval pack cares about. Findings should already be
// deduplicated before scoring (dedup changes occurrence-driven signals
// like affectsAllViewports).
export function scoreDogfoodFindings(findings) {
  const scored = findings.map((finding) => ({
    ...finding,
    severity: classifySeverity(finding),
    autoFixEligible: classifyAutoFixEligibility(finding)
  }))
  const bySeverity = Object.fromEntries(
    SEVERITY_LEVELS.map((level) => [level, scored.filter((f) => f.severity === level).length])
  )
  return {
    schemaVersion: 'TSF_UI_DOGFOOD_SCORE_V1',
    findings: scored,
    totalFindings: scored.length,
    bySeverity,
    autoFixEligibleCount: scored.filter((f) => f.autoFixEligible).length,
    blockingCount: bySeverity.P0
  }
}

// Before/after comparison for one fix-and-relaunch iteration. Uses the same
// dedup signature as deduplicateFindings so "resolved" genuinely means the
// defect no longer reproduces, not just that its exact wording changed.
export function diffDogfoodRuns(beforeFindings, afterFindings) {
  const beforeKeys = new Set(beforeFindings.map(dedupeKey))
  const afterKeys = new Set(afterFindings.map(dedupeKey))
  const resolved = beforeFindings.filter((f) => !afterKeys.has(dedupeKey(f)))
  const persisting = afterFindings.filter((f) => beforeKeys.has(dedupeKey(f)))
  const newlyIntroduced = afterFindings.filter((f) => !beforeKeys.has(dedupeKey(f)))
  return {
    schemaVersion: 'TSF_UI_DOGFOOD_DIFF_V1',
    resolvedCount: resolved.length,
    persistingCount: persisting.length,
    newlyIntroducedCount: newlyIntroduced.length,
    resolved,
    persisting,
    newlyIntroduced,
    netImprovement: resolved.length - newlyIntroduced.length
  }
}

// Iterate-while-meaningful-improvement-remains policy. A regression from a
// fix (newlyIntroducedCount > 0) always earns one more pass regardless of
// net improvement -- a fix that broke something new is never left as-is.
export function shouldIterateAgain(diff, iterationCount, maxIterations = 3) {
  if (iterationCount >= maxIterations) {
    return false
  }
  if (diff.newlyIntroducedCount > 0) {
    return true
  }
  return diff.netImprovement > 0 && diff.persistingCount > 0
}
