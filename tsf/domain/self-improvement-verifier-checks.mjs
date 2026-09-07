// Native Self-Improvement Loop V1, Phase 5: pure, mechanical verifier
// predicates. Every function here operates on ALREADY-GATHERED real
// evidence (a diff file list, a test exit code, ...) -- the I/O that
// gathers that evidence lives in server/self-improvement-verifier-
// dispatch.mjs. Kept pure so the verdict-composition logic is fully unit-
// testable with fixture evidence, no real git/process spawn needed.

// A worker's diff must never contain a path matching a forbidden prefix.
// `changedFiles` are repo-root-relative paths from a real `git diff
// --name-only`.
export function checkForbiddenSurfaceTouched(changedFiles, forbiddenPathPrefixes) {
  const violations = changedFiles.filter((file) => forbiddenPathPrefixes.some((forbidden) => file === forbidden || file.startsWith(`${forbidden}/`)))
  return { pass: violations.length === 0, violations }
}

// Every changed file must fall inside the authority envelope's declared
// allowedScope. An EMPTY allowedScope (detector gave no filesHint) is
// treated as "stay minimal" -- checked structurally elsewhere (the worker
// prompt), not as "anything goes" here; this check only ever compares
// against a NON-empty scope, and returns pass:true with an honest note
// when scope was never declared (nothing to mechanically check against).
export function checkAuthorityEnvelopeRespected(changedFiles, allowedScope) {
  if (allowedScope.length === 0) {
    return { pass: true, violations: [], note: 'no filesHint was declared -- scope respect cannot be mechanically checked, only the forbidden-surface check applies' }
  }
  const violations = changedFiles.filter((file) => !allowedScope.some((hint) => file === hint || file.startsWith(`${hint}/`) || hint.startsWith(`${file}/`)))
  return { pass: violations.length === 0, violations }
}

// Hard, but real and limited (documented, not oversold per the mission
// brief): flags a NEW file whose basename closely resembles an existing
// canonical file's basename elsewhere in the repo -- a cheap signal for
// "the worker built a second implementation of something that already
// exists" rather than fixing the named defect in place. Genuinely cannot
// catch semantic duplication (a differently-named file doing the same
// thing) -- only near-identical naming.
function basenameOf(path) {
  return path.split('/').pop()
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j += 1) { dp[0][j] = j }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

export function checkDuplicateArchitectureHeuristic(newFiles, existingFileBasenames, { maxEditDistance = 3 } = {}) {
  const suspects = []
  for (const file of newFiles) {
    const base = basenameOf(file)
    const near = existingFileBasenames.find((existing) => existing !== base && levenshtein(existing, base) <= maxEditDistance)
    if (near) { suspects.push({ newFile: file, resemblesExisting: near }) }
  }
  return { pass: suspects.length === 0, suspects }
}

// The worker's provider must genuinely differ from the verifier's when the
// routing config's mustDifferFromWorkerWhenAvailable flag is set AND a
// different provider was actually available -- see self-improvement-
// provider-independence.mjs for how `divergent`/`fallbackWasNeeded` are
// computed. `requiredIndependence: false` means the config itself doesn't
// require it (e.g. no distinct fallback profile exists) -- never a
// verifier bug, an honest "not applicable".
export function checkVerifierIndependence({ requiredIndependence, divergent }) {
  return { pass: !requiredIndependence || divergent, requiredIndependence, divergent }
}

// Composes every check into one typed verdict. Never a vague pass -- every
// failing check contributes a specific, named reason.
export function buildVerifierVerdict({
  reproductionPassed,
  regressionTestsPassed,
  regressionTargetResolved,
  forbiddenSurfaceCheck,
  scopeCheck,
  duplicateArchitectureCheck,
  independenceCheck
}) {
  const reasons = []
  if (!reproductionPassed) { reasons.push('REPRODUCTION_STILL_FAILS') }
  if (!regressionTargetResolved) { reasons.push('NO_TARGETED_REGRESSION_TEST_RESOLVABLE') }
  else if (!regressionTestsPassed) { reasons.push('REGRESSION_TESTS_FAILED') }
  if (!forbiddenSurfaceCheck.pass) { reasons.push(`FORBIDDEN_SURFACE_TOUCHED:${forbiddenSurfaceCheck.violations.join(',')}`) }
  if (!scopeCheck.pass) { reasons.push(`AUTHORITY_SCOPE_VIOLATED:${scopeCheck.violations.join(',')}`) }
  if (!duplicateArchitectureCheck.pass) {
    reasons.push(`POSSIBLE_DUPLICATE_ARCHITECTURE:${duplicateArchitectureCheck.suspects.map((s) => s.newFile).join(',')}`)
  }
  if (!independenceCheck.pass) { reasons.push('VERIFIER_NOT_INDEPENDENT_FROM_WORKER') }
  return reasons.length === 0 ? { verdict: 'VERIFIED_PASS', reasons: [] } : { verdict: 'VERIFIED_FAIL', reasons }
}
