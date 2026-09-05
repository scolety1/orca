// Real host-memory evidence for the Resource Pressure Governor. TSF's own
// server (started via main.mjs's spawn) runs as a separate, plain Node
// child process -- it has no ipcMain/contextBridge access to Orca's
// enumerateProcesses() (src/main/memory/collector.ts), but on Windows
// Orca's own collectHostMemory() (src/main/memory/host-memory.ts) already
// reduces to os.freemem()/os.totalmem(); TSF loses nothing reading the
// same primitive directly. See RESOURCE_PRESSURE_GOVERNOR_REQUIREMENT.md
// section 1 for the real-code reconciliation this reflects.
import os from 'node:os'

// `osModule` is injectable so unit tests can supply fixed values directly.
// HTTP-route tests instead need a real end-to-end request to see a chosen
// tier, so this also honors two test-only env vars (both must be set,
// mirroring this codebase's existing STUB_ORCA_*/TSF_UI_STATE_FILE
// test-double convention) to deterministically fake the host reading a
// real caller has no way to set.
function envOverride() {
  const total = process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES
  const free = process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES
  if (total === undefined || free === undefined) {
    return null
  }
  return { totalmem: () => Number(total), freemem: () => Number(free) }
}

export function collectHostMemoryEvidence(osModule = envOverride() ?? os) {
  const totalBytes = osModule.totalmem()
  const freeBytes = osModule.freemem()
  // No richer "available" signal exists via this primitive on any
  // platform (Linux's MemAvailable, if ever added, would need /proc/
  // meminfo directly) -- available mirrors free honestly rather than
  // inventing an estimate.
  const availableBytes = freeBytes
  const usedPercent =
    totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : null
  return { totalBytes, freeBytes, availableBytes, usedPercent }
}
