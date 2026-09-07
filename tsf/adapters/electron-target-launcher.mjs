// Phase 1 (UI_DOGFOOD_AGENT_V0): standalone Electron launch adapter for the
// generic dogfood contract (tsf/domain/ui-dogfood-contract.mjs). Used by
// the Command-dispatch path (tsf/server), which runs outside any Playwright
// test file and so cannot borrow tests/e2e/helpers/orca-app.ts's test-scoped
// fixture directly -- this reuses the SAME underlying mechanism
// (`_electron.launch()`, see that fixture's own header) as a plain,
// reusable function instead. Generic: takes an appPath, never hardcodes
// Orca or any other app.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron } from '@stablyai/playwright-test'

// Builds the `launch()` half of a ui-dogfood-contract.mjs launch
// descriptor. Caller still supplies targetId/displayName/surfaceStrategy.
// Every launch gets its own throwaway userDataDir (mkdtemp) so a dogfood
// candidate never touches the operator's real profile -- deleted on close.
export function createElectronLaunchFn({ appPath, extraArgs = [], env = {} }) {
  if (typeof appPath !== 'string' || !appPath.trim()) {
    throw new Error('createElectronLaunchFn: appPath is required')
  }
  return async function launch() {
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'tsf-ui-dogfood-'))
    const app = await _electron.launch({
      args: [...extraArgs, appPath],
      env: {
        ...process.env,
        ...env,
        NODE_ENV: 'development',
        ORCA_E2E_USER_DATA_DIR: userDataDir,
        ORCA_E2E_HEADLESS: env.ORCA_E2E_HEADLESS ?? '1'
      }
    })
    // Why: matches tests/e2e/helpers/orca-app.ts's own hardened convention
    // (120s -- real Electron cold start on this host can be slow, especially
    // with an isolated userDataDir); no bare default timeout.
    const page = await app.firstWindow({ timeout: 120_000 })
    return {
      page,
      close: async () => {
        await app.close()
        rmSync(userDataDir, { recursive: true, force: true })
      }
    }
  }
}
