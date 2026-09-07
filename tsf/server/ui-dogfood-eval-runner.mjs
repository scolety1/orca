// Phase 1 (UI_DOGFOOD_AGENT_V0): runs UI_DOGFOOD_BASICS_PACK against the
// real domain functions in ui-dogfood-finding.mjs -- pure and synchronous,
// no browser/Electron involved (see that pack's own header for why).
import {
  deduplicateFindings,
  diffDogfoodRuns,
  normalizeFinding,
  scoreDogfoodFindings,
  shouldIterateAgain
} from '../domain/ui-dogfood-finding.mjs'

function runOneCase(input) {
  switch (input.kind) {
    case 'SCORE_ONE':
      return scoreDogfoodFindings([normalizeFinding(input.finding)]).findings[0]
    case 'DEDUPLICATE':
      return deduplicateFindings(input.findings.map(normalizeFinding))
    case 'ITERATION_POLICY': {
      const diff = diffDogfoodRuns(
        input.before.map(normalizeFinding),
        input.after.map(normalizeFinding)
      )
      return {
        diff,
        shouldIterateAgain: shouldIterateAgain(diff, input.iterationCount, input.maxIterations)
      }
    }
    default:
      throw new Error(`ui-dogfood eval runner: unknown case kind ${input.kind}`)
  }
}

export async function runUiDogfoodEvalPack(pack) {
  const actualOutputs = {}
  for (const evalCase of pack.cases) {
    actualOutputs[evalCase.id] = runOneCase(evalCase.input)
  }
  return actualOutputs
}
