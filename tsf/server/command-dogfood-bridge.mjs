// Phase 1 (UI_DOGFOOD_AGENT_V0), 1D: Command <-> UI dogfood bridge. Checked
// early in command-responder.mjs (same layer as command-research-bridge.mjs
// -- see that file's own header for why a message-shaped bridge belongs
// ahead of project-fleet intent classification: "dogfood the app" is never
// about a registered fleet project). Reuses the real capability wholesale
// (tsf/domain/ui-dogfood-contract.mjs + tsf/adapters/electron-target-
// launcher.mjs + tsf/adapters/orca-dogfood-surfaces.mjs) -- this file is
// pure message-classification and response-shaping glue, no new execution
// engine.
//
// V0 scope, stated honestly rather than pretended: only Orca's own UI is a
// real, launchable target from this bridge today. A message naming any
// other target gets an honest "not wired yet" answer, never a silent
// no-op dressed up as a real check. A Command-triggered run is a single,
// bounded read-only PASS (find + score + report) -- the autonomous fix-
// relaunch-rescan loop (runIterativeDogfood) is the offline golden-dogfood
// workflow's job (tsf/fixtures/run-dogfood.mjs), not something a live chat
// command applies unreviewed code changes from.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { runDogfoodPass } from '../domain/ui-dogfood-contract.mjs'
import { createElectronLaunchFn } from '../adapters/electron-target-launcher.mjs'
import { attachConsoleNetworkCapture } from '../adapters/browser-console-network-capture.mjs'
import {
  buildOrcaSurfaceStrategy,
  detectOrcaSettingsRenderFindings
} from '../adapters/orca-dogfood-surfaces.mjs'
import { classifyDispatchAdmission } from '../domain/resource-pressure-governor.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'

