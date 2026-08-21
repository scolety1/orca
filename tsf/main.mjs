import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { startServerLifecycle } from './server/server-process-lifecycle.mjs'
import { openUrl } from './server/open-url-command.mjs'

const FOUNDATION = Object.freeze({
  foundation: 'ORCA',
  upstreamVersion: 'v1.4.184',
  upstreamCommit: '2307f2ebbe1c1e737c0b12d920bb0a208332db2c',
  product: 'Thousand Sunny Fleet — Orca Foundation',
  migrationWave: 4,
  realProjectWork: 'NOT_AUTHORIZED_FOR_THIS_RUNWAY',
  upstreamCoreFilesModified: 0
})

// M6: the port tsf/server listens on when spawned by this plugin. Fixed
// rather than configurable for now -- EADDRINUSE is already treated as
// "a TSF server is likely already running", not a fatal error.
const TSF_SERVER_PORT = 4610

let activeLifecycle = null

function realSpawnFn(serverEntryPath, port) {
  return spawn(process.execPath, [serverEntryPath], {
    env: { ...process.env, TSF_API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

// `testOverrides` is never passed by the real host (plugin-host-runtime.ts
// calls `activate(orca)` with exactly one argument) -- it exists only so
// tsf/test/main-plugin.test.mjs can run a genuine end-to-end spawn against
// an ephemeral port and the real server entry, rather than either mocking
// child_process or hardcoding a fixed port a test run could collide with.
export default function activate(orca, testOverrides = {}) {
  // Guard against a re-entrant activate() (e.g. a plugin-reload edge case)
  // silently losing the previous lifecycle's real child-process handle --
  // stop it first rather than overwriting the reference and orphaning it.
  activeLifecycle?.stop()

  // M6: spawn tsf/server (serving both /api and the built tsf/ui SPA, per
  // static-ui-server.mjs) as a real child process for as long as this
  // plugin stays active -- "connects to/starts required local TSF/Orca
  // services" without Tim running any command. See server-process-
  // lifecycle.mjs for the bounded-backoff restart / already-running logic.
  const serverPort = testOverrides.port ?? TSF_SERVER_PORT
  // tsf/ui/dist is gitignored and nothing builds it automatically -- a
  // fresh checkout has no built UI until `cd tsf/ui && npm run build` runs
  // once. static-ui-server.mjs already fails safely (404, not a crash)
  // when it's missing, but that failure is otherwise silent; this makes
  // the real, common first-run cause visible instead of a mysterious
  // blank page.
  const uiIndexPath =
    testOverrides.uiIndexPath ?? join(import.meta.dirname, 'ui', 'dist', 'index.html')
  if (!existsSync(uiIndexPath)) {
    orca.log(
      '[tsf] tsf/ui/dist not found -- the TSF UI will 404 until you run `cd tsf/ui && npm install && npm run build` once.'
    )
  }
  activeLifecycle = startServerLifecycle({
    spawnFn: testOverrides.spawnFn ?? realSpawnFn,
    serverEntryPath:
      testOverrides.serverEntryPath ?? join(import.meta.dirname, 'server', 'http-server.mjs'),
    port: serverPort,
    log: (level, message) => orca.log(`[tsf-server:${level}] ${message}`.slice(0, 8192))
  })
  orca.commands.register('tsf-foundation-health', async () => ({ ...FOUNDATION }))
  // M6: no host API can open a window/URL on the plugin's behalf (no
  // shell.openExternal-equivalent exists, per wave 2's finding) -- this
  // spawns the OS's own "open a URL" command directly, satisfying
  // "double-click launch" as one command-palette invocation.
  orca.commands.register('tsf-open-ui', async () => {
    const openFn = testOverrides.openUrl ?? openUrl
    openFn(`http://127.0.0.1:${serverPort}`)
    return { ok: true, url: `http://127.0.0.1:${serverPort}` }
  })
  orca.commands.register('tsf-status', async () => {
    const usage = await orca.host.call('storage.get', { key: 'usageMode' })
    const activeFleet = await orca.host.call('storage.get', { key: 'activeFleet' })
    const workSet = await orca.host.call('storage.get', { key: 'workSet' })
    return {
      ...FOUNDATION,
      usageMode: usage?.value ?? 'BALANCED',
      activeFleet: activeFleet?.value ?? [],
      workSet: workSet?.value ?? [],
      authority: 'STATUS_ONLY_NO_EXECUTION_AUTHORITY'
    }
  })
  orca.commands.register('tsf-set-usage-mode', async (args) => {
    const mode = args?.mode
    if (!['TEST_MINIMAL', 'ECONOMY', 'BALANCED', 'MAXIMUM'].includes(mode)) {
      throw new Error('mode must be TEST_MINIMAL, ECONOMY, BALANCED, or MAXIMUM')
    }
    await orca.host.call('storage.set', { key: 'usageMode', value: mode })
    return { ok: true, mode, authority: 'ROUTING_AND_BUDGET_ONLY' }
  })
  for (const event of ['worktree.created', 'worktree.removed', 'agent.status.changed']) {
    orca.events.on(event, (payload) => {
      orca.log(`TSF observed ${event}: ${JSON.stringify(payload).slice(0, 2048)}`)
    })
  }
}

// M6: clean shutdown -- kills the spawned tsf/server child (if this plugin
// activation ever started one) rather than leaving it orphaned when Orca
// disables/reloads the plugin or exits.
export function deactivate() {
  activeLifecycle?.stop()
  activeLifecycle = null
}

export { FOUNDATION }
