// M9 wave 6: one place naming every real eval pack this program has, so
// the HTTP layer (eval-http-routes.mjs) and any future caller can run one
// by packId without hand-wiring each category's own module pair. Each
// entry's `run` always returns a Promise resolving to the real
// caseId -> actualOutput map (even for the synchronous runners) so the
// caller can always `await` uniformly.
import { PLANNER_BASICS_PACK } from './planner-eval-cases.mjs'
import { runPlannerEvalPack } from './planner-eval-runner.mjs'
import { WORKER_BASICS_PACK } from './worker-eval-cases.mjs'
import { runWorkerEvalPack } from './worker-eval-runner.mjs'
import { VERIFIER_BASICS_PACK } from './verifier-eval-cases.mjs'
import { runVerifierEvalPack } from './verifier-eval-runner.mjs'
import { ROUTING_BASICS_PACK } from './routing-eval-cases.mjs'
import { runRoutingEvalPack } from './routing-eval-runner.mjs'
import { MEMORY_BASICS_PACK } from './memory-eval-cases.mjs'
import { runMemoryEvalPack } from './memory-eval-runner.mjs'
import { AUTONOMY_BASICS_PACK } from './autonomy-eval-cases.mjs'
import { runAutonomyEvalPack } from './autonomy-eval-runner.mjs'
import { ESTIMATOR_BASICS_PACK } from './estimator-eval-cases.mjs'
import { runEstimatorEvalPack } from './estimator-eval-runner.mjs'
import { UI_DOGFOOD_BASICS_PACK } from './ui-dogfood-eval-cases.mjs'
import { runUiDogfoodEvalPack } from './ui-dogfood-eval-runner.mjs'
import { normalizeEvalPack } from '../domain/evaluation-pack.mjs'

const REGISTRY = {
  [PLANNER_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(PLANNER_BASICS_PACK),
    run: async (pack, clock) => runPlannerEvalPack(pack, clock)
  },
  [WORKER_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(WORKER_BASICS_PACK),
    run: async (pack) => runWorkerEvalPack(pack)
  },
  [VERIFIER_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(VERIFIER_BASICS_PACK),
    run: async (pack, clock) => runVerifierEvalPack(pack, clock)
  },
  [ROUTING_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(ROUTING_BASICS_PACK),
    run: async (pack) => runRoutingEvalPack(pack)
  },
  [MEMORY_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(MEMORY_BASICS_PACK),
    run: async (pack, clock) => runMemoryEvalPack(pack, clock)
  },
  [AUTONOMY_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(AUTONOMY_BASICS_PACK),
    run: async (pack, clock) => runAutonomyEvalPack(pack, clock)
  },
  [ESTIMATOR_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(ESTIMATOR_BASICS_PACK),
    run: async (pack) => runEstimatorEvalPack(pack)
  },
  [UI_DOGFOOD_BASICS_PACK.packId]: {
    pack: normalizeEvalPack(UI_DOGFOOD_BASICS_PACK),
    run: async (pack) => runUiDogfoodEvalPack(pack)
  }
}

export function listEvalPacks() {
  return Object.values(REGISTRY).map(({ pack }) => ({
    packId: pack.packId,
    version: pack.version,
    category: pack.category,
    description: pack.description,
    caseCount: pack.cases.length
  }))
}

export function getEvalPackEntry(packId) {
  return REGISTRY[packId] ?? null
}
