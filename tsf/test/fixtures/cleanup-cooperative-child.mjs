// Disposable test fixture: a child process that cooperates with graceful
// retirement over IPC (server/cleanup-session-retirement.mjs's preferred
// path), exiting cleanly on TSF_CLEANUP_GRACEFUL_RETIRE rather than needing
// to be forcefully stopped.
process.send('ready')
process.on('message', (message) => {
  if (message?.type === 'TSF_CLEANUP_GRACEFUL_RETIRE') {
    process.exit(0)
  }
})
setInterval(() => {}, 1000)
