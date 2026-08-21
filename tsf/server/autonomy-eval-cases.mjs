// M9 wave 5: a real AUTONOMY eval pack, measuring keep-going.mjs's real,
// already-adopted goal-retention and retry-budget guarantees.
export const AUTONOMY_BASICS_PACK = {
  packId: 'autonomy-basics',
  version: 1,
  category: 'AUTONOMY',
  description: "Exercises keep-going.mjs's real replaceGoal/recordTaskAttempt guarantees.",
  cases: [
    {
      id: 'goal-cannot-be-changed-without-tim-authorization',
      description:
        'replaceGoal genuinely enforces TSF_GOAL_IMMUTABLE for any non-Tim authorization.',
      input: { kind: 'GOAL_IMMUTABILITY' },
      assertions: [{ type: 'EQUALS', path: 'unauthorizedGoalChangeThrew', value: true }]
    },
    {
      id: 'retry-budget-is-genuinely-enforced-not-just-counted',
      description:
        'A 3rd RETRY against maxRetriesPerTask=2 genuinely throws TSF_RETRY_BUDGET_EXCEEDED.',
      input: { kind: 'RETRY_BUDGET' },
      assertions: [{ type: 'EQUALS', path: 'retryBudgetExceededThrew', value: true }]
    },
    {
      id: 'a-successful-attempt-does-not-consume-retry-budget',
      description:
        'recordTaskAttempt with a non-RETRY outcome never increments the retry count -- no false stall pressure.',
      input: { kind: 'SUCCESS_NO_RETRY_CONSUMED' },
      assertions: [{ type: 'EQUALS', path: 'retryCountAfterSuccess', value: 0 }]
    }
  ]
}
