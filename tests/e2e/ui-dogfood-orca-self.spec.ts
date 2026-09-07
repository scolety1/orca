/**
 * Phase 1 (UI_DOGFOOD_AGENT_V0), 1C/1E: the golden dogfood proof -- runs
 * the REAL, generic dogfood contract (tsf/domain/ui-dogfood-contract.mjs)
 * against a real slice of Orca's OWN UI, driven through the already-
 * running `orcaPage` fixture (see tests/e2e/helpers/orca-app.ts's own
 * header: `_electron.launch()`, isolated userData, seeded repo -- reused
 * here rather than re-implemented). This is the one place this program's
 * dogfood capability is proven against a real, rendered app instead of
 * fakes (unit coverage for the pure domain logic lives in tsf/test/).
 *
 * This asserts a REAL, specific finding -- not "zero or more, whatever
 * happens": a full sweep of every Orca settings pane at a 390px mobile
 * viewport (tests/e2e/ui-dogfood-orca-self-full-sweep.spec.ts, run
 * manually -- see its own header) found that SettingsSection.tsx's header
 * row consistently overflows the mobile viewport across every pane. The
 * appearance pane is asserted here as the fast, deterministic proof that
 * this real, reproducible defect is still detected.
 */
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { runDogfoodPass } from '../../tsf/domain/ui-dogfood-contract.mjs'
import { attachConsoleNetworkCapture } from '../../tsf/adapters/browser-console-network-capture.mjs'
import {
  buildOrcaSurfaceStrategy,
  detectOrcaSettingsRenderFindings
} from '../../tsf/adapters/orca-dogfood-surfaces.mjs'
import { createDomOverflowDetector } from '../../tsf/adapters/dom-overflow-detector.mjs'

test.describe('UI dogfood (Phase 1 UI_DOGFOOD_AGENT_V0)', () => {
  test("dogfoods a real slice of Orca's own UI across desktop+mobile and reports a real, specific defect", async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)

    const detectOverflow = createDomOverflowDetector({
      rootSelector: '[data-settings-section]',
      includeSelector: 'settings-'
    })
    let screenshotIndex = 0

    // launch()/close() are no-ops: the instance is the already-running,
    // isolated Electron app this fixture launched -- teardown is the
    // fixture's job, not the dogfood contract's, when reused this way.
    const descriptor = {
      targetId: 'orca-self-e2e',
      displayName: 'Orca (E2E)',
      launch: async () => ({ page: orcaPage, close: async () => {} }),
      surfaceStrategy: buildOrcaSurfaceStrategy({ paneIds: ['general', 'appearance', 'terminal'] }),
      viewports: ['desktop', 'mobile']
    }

    const run = await runDogfoodPass(descriptor, {
      attachCapture: attachConsoleNetworkCapture,
      detectSurfaceFindings: async (page, surface, viewportId) => [
        ...(await detectOrcaSettingsRenderFindings(page, surface)),
        ...(await detectOverflow(page, surface, viewportId))
      ],
      // Real screenshot evidence per surface/viewport combination -- the
      // "before" half of the before/after evidence this contract produces.
      captureScreenshot: async (page, surfaceId, viewportId) => {
        screenshotIndex += 1
        const filePath = path.join(
          testInfo.outputDir,
          `${screenshotIndex}-${surfaceId}-${viewportId}.png`
        )
        await page.screenshot({ path: filePath })
        return { surfaceId, viewportId, filePath }
      }
    })

    // Real structural proof this actually walked the real app: 4 surfaces
    // (main shell + 3 settings panes) x 2 viewports, one real screenshot
    // each.
    expect(run.schemaVersion).toBe('TSF_UI_DOGFOOD_RUN_V1')
    expect(run.surfaceCount).toBe(4)
    expect(run.viewports).toEqual(['desktop', 'mobile'])
    expect(run.screenshots.length).toBe(8)

    // REQUIRED PROOF this finds something real, not manufactured: the
    // known, reproducible mobile-viewport header overflow on a real
    // settings pane.
    const appearanceMobileOverflow = run.findings.find(
      (f) => f.surfaceId === 'settings-appearance' && f.category === 'CLIPPED_CONTENT'
    )
    expect(
      appearanceMobileOverflow,
      'expected a real CLIPPED_CONTENT finding on settings-appearance at mobile width'
    ).toBeTruthy()
    expect(appearanceMobileOverflow.severity).toBe('P2')
    expect(appearanceMobileOverflow.autoFixEligible).toBe(true)

    // Every finding this real run actually produced must be well-formed.
    for (const finding of run.findings) {
      expect(['P0', 'P1', 'P2', 'P3']).toContain(finding.severity)
      expect(typeof finding.autoFixEligible).toBe('boolean')
      expect(finding.surfaceId.length).toBeGreaterThan(0)
    }

    // eslint-disable-next-line no-console -- deliberate: real findings from
    // this golden run belong in CI/local test output for a human to read,
    // this is the actual dogfood evidence, not incidental debug noise.
    console.log(
      `[ui-dogfood golden run] ${run.totalFindings} finding(s) across ${run.surfaceCount} surface(s): ${JSON.stringify(run.bySeverity)}\n${run.findings.map((f) => `  - [${f.severity}] ${f.surfaceId} (${f.category}): ${f.description}`).join('\n')}`
    )
  })
})
