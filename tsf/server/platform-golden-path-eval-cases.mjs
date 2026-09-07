// Phase 13 (Evaluation/Regression Quality): TSF_PLATFORM_GOLDEN_PATH_EVAL.
// Confirmed real acceptance-level gap -- command-dogfood-sequences.test.mjs,
// keep-going-autonomy-proof.test.mjs, and planner-session-lifecycle-golden-
// rollover.test.mjs each prove a real, valuable, non-overlapping slice, but
// none composes: Command routing -> a real (non-forced) Resource Pressure
// Governor admission decision -> a real planner call -> real Keep Going
// dispatch -> real wave settlement -> the real settled-run reconciler's
// verifier stage -> durable COMPLETE -> an operator-visible result, all in
// ONE run. See platform-golden-path-eval-runner.mjs for what's real vs.
// dependency-injected at each stage, and the checkpoint doc's Phase 13
// section for the full audit trail.
export const PLATFORM_GOLDEN_PATH_BASICS_PACK = {
  packId: 'platform-golden-path-basics',
  version: 1,
  category: 'GOLDEN_PATH',
  description:
    'Proves the real composed platform chain: Command -> Resource Pressure Governor -> planner -> Keep Going dispatch -> wave settlement -> verifier -> durable COMPLETE -> operator-visible result.',
  cases: [
    {
      id: 'critical-host-memory-genuinely-refuses-the-whole-chain-before-the-planner-is-ever-called',
      description:
        'A real classifyDispatchAdmission CRITICAL reading, reached through respondCommand, refuses dispatch before invokeLiveStructuredAnalysis is ever called and creates no Keep Going run -- the negative control proving the Governor is a genuine, live gate in this composition, not forced HEALTHY throughout.',
      input: { kind: 'CRITICAL_REFUSAL' },
      assertions: [
        { type: 'EQUALS', path: 'governorRefusedBeforePlannerCalled', value: true },
        { type: 'EQUALS', path: 'noKeepGoingRunWasCreated', value: true }
      ]
    },
    {
      id: 'full-composed-chain-reaches-durable-complete-with-an-operator-visible-result',
      description:
        'HEALTHY host memory: the real chain composes end to end -- Governor admits, the real live-planner spawn+parse path produces a work plan, Keep Going dispatches and settles an implementation wave, the real settled-run reconciler dispatches independent verification and requires a real disk verdict before completing, the mission reaches durable COMPLETE, and a Command status query reflects it.',
      input: { kind: 'FULL_HAPPY_PATH' },
      assertions: [
        { type: 'EQUALS', path: 'governorAdmittedRealDispatch', value: true },
        { type: 'EQUALS', path: 'plannerWorkPlanCameFromRealLiveExecPath', value: true },
        { type: 'EQUALS', path: 'implementationWaveSettledReal', value: true },
        { type: 'EQUALS', path: 'reconcilerGenuinelyRequiredAVerdictBeforeCompleting', value: true },
        { type: 'EQUALS', path: 'verificationWaveSettledReal', value: true },
        { type: 'EQUALS', path: 'reconcilerReadRealDiskVerdictAndCompleted', value: true },
        { type: 'EQUALS', path: 'missionReachedDurableCompleteState', value: true },
        { type: 'EQUALS', path: 'operatorVisibleTextConfirmsCompletion', value: true }
      ]
    }
  ]
}
