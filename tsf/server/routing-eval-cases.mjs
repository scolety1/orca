// M9 wave 5: a real ROUTING eval pack, measuring routing.mjs's real
// resolveRole against the REAL, committed provider-role-mappings.v1.json
// and launch-profiles.v1.json config -- never a fabricated role/profile
// shape.
export const ROUTING_BASICS_PACK = {
  packId: 'routing-basics',
  version: 1,
  category: 'ROUTING',
  description: 'Exercises resolveRole against the real, committed routing configuration.',
  cases: [
    {
      id: 'planner-deep-resolves-to-its-real-configured-provider',
      description:
        "PLANNER_DEEP's real preferredProfile (CLAUDE_SAFE) resolves to the real anthropic provider.",
      input: { role: 'PLANNER_DEEP' },
      assertions: [{ type: 'EQUALS', path: 'providerId', value: 'anthropic' }]
    },
    {
      id: 'verifier-independent-genuinely-differs-from-worker-balanced',
      description:
        "The real config marks VERIFIER_INDEPENDENT mustDifferFromWorkerWhenAvailable -- its resolved provider must genuinely differ from WORKER_BALANCED's, not just declare the intent.",
      input: { checkIndependence: true },
      assertions: [{ type: 'EQUALS', path: 'verifierDiffersFromWorker', value: true }]
    },
    {
      id: 'an-unknown-role-fails-honestly-rather-than-resolving-to-a-fabricated-default',
      description:
        'resolveRole throws for a role outside the real, stable role set -- it never invents a fallback resolution.',
      input: { role: 'NOT_A_REAL_ROLE' },
      assertions: [{ type: 'EQUALS', path: 'threwOnUnknownRole', value: true }]
    }
  ]
}
