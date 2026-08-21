// M6: builds and runs the platform-specific "open this URL in the default
// browser" command. No host API exists for this (plugin-host-api.ts's
// PLUGIN_HOST_API_V0 has no shell.openExternal-equivalent, per wave 2's
// finding) -- this is a plain, unprivileged subprocess launch from the
// plugin's own real Node process, the same class of operation as spawning
// tsf/server itself.
import { spawn } from 'node:child_process'

// Pure and unit-testable without ever spawning a real process: given a
// platform string, returns the exact {command, args, options} to run.
export function buildOpenUrlCommand(url, platform = process.platform) {
  if (platform === 'win32') {
    // `start` is a cmd.exe builtin, not an executable -- must run through a
    // shell. The empty "" first argument is start's own quirk: without it,
    // a URL containing certain characters gets misparsed as a window title.
    return { command: 'cmd', args: ['/c', 'start', '""', url], options: { shell: false } }
  }
  if (platform === 'darwin') {
    return { command: 'open', args: [url], options: { shell: false } }
  }
  return { command: 'xdg-open', args: [url], options: { shell: false } }
}

export function openUrl(url, options = {}) {
  const { platform = process.platform, spawnFn = spawn } = options
  const { command, args, options: spawnOptions } = buildOpenUrlCommand(url, platform)
  return spawnFn(command, args, { ...spawnOptions, stdio: 'ignore', detached: true })
}
