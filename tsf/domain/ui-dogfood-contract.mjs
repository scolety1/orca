// Phase 1 (UI_DOGFOOD_AGENT_V0): the generic dogfood contract -- launches an
// isolated candidate instance of ANY target (via an injected launch
// descriptor, never hardcoded to Orca), walks its surfaces across a
// viewport matrix like a user would, and produces a scored, deduplicated
// finding set. Every side effect (launching, navigating, detecting) is
// dependency-injected so this module is fully unit-testable with fakes and
// the SAME code path drives a real Playwright/Electron run in production.
import { DOGFOOD_VIEWPORTS, enumerateSurfaces } from './ui-dogfood-surface-catalog.mjs'
import {
  deduplicateFindings,
  diffDogfoodRuns,
  normalizeFinding,
  scoreDogfoodFindings,
  shouldIterateAgain
} from './ui-dogfood-finding.mjs'

function fail(message) {
  throw new Error(`ui-dogfood contract: ${message}`)
}

// A launch descriptor names a target and how to reach it -- never an app-
// specific hardcoded path. `launch()` returns a fresh, isolated instance
// handle: { page, close() }. `surfaceStrategy` is enumerateSurfaces' own
// pluggable strategy (array or (context) => array).
export function normalizeLaunchDescriptor(raw) {
  if (!raw || typeof raw !== 'object') {
    fail('launch descriptor must be an object')
  }
  if (typeof raw.targetId !== 'string' || !raw.targetId.trim()) {
    fail('targetId is required')
  }
  if (typeof raw.launch !== 'function') {
    fail(`${raw.targetId}: launch() is required`)
  }
  if (!raw.surfaceStrategy) {
    fail(`${raw.targetId}: surfaceStrategy is required`)
  }
  const viewports = raw.viewports ?? ['desktop']
  for (const id of viewports) {
    if (!DOGFOOD_VIEWPORTS[id]) {
      fail(`${raw.targetId}: unknown viewport ${id}`)
    }
  }
  return {
    targetId: raw.targetId,
    displayName: raw.displayName ?? raw.targetId,
    launch: raw.launch,
    surfaceStrategy: raw.surfaceStrategy,
    viewports
  }
}

// Findings any target gets for free, with zero app-specific detector code:
// real browser console errors and real failed network requests captured
// while a surface was open. This is deliberately the ONLY built-in
// detector -- every other category (broken interactions, clipped content,
// dead links, etc.) comes from a target-supplied detector, since only the
// target knows what "correct" looks like for its own UI.
function captureFindings(surfaceId, viewportId, capture) {
  const findings = []
  for (const err of capture.consoleErrors) {
    findings.push(
      normalizeFinding({
        category: 'CONSOLE_ERROR',
        surfaceId,
        viewport: viewportId,
        description: err.text,
        evidence: err
      })
    )
  }
  for (const failure of capture.failedRequests) {
    findings.push(
      normalizeFinding({
        category: 'FAILED_NETWORK_REQUEST',
        surfaceId,
        viewport: viewportId,
        description: `${failure.method} ${failure.url} -- ${failure.failure}`,
        evidence: failure
      })
    )
  }
  return findings
}

// Runs exactly one dogfood pass: launches the target once, visits every
// (surface x viewport) combination, collects findings, and closes it.
// `deps.attachCapture(page) -> { consoleErrors, failedRequests, reset() }`
// and `deps.detectSurfaceFindings(page, surface, viewportId) -> Finding[]`
// are both injected -- production wires real Playwright/adapter code,
// tests wire fakes.
export async function runDogfoodPass(descriptorRaw, deps) {
  const descriptor = normalizeLaunchDescriptor(descriptorRaw)
  if (typeof deps?.attachCapture !== 'function') {
    fail('deps.attachCapture is required')
  }
  const detectSurfaceFindings = deps.detectSurfaceFindings ?? (() => [])

  const instance = await descriptor.launch()
  // Attached once for the whole instance -- re-attaching per iteration
  // would stack duplicate listeners on the same page. `reset()` between
  // iterations scopes each surface/viewport's findings to "since the last
  // reset" without losing or duplicating events.
  const capture = deps.attachCapture(instance.page)
  try {
    const surfaces = enumerateSurfaces(descriptor.surfaceStrategy, { page: instance.page })
    const rawFindings = []
    const screenshots = []
    for (const surface of surfaces) {
      for (const viewportId of descriptor.viewports) {
        const viewport = DOGFOOD_VIEWPORTS[viewportId]
        if (typeof instance.page.setViewportSize === 'function') {
          await instance.page.setViewportSize({ width: viewport.width, height: viewport.height })
        }
        capture.reset?.()
        await surface.open(instance.page)
        const detected = await detectSurfaceFindings(instance.page, surface, viewportId)
        for (const finding of detected) {
          rawFindings.push(
            normalizeFinding({ ...finding, surfaceId: surface.id, viewport: viewportId })
          )
        }
        rawFindings.push(...captureFindings(surface.id, viewportId, capture))
        if (typeof deps.captureScreenshot === 'function') {
          screenshots.push(await deps.captureScreenshot(instance.page, surface.id, viewportId))
        }
      }
    }
    const deduped = deduplicateFindings(rawFindings)
    return {
      // Spread first: scoreDogfoodFindings has its own (deliberately
      // different) schemaVersion -- the RUN version below must win.
      ...scoreDogfoodFindings(deduped),
      schemaVersion: 'TSF_UI_DOGFOOD_RUN_V1',
      targetId: descriptor.targetId,
      surfaceCount: surfaces.length,
      viewports: descriptor.viewports,
      screenshots
    }
  } finally {
    capture.detach?.()
    await instance.close()
  }
}

// Fix-relaunch-rescan loop: runs a pass, and while `shouldIterateAgain`
// says a fix is worth attempting AND `deps.applyFixes` is provided, applies
// fixes to the auto-fix-eligible findings, relaunches, and rescans. Always
// returns real before/after evidence for every iteration, even when no fix
// was applied (iteration 0 is the honest baseline).
export async function runIterativeDogfood(descriptorRaw, deps, maxIterations = 3) {
  const iterations = []
  let previous = await runDogfoodPass(descriptorRaw, deps)
  iterations.push({ iteration: 0, run: previous, appliedFix: null })

  let iterationCount = 0
  while (typeof deps.applyFixes === 'function') {
    const fixable = previous.findings.filter((f) => f.autoFixEligible)
    if (fixable.length === 0) {
      break
    }
    const fixResult = await deps.applyFixes(fixable)
    iterationCount += 1
    const next = await runDogfoodPass(descriptorRaw, deps)
    const diff = diffDogfoodRuns(previous.findings, next.findings)
    iterations.push({ iteration: iterationCount, run: next, appliedFix: fixResult, diff })
    previous = next
    if (!shouldIterateAgain(diff, iterationCount, maxIterations)) {
      break
    }
  }

  return {
    schemaVersion: 'TSF_UI_DOGFOOD_ITERATIVE_RUN_V1',
    targetId: previous.targetId,
    iterationCount: iterations.length,
    iterations,
    finalRun: previous
  }
}