// Deliberately narrow -- a bare "check" or "review" is common, unrelated
// chat vocabulary elsewhere in this codebase's own domain (status checks,
// PR review, etc., see command-research-bridge.mjs's own header on why a
// narrow anchor matters) and must never hijack an ordinary message. "dogfood"
// as the leading word (not `\bdogfood\b` anywhere) is required for the same
// reason: this fleet's own existing project-id vocabulary includes ids like
// "dogfood-b-nwr" (see command-dogfood-sequences.test.mjs) that a bare
// word-boundary match would wrongly hijack away from real project dispatch.
const LEADING_DOGFOOD_PATTERN = /^dogfood\b/i
const REVIEW_UI_PATTERN = /\breview\s+(orca'?s?\s+)?(the\s+)?ui\b/i
const CHECK_BEFORE_I_LOOK_PATTERN = /\bcheck\s+(this|it)(\s+candidate)?\s+before\s+i\s+look\b/i
const NAMED_OTHER_TARGET_PATTERN = /^dogfood\s+(nwr|niners[- ]war[- ]room)\b/i

export function classifyDogfoodRequest(message) {
  const trimmed = message.trim()
  if (NAMED_OTHER_TARGET_PATTERN.test(trimmed)) {
    return 'DOGFOOD_UNSUPPORTED_TARGET'
  }
  if (
    LEADING_DOGFOOD_PATTERN.test(trimmed) ||
    REVIEW_UI_PATTERN.test(message) ||
    CHECK_BEFORE_I_LOOK_PATTERN.test(message)
  ) {
    return 'DOGFOOD_ORCA_SELF'
  }
  return null
}

export function shouldRouteToDogfoodBridge(message) {
  return classifyDogfoodRequest(message) !== null
}

const REPO_ROOT = path.join(import.meta.dirname, '..', '..')
const BUILT_MAIN_ENTRY = path.join(REPO_ROOT, 'out', 'main', 'index.js')

// Bounded default: main shell + a couple of representative settings panes,
// desktop viewport only -- keeps a chat-triggered run's latency in the same
// ballpark as a real Electron E2E test setup, not a multi-minute full sweep
// (that lives in the golden dogfood fixture instead).
function defaultRealDeps() {
  return {
    launch: createElectronLaunchFn({ appPath: REPO_ROOT }),
    attachCapture: attachConsoleNetworkCapture,
    surfaceStrategy: buildOrcaSurfaceStrategy({ paneIds: ['general', 'appearance'] }),
    detectSurfaceFindings: detectOrcaSettingsRenderFindings
  }
}

function summarizeRun(run) {
  const p0p1 = run.bySeverity.P0 + run.bySeverity.P1
  if (run.totalFindings === 0) {
    return `Dogfooded Orca's own UI (${run.surfaceCount} surface(s)) -- found nothing wrong. Clean pass.`
  }
  const lines = run.findings
    .slice()
    .sort((a, b) => a.severity.localeCompare(b.severity))
    .slice(0, 8)
    .map(
      (f) =>
        `- **${f.severity}** [${f.category}] ${f.surfaceId}: ${f.description}${f.autoFixEligible ? ' (auto-fixable)' : ' (recommend only)'}`
    )
  return [
    `Dogfooded Orca's own UI (${run.surfaceCount} surface(s)): **${run.totalFindings}** finding(s), **${p0p1}** at P0/P1, **${run.autoFixEligibleCount}** auto-fixable.`,
    ...lines,
    run.totalFindings > lines.length ? `...and ${run.totalFindings - lines.length} more.` : null
  ]
    .filter(Boolean)
    .join('\n')
}

export async function respondDogfoodCommand({ message, clock = () => new Date(), deps = {} }) {
  const kind = classifyDogfoodRequest(message)
  if (!kind) {
    return null
  }

  if (kind === 'DOGFOOD_UNSUPPORTED_TARGET') {
    return {
      intent: 'UI_DOGFOOD',
      decisionClass: 'RECOMMEND_AND_PROCEED',
      text: 'I can only dogfood Orca\'s own UI from chat right now -- that target isn\'t wired up here yet. Ask me to "dogfood Orca" instead, or run the golden dogfood fixture directly for other targets.',
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · honest scope limit, no action taken',
      live: false,
      resolvedProjectIds: [],
      scope: 'UI_DOGFOOD'
    }
  }

  if (!(deps.forceRunEvenWhenUnbuilt === true) && !existsSync(BUILT_MAIN_ENTRY)) {
    return {
      intent: 'UI_DOGFOOD',
      decisionClass: 'RECOMMEND_AND_PROCEED',
      text: 'Orca has not been built for dogfooding yet (`out/main/index.js` is missing) -- run `pnpm run build:electron-vite --mode e2e` first, then ask me again.',
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · dispatch withheld -- no built candidate to launch',
      live: false,
      resolvedProjectIds: [],
      scope: 'UI_DOGFOOD'
    }
  }

  // Phase 3 (resource-aware execution hardening), F30: this is the one real
  // production call site that launches a full Electron instance
  // (createElectronLaunchFn -> _electron.launch()) and it never consulted
  // the Resource Pressure Governor at all -- `newBrowserPilots` has existed
  // in buildAdmissionPolicy since V0 but had zero real callers until now.
  // Reuses classifyDispatchAdmission verbatim (F1's own established
  // pattern for the other 5 previously-ungated sites), gated before the
  // real launch, never after.
  const readHostMemory = deps.collectHostMemoryEvidence ?? collectHostMemoryEvidence
  const admission = classifyDispatchAdmission(readHostMemory(), 'newBrowserPilots')
  if (!admission.admitted) {
    return {
      intent: 'UI_DOGFOOD',
      decisionClass: 'RECOMMEND_AND_PROCEED',
      text: `Dogfood run withheld -- ${admission.reason} (tier: ${admission.tier}). Try again once memory pressure eases.`,
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · dispatch withheld -- RESOURCE_PRESSURE_REFUSED',
      live: false,
      resolvedProjectIds: [],
      scope: 'UI_DOGFOOD'
    }
  }

  const { launch, attachCapture, surfaceStrategy, detectSurfaceFindings } = {
    ...defaultRealDeps(),
    ...deps
  }
  try {
    const run = await runDogfoodPass(
      {
        targetId: 'orca-self',
        displayName: 'Orca',
        launch,
        surfaceStrategy,
        viewports: ['desktop']
      },
      { attachCapture, detectSurfaceFindings }
    )
    return {
      intent: 'UI_DOGFOOD',
      decisionClass: 'RECOMMEND_AND_PROCEED',
      text: summarizeRun(run),
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · real dogfood pass via a fresh, isolated Orca instance',
      live: true,
      resolvedProjectIds: [],
      scope: 'UI_DOGFOOD',
      dogfoodRun: {
        runAt: clock().toISOString(),
        totalFindings: run.totalFindings,
        bySeverity: run.bySeverity
      }
    }
  } catch (error) {
    return {
      intent: 'UI_DOGFOOD',
      decisionClass: 'RECOMMEND_AND_PROCEED',
      text: `Dogfood run failed before producing findings: ${error.message}.`,
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · real dispatch attempted, failed',
      live: false,
      resolvedProjectIds: [],
      scope: 'UI_DOGFOOD'
    }
  }
}
