// M9 wave 4: turns one VERIFIER eval case's fixed input into a real
// actual output by ACTUALLY calling keep-going.mjs's real
// compareStateToGoal -- never a fabricated stand-in for what that real
// decision logic would produce. Builds only the minimal run shape
// compareStateToGoal actually reads (originalGoal.acceptanceCriteria,
// waves.length, budget.maxWaves).
import { compareStateToGoal } from '../domain/keep-going.mjs'

function fakeRunFor(input) {
  return {
    id: 'verifier-eval-fixture',
    originalGoal: { acceptanceCriteria: input.acceptanceCriteria },
    waves: Array.from({ length: input.wavesCompleted }),
    budget: { maxWaves: input.maxWaves }
  }
}

export function runVerifierEvalCase(evalCase, clock = () => new Date()) {
  const { input } = evalCase
  const run = fakeRunFor(input)
  return compareStateToGoal(
    run,
    { verifiedSatisfied: input.verifiedSatisfied, blockers: input.blockers },
    clock
  )
}

export function runVerifierEvalPack(pack, clock = () => new Date()) {
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = runVerifierEvalCase(evalCase, clock)
  }
  return actualOutputsByCaseId
}
