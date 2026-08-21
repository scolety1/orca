// M9 wave 4: a real VERIFIER eval pack. Measures keep-going.mjs's real,
// already-adopted compareStateToGoal -- the actual decision logic that
// sits between a verifier's raw findings and TSF's stop/continue call.
// This is the genuine, callable "verifier interpretation" capability
// this program has; there is no separate invocable verifier-agent
// function to call directly (a verifier's real findings arrive as
// receipts/waveResult data a human or Orca agent produced, not a TSF-
// owned pure function), so measuring compareStateToGoal is measuring
// the real thing, not a stand-in.
export const VERIFIER_BASICS_PACK = {
  packId: 'verifier-basics',
  version: 1,
  category: 'VERIFIER',
  description:
    'Exercises compareStateToGoal against fixed acceptance-criteria/verifier-evidence inputs.',
  cases: [
    {
      id: 'does-not-rubber-stamp-when-a-real-criterion-remains-unverified',
      description:
        'A run with one genuinely unverified acceptance criterion must never be reported STOP_COMPLETE.',
      input: {
        acceptanceCriteria: ['criterion-a', 'criterion-b'],
        verifiedSatisfied: ['criterion-a'],
        blockers: [],
        wavesCompleted: 1,
        maxWaves: 20
      },
      assertions: [{ type: 'EQUALS', path: 'decision', value: 'CONTINUE' }]
    },
    {
      id: 'catches-a-real-planted-blocker',
      description:
        'A verifier that reports a real blocker (a planted defect) must force STOP_BLOCKED, never a silent continue.',
      input: {
        acceptanceCriteria: ['criterion-a'],
        verifiedSatisfied: ['criterion-a'],
        blockers: ['REAL_PLANTED_DEFECT: SQL injection in the search endpoint'],
        wavesCompleted: 1,
        maxWaves: 20
      },
      assertions: [{ type: 'EQUALS', path: 'decision', value: 'STOP_BLOCKED' }]
    },
    {
      id: 'recognizes-genuine-completion-once-every-criterion-is-real-and-verified',
      description:
        'A run with every acceptance criterion genuinely satisfied is correctly reported STOP_COMPLETE.',
      input: {
        acceptanceCriteria: ['criterion-a', 'criterion-b'],
        verifiedSatisfied: ['criterion-a', 'criterion-b'],
        blockers: [],
        wavesCompleted: 1,
        maxWaves: 20
      },
      assertions: [{ type: 'EQUALS', path: 'decision', value: 'STOP_COMPLETE' }]
    }
  ]
}
