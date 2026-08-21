import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// M6 required real proof: this whole milestone is about TSF's real Orca
// PLUGIN actually loading and running -- every other M6 test (main-plugin
// .test.mjs included) calls activate()/deactivate() as plain JS functions,
// which never exercises Orca's real plugin host machinery (a genuine
// child_process.fork, the real worker IPC protocol, real command
// dispatch). This test does: it bundles the REAL, unmodified
// src/main/plugins/plugin-host-entry.ts and plugin-host-process.ts (core
// Orca files, read-only, never touched by this program) via esbuild --
// the exact same technique core's own
// plugin-worker-supervision.integration.test.ts already uses -- so a
// genuine forked worker process runs our REAL, unmodified tsf/main.mjs,
// and we invoke its commands through the real IPC channel, not a direct
// function call.
//
// esbuild is not a declared dependency of this project (it's only ever an
// incidental transitive one, e.g. via vite/electron-vite) -- a bare
// checkout or a worktree without a full `pnpm install` genuinely won't
// have it (confirmed: the tsf/main worktree itself has almost no
// node_modules at all). Rather than hard-failing the whole suite in that
// environment, this test skips itself with a clear, honest reason when
// esbuild isn't resolvable, and runs the real proof whenever it is.
const REPO_ROOT = join(import.meta.dirname, '..', '..')
const TSF_ROOT = join(import.meta.dirname, '..')

async function waitForRealServer(base, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/meta`)
      if (res.ok) {
        return res
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw lastError ?? new Error('server did not become ready in time')
}

test(
  "the real, unmodified tsf plugin loads through Orca's real plugin host (real fork, real IPC), " +
    'registers all 4 commands, really spawns tsf/server, and cleanly tears down on real shutdown',
  async (t) => {
    // Node statically detects a LITERAL string import() specifier during
    // module linking and eagerly resolves it there -- if the package is
    // wholly absent, that throws before this function even starts
    // running, bypassing any try/catch wrapped around it (confirmed:
    // `import('esbuild')` crashes the whole process even inside try/catch;
    // `import(esbuildSpecifier)` with the same string in a variable does
    // not). Routing the specifier through a variable defeats that static
    // analysis so a missing esbuild degrades to a catchable rejection.
    const esbuildSpecifier = 'esbuild'
    let build
    try {
      ;({ build } = await import(esbuildSpecifier))
    } catch (error) {
      t.skip(
        `esbuild is not resolvable in this environment (${error.code ?? error.message}) -- ` +
          'this real-proof test needs it to bundle the real plugin-host-entry.ts/plugin-host-process.ts; ' +
          'run `pnpm install` at the repo root to get it (a transitive dependency of vite/electron-vite).'
      )
      return
    }

    const bundleDir = await mkdtemp(join(tmpdir(), 'tsf-plugin-real-proof-'))
    let worker
    try {
      const workerEntryPath = join(bundleDir, 'plugin-host-entry.cjs')
      await build({
        entryPoints: [join(REPO_ROOT, 'src', 'main', 'plugins', 'plugin-host-entry.ts')],
        outfile: workerEntryPath,
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        sourcemap: false,
        logLevel: 'silent'
      })
      const hostProcessBundlePath = join(bundleDir, 'plugin-host-process.cjs')
      await build({
        entryPoints: [join(REPO_ROOT, 'src', 'main', 'plugins', 'plugin-host-process.ts')],
        outfile: hostProcessBundlePath,
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        sourcemap: false,
        logLevel: 'silent'
      })
      const { startPluginWorker } = await import(pathToFileURL(hostProcessBundlePath).href)

      const logs = []
      worker = await startPluginWorker({
        pluginId: 'foundation',
        rootDir: TSF_ROOT,
        mainEntry: 'main.mjs',
        entryPath: workerEntryPath,
        grantedCapabilities: ['workspace:read', 'storage', 'events:subscribe'],
        executeHostCall: async () => ({ ok: true, value: { value: undefined } }),
        log: (level, line) => logs.push({ level, line })
      })

      assert.deepEqual(
        [...worker.commands].sort(),
        ['tsf-foundation-health', 'tsf-open-ui', 'tsf-set-usage-mode', 'tsf-status'].sort()
      )

      // Real command dispatch through the real IPC channel -- not a direct
      // function call.
      const health = await worker.invokeCommand('tsf-foundation-health')
      assert.equal(health.product, 'Thousand Sunny Fleet — Orca Foundation')

      // The real, unmodified activate() -- running inside the real forked
      // process -- genuinely spawned tsf/server on its real default port.
      // Deliberately NOT invoking tsf-open-ui here: that command really
      // opens the OS's default browser, an unacceptable side effect for an
      // automated test; open-url-command.test.mjs already covers its logic
      // in isolation, and this test's job is proving the load/spawn path.
      //
      // Unlike main-plugin.test.mjs's ephemeral-port tests, this one is
      // pinned to the real default port 4610: proving the REAL activate()
      // with no testOverrides is the whole point, and that code path has
      // no env-var override for the port. If something else already owns
      // 4610, this fails honestly here (a real mismatch against whatever
      // that server actually returns) rather than silently passing.
      const res = await waitForRealServer('http://127.0.0.1:4610')
      const body = await res.json()
      assert.equal(body.product, 'Thousand Sunny Fleet — Orca Foundation')
    } finally {
      // Real shutdown through the real IPC channel -- the worker's own
      // handleMessage('shutdown') calls OUR real deactivate() export,
      // which stops the real spawned tsf/server child.
      await worker?.dispose()
      await rm(bundleDir, { recursive: true, force: true })
    }

    // The real child process must genuinely be gone -- proves deactivate()
    // actually ran inside the real worker on real shutdown, not just that
    // the parent's handle was discarded.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await assert.rejects(
      () => fetch('http://127.0.0.1:4610/api/meta', { signal: AbortSignal.timeout(500) }),
      'tsf/server must not still be listening after a real plugin shutdown'
    )
  }
)
