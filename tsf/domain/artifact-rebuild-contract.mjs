// TSF previously served stale UI because code adoption and tsf/ui/dist
// rebuilding were never one atomic operator workflow (spec Phase 4). This
// closes that permanently: given the real list of changed file paths (a
// real `git diff --name-only`), classify exactly what's actually required
// -- never a blanket "always rebuild everything," never a silent "nothing
// needed" guess.
const UI_SOURCE_PREFIX = 'tsf/ui/src/'
// A UI-only asset change (index.html, public/) still needs a rebuild but
// not a backend restart -- kept as its own prefix so a future addition
// doesn't have to touch the backend-restart list too.
const UI_ASSET_PREFIXES = ['tsf/ui/index.html', 'tsf/ui/public/']
const BACKEND_PREFIXES = [
  'tsf/server/',
  'tsf/domain/',
  'tsf/adapters/',
  'tsf/routing/',
  'tsf/providers/',
  'tsf/contracts/',
  'tsf/main.mjs',
  'tsf/orca-plugin.json'
]
// A change here affects neither a running backend process nor the served
// UI bundle -- tests, docs, fixtures, dev tooling.
const NO_ARTIFACT_IMPACT_PREFIXES = [
  'tsf/test/',
  'tsf/docs/',
  'tsf/fixtures/',
  'tsf/pilots/',
  'tsf/skill-guides/',
  'tsf/launcher/',
  'tsf/README.md'
]

function startsWithAny(filePath, prefixes) {
  return prefixes.some((prefix) => filePath.startsWith(prefix))
}

// changedFiles: real repo-relative paths (e.g. from `git diff --name-only`).
export function classifyArtifactRebuildNeeds(changedFiles) {
  let needsUiRebuild = false
  let needsBackendRestart = false
  const unclassified = []

  for (const filePath of changedFiles) {
    const isUiSource =
      filePath.startsWith(UI_SOURCE_PREFIX) || startsWithAny(filePath, UI_ASSET_PREFIXES)
    const isBackend = startsWithAny(filePath, BACKEND_PREFIXES)
    const isInert = startsWithAny(filePath, NO_ARTIFACT_IMPACT_PREFIXES)
    if (isUiSource) {
      needsUiRebuild = true
    }
    if (isBackend) {
      needsBackendRestart = true
    }
    if (!isUiSource && !isBackend && !isInert) {
      // Honest default: an unrecognized path under tsf/ (e.g. a new
      // top-level directory nobody has classified yet) is treated as
      // requiring BOTH, the safe-but-inconvenient direction -- never
      // silently assumed inert. Reported back so the classification list
      // itself can be extended deliberately, not left guessing forever.
      needsUiRebuild = true
      needsBackendRestart = true
      unclassified.push(filePath)
    }
  }

  return {
    needsUiRebuild,
    needsBackendRestart,
    // Neither true, and changedFiles was non-empty -- a real, provable
    // "docs/tests only" case, not an absence-of-evidence default.
    docsOrTestsOnly: changedFiles.length > 0 && !needsUiRebuild && !needsBackendRestart,
    unclassified
  }
}
