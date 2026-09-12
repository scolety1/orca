// TSF Reconcile & Upgrade Protocol V1, Lane 2 (owner trigger / planner
// routing): a thin, one-directional wrapper over domain/parent-mission-
// intent-classification.mjs's own `hasReconcileUpgradeTriggerSignal` +
// `PARENT_MISSION_INTENTS` (the trigger-phrase detection itself lives
// there, not here, so shouldSuppressResearchCreation can consult it
// directly with zero circular dependency between the two files -- this
// module only ever imports FROM that one, never the reverse).
//
// Reuses PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING rather than
// inventing a new parent-intent value -- Reconcile & Upgrade is a MODE
// within a software-engineering mission, not a fourth mission kind, and
// never a top-level orchestration runtime of its own.
import { hasReconcileUpgradeTriggerSignal, PARENT_MISSION_INTENTS } from './parent-mission-intent-classification.mjs'

export { hasReconcileUpgradeTriggerSignal }

// The one real question this module answers: does this message trigger
// the Reconcile & Upgrade protocol mode, and if so, what parent intent
// does it carry? Always SOFTWARE_PRODUCT_ENGINEERING when triggered --
// this function can never return DATASET_RESEARCH, by construction
// (mirrors shouldSuppressResearchCreation's own real routing guarantee).
export function classifyReconcileUpgradeIntent(message) {
  if (!hasReconcileUpgradeTriggerSignal(message)) {
    return { isReconcileUpgrade: false, parentIntent: null }
  }
  return { isReconcileUpgrade: true, parentIntent: PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING }
}
