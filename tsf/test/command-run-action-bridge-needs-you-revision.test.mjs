// TSF_PRE_UI_PLATFORM_COHERENCE_V1 completion, finish item C: real,
// end-to-end proof that resolveProjectNeedsYou's `expectedRevision` is
// optional additive protection over the already-real domain-level
// assertExpectedRevision check (domain/canonical.mjs), not a change to
// default semantics -- omitted (every existing real caller, see
// command-run-action-bridge.test.mjs), a later answer freely replaces an
// earlier one; supplied and stale, a real TSF_STALE_REVISION rejection
// happens instead of a silent overwrite. Split into its own file (not
// appended to command-run-action-bridge.test.mjs) to keep that file under
// the repo's max-lines cap, mirroring command-quantified-run-action.test.mjs's
// own precedent for the same reason.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-command-run-action-bridge-needs-you-revision-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { resolveProjectNeedsYou } = await import('../server/command-run-action-bridge.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun, raiseNeedsYou } = await import('../domain/keep-going.mjs')

const clock = () => new Date('2026-09-13T12:00:00.000Z')

async function raiseAQuestion(projectId) {
  return withKeepGoingRun(projectId, (current) => {
    const base =
      current ??
      createOvernightRun(
        {
          id: `run-${projectId}`,
          projectId,
          originalGoal: 'Test goal.',
          acceptanceCriteria: ['X']
        },
        clock
      )
    return raiseNeedsYou(base, { question: 'which provider?' }, clock, base.revision)
  })
}

test('resolveProjectNeedsYou: omitted expectedRevision keeps the existing default -- a later answer freely replaces an earlier one', async () => {
  const projectId = 'resolve-needs-you-default-overwrite'
  const run = await raiseAQuestion(projectId)
  const needsYouId = run.needsYou[0].id
  await resolveProjectNeedsYou(projectId, needsYouId, 'first answer', clock)
  const second = await resolveProjectNeedsYou(
    projectId,
    needsYouId,
    'second answer, no revision supplied',
    clock
  )
  assert.equal(second.needsYou[0].resolution, 'second answer, no revision supplied')
})

test('resolveProjectNeedsYou: a supplied, stale expectedRevision is honestly rejected (TSF_STALE_REVISION), never silently overwritten', async () => {
  const projectId = 'resolve-needs-you-stale-revision'
  const run = await raiseAQuestion(projectId)
  const needsYouId = run.needsYou[0].id
  const staleRevision = run.revision
  // A concurrent real resolution lands first, bumping the real revision.
  await resolveProjectNeedsYou(projectId, needsYouId, 'concurrent answer', clock)
  await assert.rejects(
    () => resolveProjectNeedsYou(projectId, needsYouId, 'late answer', clock, staleRevision),
    (error) => {
      assert.match(error.message, /stale revision/)
      assert.equal(error.code, 'TSF_STALE_REVISION')
      return true
    }
  )
  // The concurrent (first) answer is still the real, durable one.
  assert.equal(readKeepGoingRun(projectId).needsYou[0].resolution, 'concurrent answer')
})
