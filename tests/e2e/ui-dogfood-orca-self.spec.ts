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
 * This asserts REAL, specific findings -- not "zero or more, whatever
 * happens". Phase 4 reconciliation (Finding F8): a full sweep of every Orca
 * settings pane at a 390px mobile viewport originally found that the
 * SettingsRow/SettingsSubsectionHeader/SettingsSection.tsx "label + fixed-
 * width control" row grammar consistently overflowed the mobile viewport
 * across every pane. That row grammar now wraps below `sm`
 * (src/renderer/src/components/settings/SettingsFormControls.tsx,
 * SettingsSection.tsx) -- general and terminal are asserted clean below.
 * Appearance keeps exactly one known, deliberately-not-auto-fixed residual:
 * TerminalSettingsPreview.tsx pins its live xterm preview to 36 columns
 * (see that file's own PREVIEW_COLS comment -- "larger fonts clip, not
 * wrap" is an existing, intentional tradeoff) so its rendered width doesn't
 * shrink at narrow viewports; making it responsive means changing xterm
 * sizing/column behavior, not a layout-only fix, so it's recorded as a
 * recommendation rather than auto-fixed.
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

    // REQUIRED PROOF Finding F8's row-grammar fix actually holds: the
    // general and terminal panes' mobile-viewport header/row overflow is
    // gone, not just the one originally-asserted pane.
    const clippedFindings = run.findings.filter((f) => f.category === 'CLIPPED_CONTENT')
    expect(
      clippedFindings.filter((f) => f.surfaceId === 'settings-general'),
      'settings-general should have no CLIPPED_CONTENT findings after the F8 row-grammar fix'
    ).toEqual([])
    expect(
      clippedFindings.filter((f) => f.surfaceId === 'settings-terminal'),
      'settings-terminal should have no CLIPPED_CONTENT findings after the F8 row-grammar fix'
    ).toEqual([])

    // REQUIRED PROOF this still finds something real, not manufactured: the
    // one known, deliberately-not-auto-fixed xterm-preview residual (see
    // this file's own header) on settings-appearance -- and nothing else.
    const appearanceClipped = clippedFindings.filter((f) => f.surfaceId === 'settings-appearance')
    expect(appearanceClipped.length).toBe(1)
    expect(appearanceClipped[0].severity).toBe('P2')
    expect(appearanceClipped[0].description).toMatch(/xterm-screen/)

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
