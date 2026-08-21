// M6: manages the tsf/server child process for the desktop-launch path.
// Spawns it, restarts on an unexpected crash with a bounded backoff (never
// an infinite crash loop), treats a port already in use as "a TSF server is
// likely already running" rather than a fatal error, and stops it cleanly
// on request. spawnFn/scheduleRestart are injectable so this is unit-tested
// against a fake child process, never a real one.
const DEFAULT_MAX_RESTARTS = 3
const DEFAULT_RESTART_BACKOFF_MS = 2000

export function startServerLifecycle(options) {
  const {
    spawnFn,
    serverEntryPath,
    port,
    log = () => {},
    maxRestarts = DEFAULT_MAX_RESTARTS,
    restartBackoffMs = DEFAULT_RESTART_BACKOFF_MS,
    scheduleRestart = (fn, ms) => setTimeout(fn, ms)
  } = options

  let child = null
  let stopped = false
  let restartCount = 0
  let sawPortInUse = false

  function spawnChild() {
    const proc = spawnFn(serverEntryPath, port)
    let stderrTail = ''
    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      stderrTail = (stderrTail + text).slice(-4096)
      log('error', text)
    })
    proc.stdout?.on('data', (chunk) => log('info', chunk.toString()))
    proc.on('exit', (code, signal) => {
      if (stopped) {
        return
      }
      // Real Node net.Server errors print the literal code in the message
      // ("Error: listen EADDRINUSE: address already in use ..."); this is
      // the only reliable signal available from a plain child process's
      // stderr without a private IPC protocol of our own.
      if (/EADDRINUSE/.test(stderrTail)) {
        sawPortInUse = true
        log(
          'warn',
          `tsf/server port ${port} is already in use -- assuming a TSF server is already running, not restarting`
        )
        return
      }
      // A clean exit(0) with no signal is a graceful, intentional shutdown,
      // not a crash -- tsf/server has no self-terminating path today, but
      // restarting on top of one would be wrong if it ever grows one, and
      // would silently consume restart budget for something that isn't a
      // failure.
      if (code === 0 && signal === null) {
        log('info', 'tsf/server exited cleanly (code 0) -- not restarting')
        return
      }
      if (restartCount >= maxRestarts) {
        log(
          'error',
          `tsf/server exited (code ${code}, signal ${signal}) and exceeded ${maxRestarts} restart attempts -- giving up`
        )
        return
      }
      restartCount += 1
      log(
        'warn',
        `tsf/server exited unexpectedly (code ${code}, signal ${signal}) -- restarting (attempt ${restartCount}/${maxRestarts})`
      )
      scheduleRestart(spawnChild, restartBackoffMs)
    })
    child = proc
    return proc
  }

  spawnChild()

  return {
    stop() {
      stopped = true
      child?.kill()
    },
    getRestartCount: () => restartCount,
    getSawPortInUse: () => sawPortInUse
  }
}
