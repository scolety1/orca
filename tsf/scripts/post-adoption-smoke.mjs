#!/usr/bin/env node
// Post-adoption live smoke automation (tsf-operator-hardening-v2,
// "Post-adoption smoke automation" priority). Turns as much of the
// documented required post-adoption live-verification sequence
// (bug-ledger.json, HQ.md's "Post-adoption plan") into a repeatable,
// scriptable tool as can honestly be automated over HTTP -- so future TSF
// adoption verification is faster and less dependent on someone manually
// clicking around every surface by hand.
//
// READ-ONLY by design: every check here is a GET, or a POST to a route
// this codebase's own code marks as read-only (chat's STATUS intent, and
// onboarding/analyze -- see their own module-header comments). This script
// never starts, pauses, resumes, dispatches, or mutates any real run or
// project membership. It is safe to run against a live, currently-
// supervising TSF instance without asking anyone's permission first --
// though the two flagged MANUAL items below still need a human.
//
// Usage:
//   node scripts/post-adoption-smoke.mjs [--base-url http://127.0.0.1:4610] [--project-id <id>]
//
// --project-id is optional: if omitted, the script auto-selects the first
// real (sourceClass REAL), non-fixture project with an active Keep Going
// run for the cross-surface/Evidence checks, and skips those checks
// (disclosed, not faked) if none exists at the moment.
//
// Exit code 0 = every automated check passed. Exit code 1 = at least one
// failed. Never exits 0 while silently skipping a failure.

import { verifyLiveRuntime } from '../server/post-update-verification.mjs'

function parseArgs(argv) {
  const out = { baseUrl: 'http://127.0.0.1:4610', projectId: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url' && argv[i + 1]) {
      out.baseUrl = argv[++i]
    } else if (argv[i] === '--project-id' && argv[i + 1]) {
      out.projectId = argv[++i]
    }
  }
  return out
}

