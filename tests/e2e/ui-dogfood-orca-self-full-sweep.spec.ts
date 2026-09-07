/**
 * Phase 1 (UI_DOGFOOD_AGENT_V0): an extended, opt-in golden dogfood sweep
 * across EVERY real Orca settings pane (not just the bounded 3-pane slice
 * ui-dogfood-orca-self.spec.ts asserts on for fast, deterministic CI
 * signal). Skipped by default -- run with
 * `ORCA_E2E_RUN_UI_DOGFOOD_FULL_SWEEP=1` when you actually want the full,
 * ~30s golden-run evidence (this is how the Phase 1 checkpoint doc's
 * findings were produced).
 */
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { runDogfoodPass } from '../../tsf/domain/ui-dogfood-contract.mjs'
import { attachConsoleNetworkCapture } from '../../tsf/adapters/browser-console-network-capture.mjs'
import {
  ALL_ORCA_SETTINGS_PANES,
  buildOrcaSurfaceStrategy,
  detectOrcaSettingsRenderFindings
} from '../../tsf/adapters/orca-dogfood-surfaces.mjs'
import { createDomOverflowDetector } from '../../tsf/adapters/dom-overflow-detector.mjs'

test('extended sweep: every real Orca settings pane, desktop + mobile', async ({ orcaPage }) => {
  test.skip(
    process.env.ORCA_E2E_RUN_UI_DOGFOOD_FULL_SWEEP !== '1',
    "opt-in golden sweep -- see this file's header"
  )
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  const detectOverflow = createDomOverflowDetector({
    rootSelector: '[data-settings-section]',
    includeSelector: 'settings-'
  })
  const descriptor = {
    targetId: 'orca-self-full-sweep',
    launch: async () => ({ page: orcaPage, close: async () => {} }),
    surfaceStrategy: buildOrcaSurfaceStrategy({ paneIds: ALL_ORCA_SETTINGS_PANES }),
    viewports: ['desktop', 'mobile']
  }
  const run = await runDogfoodPass(descriptor, {
    attachCapture: attachConsoleNetworkCapture,
    detectSurfaceFindings: async (page, surface, viewportId) => [
      ...(await detectOrcaSettingsRenderFindings(page, surface)),
      ...(await detectOverflow(page, surface, viewportId))
    ]
  })
  // eslint-disable-next-line no-console -- deliberate: this is the actual
  // golden-run evidence a human/agent reads, not debug noise.
  console.log(
    `[FULL SWEEP] ${run.totalFindings} finding(s) across ${run.surfaceCount} surfaces: ${JSON.stringify(run.bySeverity)}`
  )
  for (const f of run.findings) {
    console.log(
      `  - [${f.severity}] ${f.surfaceId} (${f.category}) x${f.occurrences}: ${f.description}`
    )
  }
  expect(run.surfaceCount).toBeGreaterThan(0)
})
