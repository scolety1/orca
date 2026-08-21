// M9 wave 5: a real MEMORY eval pack, measuring project-memory.mjs's
// real, already-adopted M7 guarantees -- project isolation, explicit-
// record immutability, and honest stale-fact supersession.
export const MEMORY_BASICS_PACK = {
  packId: 'memory-basics',
  version: 1,
  category: 'MEMORY',
  description: "Exercises project-memory.mjs's real recall/immutability/supersession functions.",
  cases: [
    {
      id: 'recalls-a-real-lesson-bounded-to-its-own-project',
      description:
        "retrieveExperiencesForCapsule never leaks a different project's lesson into this project's recall.",
      input: { kind: 'ISOLATION' },
      assertions: [
        { type: 'CONTAINS', path: 'projectALessons', value: 'Project A lesson: avoid X' },
        { type: 'NOT_CONTAINS', path: 'projectALessons', value: 'Project B lesson: avoid Y' }
      ]
    },
    {
      id: 'an-explicit-record-cannot-be-silently-superseded',
      description: 'supersedeMemoryRecord genuinely enforces the explicit-immutability gate.',
      input: { kind: 'IMMUTABILITY' },
      assertions: [{ type: 'EQUALS', path: 'unauthorizedSupersedeThrew', value: true }]
    },
    {
      id: 'a-stale-fact-can-be-honestly-superseded-preserving-history',
      description:
        'A non-explicit fact can be superseded; the old record is preserved (never deleted), not silently discarded.',
      input: { kind: 'SUPERSESSION' },
      assertions: [
        {
          type: 'EQUALS',
          path: 'activeStatementAfterSupersede',
          value: 'v2: the API endpoint moved to /api/v2'
        },
        { type: 'EQUALS', path: 'oldRecordStillPresent', value: true }
      ]
    }
  ]
}
