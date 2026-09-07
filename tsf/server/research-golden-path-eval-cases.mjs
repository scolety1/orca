// Phase 13 (Evaluation/Regression Quality): TSF_RESEARCH_GOLDEN_PATH_EVAL.
// Confirmed real acceptance-level gap -- research-e2e-normal-mission.test.mjs
// proves source -> observation -> claim -> verification/reconciliation ->
// CanonicalFact -> a real DURABLE Research Library write/read-back, but
// never drives a mission to real COMPLETE through the real autonomous
// driver. research-completion-verification-proving-set.test.mjs drives a
// mission to real COMPLETE via driveOneCycle and touches the real Learning
// Ledger, but its own "Research Library" coverage hand-builds a throwaway
// in-memory library, never the durable store -- and driveOneCycle itself
// never calls into research-library.mjs at all. No existing test proves
// BOTH in one run. Separately, llm-latent-knowledge-research-worker.mjs
// (Cross-Provider Research Worker Reconciliation V2) has solid unit tests
// but has never been driven as part of a real, composed, multi-provider
// ResearchMission. This pack closes both gaps in one scenario: a real
// two-provider conflict, reconciled, driven to real COMPLETE, then proven
// to land in the durable Research Library and produce a real, content-
// checkable Learning Ledger lesson. See research-golden-path-eval-
// runner.mjs and the checkpoint doc's Phase 13 section for the full audit
// trail.
export const RESEARCH_GOLDEN_PATH_BASICS_PACK = {
  packId: 'research-golden-path-basics',
  version: 1,
  category: 'GOLDEN_PATH',
  description:
    'Proves the real composed research chain across two provider adapters: dispatch -> conflict -> reconciliation -> real driveOneCycle COMPLETE -> durable Research Library index/read-back -> a real, content-checkable Learning Ledger lesson.',
  cases: [
    {
      id: 'cross-provider-conflict-reconciles-and-completes-via-the-real-autonomous-driver',
      description:
        'The same field, dispatched to two genuinely different provider adapters (a deterministic fake worker and the real llm-latent-knowledge-research-worker.mjs), disagree -- escalated to a genuine conflict, resolved by an explicit reconciliation decision, then driven to real durable COMPLETE by research-mission-fleet-driver.mjs, never a hand-inlined completion.',
      input: { kind: 'CROSS_PROVIDER_CONFLICT_TO_COMPLETE' },
      assertions: [
        { type: 'EQUALS', path: 'twoDistinctProvidersRealDispatched', value: true },
        { type: 'EQUALS', path: 'genuineConflictWasEscalated', value: true },
        { type: 'EQUALS', path: 'reconciliationProducedCorrectCanonicalFact', value: true },
        { type: 'EQUALS', path: 'missionReachedRealCompleteViaAutonomousDriver', value: true }
      ]
    },
    {
      id: 'completed-missions-facts-land-in-the-durable-research-library-and-a-real-ledger-lesson',
      description:
        'Before explicit indexing, a fresh durable-store query is a genuine CACHE_MISS -- proving indexing is not fabricated or pre-existing. After indexing the COMPLETE mission\'s real CanonicalFact into the real research-library-store.mjs, the same query is a real CACHE_HIT with the correct value, and the real Learning Ledger carries a content-checkable VERIFIED_CORRECTION_PATTERN lesson naming this exact mission.',
      input: { kind: 'DURABLE_LIBRARY_AND_LEDGER_PROOF' },
      assertions: [
        { type: 'EQUALS', path: 'libraryCacheMissBeforeIndexing', value: true },
        { type: 'EQUALS', path: 'libraryCacheHitAfterDurableIndexing', value: true },
        { type: 'EQUALS', path: 'indexedValueMatchesReconciledCanonicalFact', value: true },
        { type: 'EQUALS', path: 'learningLedgerRecordedARealCorrectionLessonForThisMission', value: true }
      ]
    }
  ]
}