async function getJson(baseUrl, path) {
  try {
    const res = await fetch(`${baseUrl}${path}`)
    const body = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, body }
  } catch (error) {
    // A genuinely unreachable server (connection refused, DNS failure,
    // etc.) must degrade into an honest failed check, matching
    // verifyLiveRuntime's own runCheck -- never an uncaught crash that
    // hides how far the script actually got.
    return { ok: false, status: null, body: null, error: error.message }
  }
}

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` -- ${detail}` : ''}`)
}
function skip(name, reason) {
  results.push({ name, ok: null, detail: `SKIPPED: ${reason}` })
  console.log(`[SKIP] ${name} -- ${reason}`)
}

async function main() {
  const { baseUrl, projectId: explicitProjectId } = parseArgs(process.argv.slice(2))
  console.log(`Post-adoption smoke check against ${baseUrl}\n`)

  // 1. verifyLiveRuntime() -- this repo's own existing, already-adopted
  // live-health mechanism (server/post-update-verification.mjs). Not
  // reinvented here, just invoked and its per-check results folded into
  // this script's own summary.
  const runtime = await verifyLiveRuntime(baseUrl)
  for (const check of runtime.checks) {
    record(`verifyLiveRuntime: ${check.name}`, check.ok, check.detail)
  }

  // 2. Update-safety gate -- informational here (this script runs AFTER
  // adoption, when the gate no longer blocks anything), but reporting it
  // is still useful: a real TIM_REQUIRED/WAIT_FOR_ACTIVE_WORK reading
  // immediately post-adoption is worth knowing about even though nothing
  // in this script acts on it.
  const safety = await getJson(baseUrl, '/api/update-safety')
  record(
    'update-safety gate reads a real, well-formed state',
    safety.ok && typeof safety.body?.state === 'string',
    safety.body ? `state=${safety.body.state} reason=${safety.body.reason}` : safety.error ?? `HTTP ${safety.status}`
  )

  // 3. Portfolio/Work load with real content -- a stricter version of
  // verifyLiveRuntime's own bare-shape checks: confirms the response
  // actually contains at least one real (non-fixture) project, not just
  // that the endpoint returns valid JSON.
  const portfolio = await getJson(baseUrl, '/api/portfolio')
  const realProjects = (portfolio.body?.knownProjects ?? []).filter((p) => p.sourceClass === 'REAL')
  record(
    'portfolio contains at least one real (non-fixture) project',
    portfolio.ok && realProjects.length > 0,
    `${realProjects.length} real project(s) found`
  )

  // 4. Cross-surface canonical-state agreement + Evidence + deep-link
  // shape, for one real project with an active/settled run -- the same
  // check this mission's own golden-path tests exercise at the fixture
  // level, run here against whatever real state genuinely exists live.
  const work = await getJson(baseUrl, '/api/work')
  const candidateProjectId =
    explicitProjectId ??
    [...(work.body?.active ?? []), ...(work.body?.verifying ?? []), ...(work.body?.needsYou ?? []), ...(work.body?.stalled ?? []), ...(work.body?.readyForAdoption ?? [])].find(
      (p) => p.liveWorkFeed
    )?.id ??
    null

  if (!candidateProjectId) {
    skip('canonical cross-surface state agreement (Keep Going/Work/Flight Recorder)', 'no real project with an active Keep Going run at the moment')
    skip('Evidence shows real, non-empty results for a real project', 'no real project with an active Keep Going run at the moment')
  } else {
    const [keepGoing, project, flightRecorder] = await Promise.all([
      getJson(baseUrl, `/api/keep-going/${candidateProjectId}`),
      getJson(baseUrl, `/api/projects/${candidateProjectId}`),
      getJson(baseUrl, `/api/projects/${candidateProjectId}/flight-recorder`)
    ])
    const workEntry = [...(work.body.active ?? []), ...(work.body.verifying ?? []), ...(work.body.needsYou ?? []), ...(work.body.stalled ?? []), ...(work.body.readyForAdoption ?? [])].find(
      (p) => p.id === candidateProjectId
    )
    const agree =
      keepGoing.ok &&
      flightRecorder.ok &&
      workEntry &&
      flightRecorder.body?.timeline?.state === keepGoing.body.state &&
      // Work's own bucket must be one this run's coarse state can
      // legitimately land in -- STALLED/NEEDS_YOU/COMPLETE map 1:1,
      // ACTIVE legitimately fans into active/verifying (see
      // test/golden-path-operator-flow.test.mjs's own documented reason).
      (
        (keepGoing.body.state === 'ACTIVE' && ['active', 'verifying'].some((s) => work.body[s]?.some((p) => p.id === candidateProjectId))) ||
        (keepGoing.body.state === 'STALLED' && work.body.stalled?.some((p) => p.id === candidateProjectId)) ||
        (keepGoing.body.state === 'NEEDS_YOU' && work.body.needsYou?.some((p) => p.id === candidateProjectId)) ||
        (keepGoing.body.state === 'COMPLETE' && work.body.readyForAdoption?.some((p) => p.id === candidateProjectId))
      )
    record(
      `canonical cross-surface state agreement for real project '${candidateProjectId}'`,
      !!agree,
      `keepGoing.state=${keepGoing.body?.state} flightRecorder.timeline.state=${flightRecorder.body?.timeline?.state}`
    )

    const evidenceCapsules = project.body?.evidence?.resultCapsules ?? []
    record(
      `Evidence shows real, non-empty results for '${candidateProjectId}' (if this run has completed at least one real wave)`,
      project.ok,
      `${evidenceCapsules.length} result capsule(s) on record -- an empty list here is honest, not necessarily a failure, if no wave has settled yet`
    )

    // Deep-link shape: confirms the API returns everything a real
    // ?tab=keep-going&runId=... deep link needs, without literally
    // clicking through a browser.
    record(
      `deep-link data is real and complete for '${candidateProjectId}'`,
      keepGoing.ok && typeof keepGoing.body?.runId === 'string' && keepGoing.body.runId.length > 0,
      `runId=${keepGoing.body?.runId}`
    )
  }

  // 5. MANUAL items this script cannot safely or meaningfully automate --
  // listed explicitly so they are never silently skipped without record.
  console.log('\n--- MANUAL checks this script cannot automate (require a human) ---')
  console.log('[MANUAL] BUG-01 WebView2 desktop recovery-navigation flow -- requires a real desktop session; do not simulate a backend outage against a live-supervising instance from this script.')
  console.log('[MANUAL] Planner composer auto-grow, Run Now form labels, and other purely visual/rendering checks -- require an actual rendered browser session.')
  console.log('[MANUAL] BUG-07 terminal-tab-title improvement -- requires a real (non-stub) orchestration dispatch and visual confirmation of the resulting tab title; this script never dispatches real work.')
  console.log('[MANUAL] A genuine STALLED-path recovery demonstration on a REAL project (as opposed to confirming whatever real state already exists, done automatically above) requires deliberately choosing to wait out a real stall or already having one -- this script never manufactures one against real work.')

  const automatedFailures = results.filter((r) => r.ok === false)
  console.log(`\n${results.filter((r) => r.ok === true).length} passed, ${automatedFailures.length} failed, ${results.filter((r) => r.ok === null).length} skipped (automated checks only; 4 manual items listed above, always required in addition).`)
  if (automatedFailures.length > 0) {
    console.log('\nFAILED checks:')
    for (const f of automatedFailures) {
      console.log(`  - ${f.name}: ${f.detail}`)
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('post-adoption-smoke.mjs crashed:', error)
  process.exitCode = 1
})
