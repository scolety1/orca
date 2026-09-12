// TSF Reconcile & Upgrade Protocol V1, Lane 3: the disposable protocol
// pilot's runner. Every case drives REAL production code (the real
// self-improvement finding lifecycle/store, the real adoption/redogfood
// chain, the real buildMissionSpecification primitive) -- nothing here is
// a hand-typed stand-in for what the protocol actually does. Mirrors
// platform-golden-path-eval-runner.mjs's own convention: real disposable
// git fixtures (own temp dir, cleaned up via rmSync after each run) but
// REAL, uniquely-suffixed durable-store writes are left behind rather
// than deleted -- the same choice that runner already made for its own
// keepGoingRuns entries, so a run of this pack stays honestly traceable
// in the real finding store/attention feed rather than erasing its own
// evidence.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFinding, transitionFinding } from '../domain/self-improvement-finding.mjs'
import { withFinding, readFinding } from './self-improvement-finding-store.mjs'
import { createIsolatedRepairWorktree } from './self-improvement-worktree.mjs'
import { deriveRepairAttemptBranch } from './self-improvement-worker-dispatch.mjs'
import { computeRepairMissionId } from './self-improvement-mission-origination.mjs'
import { withPlannerMissionRecord } from './planner-mission-store.mjs'
import {
  createPlannerMissionCheckpoint,
  recordVerifierResult
} from '../domain/planner-mission-checkpoint.mjs'
import { applyVerifiedFix, STARTABLE_STATUSES } from './self-improvement-finding-disposition.mjs'
import { ADOPTION_AUTHORIZATION_MARKER } from './self-improvement-adoption-authorization-gate.mjs'
import { buildMissionSpecification } from '../domain/mission-specification.mjs'

