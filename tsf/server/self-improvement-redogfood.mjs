// Native Self-Improvement Loop V1, Phase 6: real redogfood -- re-executes
// the ORIGINAL detector's own reproduction criteria (never a substitute or
// easier check, per the mission brief) against either the candidate
// worktree (pre-adoption, gate closed) or the canonical repo (post-
// adoption). Reuses the exact same mechanical reproduction/regression
// primitives the verifier already established (self-improvement-verifier-
// dispatch.mjs's resolveMechanicalCommand/runCommand/
// resolveRegressionTestPaths) -- this is deliberately the SAME check, not
// a second implementation, since "never a substitute/easier check" means
// literally reusing it.
import { classifyRedogfoodResult } from '../domain/self-improvement-redogfood.mjs'
import { transitionFinding } from '../domain/self-improvement-finding.mjs'
import { withFinding } from './self-improvement-finding-store.mjs'
import { recordSelfImprovementReceipt } from './self-improvement-receipt-store.mjs'
import { isPathContainedInDirectory, resolveMechanicalCommand, runCommand, runRegressionTests } from './self-improvement-verifier-dispatch.mjs'

// V1, honestly limited: `wasNeverGenuinelyReproducible` (a true detector
// false-positive signal) needs a baseline re-run against the PRE-fix code
// to distinguish "the fix worked" from "this never actually reproduced" --
// that baseline comparison is not built in this wave. A mechanical
// redogfood run therefore only ever reports RESOLVED/REOPENED/
// REGRESSION_INTRODUCED; FALSE_POSITIVE is reachable only via an explicit,
// caller-supplied signal (`knownNeverReproducible`, e.g. a future detector
// adapter that already has its own baseline evidence), never guessed here.
export async function runRedogfood({ finding, missionId, targetPath, adoptedSha = null, knownNeverReproducible = false, clock = () => new Date(), deps = {} }) {
  const reproCommand = resolveMechanicalCommand(finding.reproduction)
  if (!reproCommand && !knownNeverReproducible) {
    return { outcome: 'INCONCLUSIVE', reason: 'no mechanical reproduction command declared -- redogfood cannot mechanically re-check this finding' }
  }
  const run = deps.runCommand ?? runCommand
  const reproductionResult = reproCommand ? run(reproCommand, targetPath, deps) : { passed: false }
  const reproductionStillFails = !reproductionResult.passed && !knownNeverReproducible

  // Regression re-check, same targeted-test discipline as the verifier:
  // only the finding's own explicitly-hinted *.test.mjs entries (a
  // redogfood run has no fresh worker diff to derive sibling tests from,
  // unlike the verifier's own resolveRegressionTestPaths).
  // SECURITY: filesHint is detector-supplied, untrusted text -- never
  // concatenated into a shell string (see self-improvement-verifier-
  // dispatch.mjs's runRegressionTests header) and never trusted to stay
  // inside targetPath without checking (isPathContainedInDirectory).
  let regressionTestsNowFail = false
  const regressionTargets = (finding.candidateFixScope?.filesHint ?? [])
    .filter((f) => f.endsWith('.test.mjs'))
    .filter((f) => isPathContainedInDirectory(targetPath, f))
  if (!reproductionStillFails && !knownNeverReproducible && regressionTargets.length > 0) {
    const runRegression = deps.runRegressionTests ?? runRegressionTests
    regressionTestsNowFail = !runRegression(regressionTargets, targetPath, deps).passed
  }

  const classification = classifyRedogfoodResult(finding.status, {
    reproductionStillFails,
    regressionTestsNowFail,
    wasNeverGenuinelyReproducible: knownNeverReproducible
  })

  const writeFinding = deps.withFinding ?? withFinding
  const recordReceipt = deps.recordSelfImprovementReceipt ?? recordSelfImprovementReceipt
  let nextFinding = finding
  if (classification.findingTransition) {
    nextFinding = await writeFinding(finding.findingId, (current) =>
      transitionFinding(current ?? finding, classification.findingTransition.to, { reason: classification.findingTransition.reason, evidence: [{ missionId, adoptedSha }] }, clock)
    )
  }
  await recordReceipt(missionId, { kind: 'REDOGFOOD_RESULT', missionId, findingId: finding.findingId, detail: { outcome: classification.outcome, adoptedSha, targetPath } }, clock)

  return { outcome: classification.outcome, finding: nextFinding, transitioned: Boolean(classification.findingTransition) }
}
