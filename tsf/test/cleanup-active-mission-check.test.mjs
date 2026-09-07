// Real Phase 2 planner-mission-store fixtures (isolated state file) --
// proves active-mission protection against the REAL durable store shape,
// not a fake. Covers the "sleeping unfinished lane" requirement directly:
// a mission whose LEASE has expired but whose missionState is still ACTIVE
// must still block ("Sleep != complete").
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-active-mission-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { mutateCheckpoint, acquirePlannerLease } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint, completePlannerMission } = await import('../domain/planner-mission-checkpoint.mjs')
const { checkActiveMissionReference } = await import('../server/cleanup-active-mission-check.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-06T12:00:00.000Z')
const pastClock = () => new Date('2026-09-06T11:00:00.000Z') // an already-expired lease relative to `clock`

test('cleanup active mission check', async (t) => {
  try {
    await t.test('no mission at all references a target -> not referenced (real evidence, not a guess)', () => {
      const result = checkActiveMissionReference({ branch: 'tsf/feature/totally-unrelated', worktreePath: 'C:/nowhere' })
      assert.equal(result.referenced, false)
    })

    await t.test('an ACTIVE mission whose checkpoint.repoState.branch matches the target BLOCKS', async () => {
      await mutateCheckpoint(
        'mission:cleanup-active-mission-active',
        () =>
          createPlannerMissionCheckpoint(
            {
              missionId: 'mission:cleanup-active-mission-active',
              missionGoal: 'ship the fixture',
              phase: 'BUILD',
              repoState: { branch: 'tsf/feature/active-target', sha: 'a'.repeat(40), worktreePath: 'C:/fixtures/active-target' }
            },
            clock
          ),
        clock
      )
      const result = checkActiveMissionReference({ branch: 'tsf/feature/active-target' })
      assert.equal(result.referenced, true)
      assert.equal(result.referencingMissions[0].missionState, 'ACTIVE')
    })

    await t.test('SLEEPING LANE fixture: lease expired long ago, but missionState is still ACTIVE (not COMPLETE) -- still BLOCKS. "Sleep != complete."', async () => {
      const missionId = 'mission:cleanup-sleeping-lane'
      await mutateCheckpoint(
        missionId,
        () =>
          createPlannerMissionCheckpoint(
            {
              missionId,
              missionGoal: 'a lane that looks stopped but is not done',
              phase: 'BUILD',
              repoState: { branch: 'tsf/feature/sleeping-lane', sha: 'b'.repeat(40), worktreePath: 'C:/fixtures/sleeping-lane' }
            },
            clock
          ),
        clock
      )
      // Acquire a lease and let it expire (using an EARLIER clock so its
      // TTL has already elapsed relative to `clock`, exactly like a
      // planner session that went away without retiring).
      await acquirePlannerLease(missionId, 'planner-that-went-away', pastClock, { ttlMs: 1000 })

      const result = checkActiveMissionReference({ branch: 'tsf/feature/sleeping-lane' })
      assert.equal(result.referenced, true, 'a stale LEASE must not be mistaken for a COMPLETE mission')
    })

    await t.test('a COMPLETE mission no longer blocks -- completion, not lease expiry, is what releases the protection', async () => {
      const missionId = 'mission:cleanup-completed-mission'
      await mutateCheckpoint(
        missionId,
        () =>
          createPlannerMissionCheckpoint(
            {
              missionId,
              missionGoal: 'a finished lane',
              phase: 'DONE',
              repoState: { branch: 'tsf/feature/finished-lane', sha: 'c'.repeat(40), worktreePath: 'C:/fixtures/finished-lane' }
            },
            clock
          ),
        clock
      )
      await mutateCheckpoint(missionId, (checkpoint) => completePlannerMission(checkpoint, clock), clock)
      const result = checkActiveMissionReference({ branch: 'tsf/feature/finished-lane' })
      assert.equal(result.referenced, false)
    })

    await t.test('worktreePath match (case-insensitive, backslash-normalized) also blocks, independent of branch', async () => {
      const missionId = 'mission:cleanup-path-match'
      await mutateCheckpoint(
        missionId,
        () =>
          createPlannerMissionCheckpoint(
            {
              missionId,
              missionGoal: 'path-referenced lane',
              phase: 'BUILD',
              repoState: { branch: 'tsf/feature/path-match', sha: 'd'.repeat(40), worktreePath: 'C:\\Fixtures\\Path-Match\\' }
            },
            clock
          ),
        clock
      )
      const result = checkActiveMissionReference({ branch: 'tsf/feature/unrelated-branch', worktreePath: 'c:/fixtures/path-match' })
      assert.equal(result.referenced, true)
      assert.equal(result.referencingMissions[0].matchedOn, 'worktreePath')
    })
  } finally {
    cleanupStateFile()
  }
})