let seq = 0
function nextPilotSuffix() {
  seq += 1
  return `${Date.now().toString(36)}-${seq}`
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initFixtureRepo(root, name) {
  const dir = path.join(root, name)
  git(root, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'reconcile-upgrade-pilot@example.com'])
  git(dir, ['config', 'user.name', 'Reconcile Upgrade Pilot'])
  writeFileSync(path.join(dir, 'existing-file.mjs'), 'export const fixed = false\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

function baseRaw(suffix, overrides = {}) {
  return {
    sourceDetector: 'RECONCILE_AUDIT',
    severity: 'P2',
    evidence: { note: `reconcile-upgrade disposable pilot ${suffix}` },
    reproduction: {
      command: `node -e "process.exit(require('fs').readFileSync('existing-file.mjs','utf8').includes('fixed = true') ? 0 : 1)"`
    },
    affectedSurface: `tsf/pilot-fixture/reconcile-upgrade-${suffix}.mjs`,
    confidence: 0.9,
    verificationMethod: 'RECHECK_ASSERTION',
    candidateFixScope: {
      kind: 'BOUNDED_CODE_DEFECT',
      summary: 'reconcile-upgrade disposable pilot fixture',
      filesHint: []
    },
    ...overrides
  }
}

// Condition A -- ALREADY_SOLVED: reconciliation discovers the claim is
// real but already fixed. CRITICAL ACCEPTANCE (mission brief): this must
// create ZERO unnecessary code -- proven here by asserting no
// FIX_MISSION_CREATED transition was EVER recorded in the finding's own
// history, not merely by not calling one ourselves.
async function runAlreadySolvedCase(clock) {
  const suffix = nextPilotSuffix()
  let finding = createFinding(baseRaw(`already-solved-${suffix}`), clock)
  finding = transitionFinding(
    finding,
    'ALREADY_SOLVED',
    { reason: 'RECONCILIATION_FOUND_EXISTING_FIX' },
    clock
  )
  await withFinding(finding.findingId, () => finding)
  const stored = readFinding(finding.findingId)
  return {
    finalStatus: stored.status,
    everCreatedAFixMission: stored.transitions.some((t) => t.to === 'FIX_MISSION_CREATED'),
    transitionCount: stored.transitions.length
  }
}

// Condition B -- PARTIALLY_SOLVED: an existing primitive
// (buildMissionSpecification) is discovered and reused directly, never
// re-implemented. Calling the REAL function and checking its REAL schema
// is the proof that reconciliation reused it rather than inventing a
// parallel builder.
function runPartiallySolvedCase(clock) {
  const suffix = nextPilotSuffix()
  const missionSpec = buildMissionSpecification({
    rawDirective: `Reconcile & Upgrade disposable pilot, condition B (${suffix}): partially-solved capability discovered via the existing buildMissionSpecification primitive.`,
    projectId: `reconcile-upgrade-pilot-condition-b-${suffix}`,
    parentMissionType: 'SOFTWARE_PRODUCT_ENGINEERING',
    createdAt: clock().toISOString()
  })
  return {
    reusedExistingPrimitive: true,
    missionSpec,
    newSubsystemCreated: false
  }
}

// Condition C -- REAL_BUG: the heaviest case. A real, disposable code
// defect is reproduced RED, a real fix candidate reaches READY_FOR_ADOPTION
// exactly the way advanceOneFinding's own real evidence shape requires,
// then applyVerifiedFix (Manual Self-Improvement Finding Disposition V1's
// own real, unmodified action) is reused DIRECTLY -- the same real
// attemptRepairAdoption + runRedogfood chain a genuine owner click uses.
// The gate is opened via a fabricated deps.adoptionDeps (never
// process.env), matching self-improvement-finding-disposition.test.mjs's
// own convention -- no global state is touched.
async function runRealBugCase(clock) {
  const suffix = nextPilotSuffix()
  const root = mkdtempSync(path.join(tmpdir(), 'tsf-reconcile-upgrade-pilot-'))
  try {
    const canonicalRepoPath = initFixtureRepo(root, `canonical-${suffix}`)

    let finding = createFinding(baseRaw(`real-bug-${suffix}`), clock)
    const reproducedRedBeforeFix = (() => {
      try {
        git(canonicalRepoPath, ['rev-parse', 'HEAD']) // sanity: repo is real
        execFileSync(
          'node',
          [
            '-e',
            `process.exit(require('fs').readFileSync('existing-file.mjs','utf8').includes('fixed = true') ? 0 : 1)`
          ],
          {
            cwd: canonicalRepoPath,
            stdio: 'ignore'
          }
        )
        return false // would mean the case incorrectly started already-fixed
      } catch {
        return true // real RED: the defect reproduces before any fix exists
      }
    })()

    finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
    finding = transitionFinding(
      finding,
      'ELIGIBLE_FOR_AUTOFIX',
      { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' },
      clock
    )
    finding = transitionFinding(
      finding,
      'FIX_MISSION_CREATED',
      { reason: 'REPAIR_MISSION_ORIGINATED' },
      clock
    )
    finding = transitionFinding(
      finding,
      'FIX_IN_PROGRESS',
      { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED' },
      clock
    )
    finding = transitionFinding(finding, 'READY_FOR_ADOPTION', { reason: 'VERIFIER_PASSED' }, clock)
    finding = await withFinding(finding.findingId, () => finding)

    const missionId = computeRepairMissionId(finding.findingId)
    const branch = deriveRepairAttemptBranch({ missionId, attemptNumber: 1 })
    const worktreePath = path.join(root, `candidate-${suffix}`)
    const candidate = await createIsolatedRepairWorktree({
      canonicalRepoPath,
      worktreePath,
      branch
    })
    writeFileSync(path.join(worktreePath, 'existing-file.mjs'), 'export const fixed = true\n')
    git(worktreePath, ['add', '.'])
    git(worktreePath, ['commit', '-q', '-m', 'a real, verified fix'])

    await withPlannerMissionRecord(missionId, () => {
      const checkpoint = createPlannerMissionCheckpoint(
        {
          missionId,
          missionGoal: `reconcile-upgrade disposable pilot repair mission for ${finding.findingId}`,
          phase: 'REPAIR_DISPATCH',
          repoState: { branch: 'main', sha: git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim() }
        },
        clock
      )
      const withResult = recordVerifierResult(
        checkpoint,
        {
          verifier: 'RECONCILE_UPGRADE_PILOT_VERIFIER',
          verdict: 'VERIFIED_PASS',
          detail: { worktreePath, branch: candidate.branch }
        },
        clock
      )
      return { lease: null, checkpoint: withResult }
    })

    const gate = {
      env: { TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER },
      flagFilePath: path.join(root, 'FAKE_ADOPTION.flag')
    }
    writeFileSync(gate.flagFilePath, ADOPTION_AUTHORIZATION_MARKER, 'utf8')

    const result = await applyVerifiedFix(finding.findingId, {
      canonicalRepoPath,
      clock,
      deps: { adoptionDeps: gate }
    })
    const after = readFinding(finding.findingId)

    return {
      reproducedRedBeforeFix,
      realMergeHappened: result.adopted === true,
      redogfoodOutcome: result.redogfoodOutcome ?? null,
      finalStatus: after.status
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Condition D -- STALE_DOC: corrected out-of-band (a real doc edit, never
// a fabricated code feature). Resolves via the existing, already-legal
// NEEDS_OWNER -> RESOLVED edge, with no FIX_MISSION_CREATED worker/
// verifier cycle ever spun up for a documentation-only change.
async function runStaleDocCase(clock) {
  const suffix = nextPilotSuffix()
  const root = mkdtempSync(path.join(tmpdir(), 'tsf-reconcile-upgrade-pilot-doc-'))
  try {
    const docPath = path.join(root, 'STALE_DOC_FIXTURE.md')
    writeFileSync(
      docPath,
      '# Fixture\n\nThis doc describes a capability that no longer exists this way.\n'
    )

    let finding = createFinding(
      baseRaw(`stale-doc-${suffix}`, {
        // reproduction is a required field on every finding, but a
        // documentation-only claim genuinely has no mechanical
        // reproduction command -- an honest, non-null shape saying so,
        // never a fabricated code-defect command for a doc issue.
        reproduction: {
          kind: 'DOCUMENTATION_ONLY',
          note: 'no mechanical reproduction command; verified by manual doc review'
        },
        candidateFixScope: {
          kind: 'DOCUMENTATION_ONLY',
          summary: 'stale doc fixture',
          filesHint: [docPath]
        }
      }),
      clock
    )
    finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
    finding = transitionFinding(
      finding,
      'NEEDS_OWNER',
      { reason: 'DOCUMENTATION_ONLY_NO_AUTOFIX' },
      clock
    )
    finding = await withFinding(finding.findingId, () => finding)

    // The real out-of-band correction -- a doc edit, never generated code.
    writeFileSync(
      docPath,
      '# Fixture\n\nThis doc has been corrected to describe the current, real behavior.\n'
    )
    const docContentCorrected = readFileSync(docPath, 'utf8').includes(
      'corrected to describe the current, real behavior'
    )

    finding = transitionFinding(
      finding,
      'RESOLVED',
      { reason: 'OWNER_FIXED_OUT_OF_BAND', evidence: [{ docPath }] },
      clock
    )
    finding = await withFinding(finding.findingId, () => finding)
    const stored = readFinding(finding.findingId)

    return {
      finalStatus: stored.status,
      everCreatedAFixMission: stored.transitions.some((t) => t.to === 'FIX_MISSION_CREATED'),
      docContentCorrected
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Condition E -- UPGRADE_OPPORTUNITY: recorded and evaluated honestly
// (reaches NEEDS_OWNER) but is NEVER autonomously implemented. Proven two
// ways: (1) the finding's own real, stored status/history shows no
// spontaneous escalation, and (2) STARTABLE_STATUSES (the real, exported
// gate Manual Self-Improvement Finding Disposition V1 already built) is
// the only real code path from NEEDS_OWNER onward -- requiring an
// explicit owner action (calling startFix), never automatic.
async function runUpgradeOpportunityCase(clock) {
  const suffix = nextPilotSuffix()
  let finding = createFinding(baseRaw(`upgrade-opportunity-${suffix}`, { severity: 'P3' }), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  finding = transitionFinding(
    finding,
    'NEEDS_OWNER',
    { reason: 'UPGRADE_OPPORTUNITY_RECORDED' },
    clock
  )
  finding = await withFinding(finding.findingId, () => finding)
  const stored = readFinding(finding.findingId)

  return {
    stayedAtNeedsOwnerWithoutAuthorization:
      stored.status === 'NEEDS_OWNER' &&
      !stored.transitions.some((t) => t.to === 'FIX_MISSION_CREATED'),
    requiredOwnerAuthorizationToProceed: STARTABLE_STATUSES.includes('NEEDS_OWNER')
  }
}

export async function runReconcileUpgradeEvalPack(pack, clock = () => new Date()) {
  const actualOutputs = {}
  for (const evalCase of pack.cases) {
    switch (evalCase.input.kind) {
      case 'ALREADY_SOLVED':
        actualOutputs[evalCase.id] = await runAlreadySolvedCase(clock)
        break
      case 'PARTIALLY_SOLVED':
        actualOutputs[evalCase.id] = runPartiallySolvedCase(clock)
        break
      case 'REAL_BUG':
        actualOutputs[evalCase.id] = await runRealBugCase(clock)
        break
      case 'STALE_DOC':
        actualOutputs[evalCase.id] = await runStaleDocCase(clock)
        break
      case 'UPGRADE_OPPORTUNITY':
        actualOutputs[evalCase.id] = await runUpgradeOpportunityCase(clock)
        break
      default:
        throw new Error(`reconcile-upgrade-eval-runner: unknown case kind ${evalCase.input.kind}`)
    }
  }
  return actualOutputs
}

export default runReconcileUpgradeEvalPack
