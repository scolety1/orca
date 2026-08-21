// M10: real, adapter-driven external security scanner invocation.
// Per Tim's own explicit rule, "TSF architecture must not depend on
// Trivy" (or any other specific scanner) -- the command is entirely
// env-var-configured, mirroring orca-capacity-bridge.mjs/wbs-generation.mjs's
// established provider-CLI-override pattern. Read-only: only ever passes
// a scan-target path as an argument, never a fix/remediate flag. Every
// failure class is honest and distinct (never silently treated as a
// clean scan -- acceptance item 6): SCANNER_UNAVAILABLE (not configured/
// not spawnable), SCANNER_TIMEOUT, SCANNER_ERROR (real non-zero exit),
// MALFORMED_RESPONSE (not JSON), INVALID_SCAN_RESULT (JSON but fails
// normalizeSecurityScanResult's own structural/semantic validation).
import { spawn } from 'node:child_process'
import { normalizeSecurityScanResult } from '../domain/security-health.mjs'

const DEFAULT_TIMEOUT_MS = 120000

// Read at call time, not module load -- a module-level constant would
// freeze whatever TSF_SECURITY_SCANNER_TIMEOUT_MS held at import time,
// making the override useless for any test that sets the env var after
// this module is already loaded (a real bug this review caught on the
// override's own first use: the timeout test kept timing out at the
// real 120000ms default instead of the intended short override).
// Overridable only for tests -- the real production default stays
// 120000ms. Without this override, the SCANNER_TIMEOUT path itself was
// asserted only by inspection, never actually triggered by any test (a
// real review finding).
function resolveTimeoutMs() {
  return Number(process.env.TSF_SECURITY_SCANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
}

// A single command/path, never a space-joined "command args" string --
// naive space-splitting breaks the instant either the configured path or
// process.execPath itself contains a space (e.g. a real "C:\Program
// Files\nodejs\node.exe" -- a real bug this exact test file caught on
// first run). Mirrors orca-capacity-bridge.mjs's own established
// .mjs/.js-detection convention: a script path runs via node's own
// execPath as a single argument, never shell-tokenized.
function resolveScannerCommand() {
  const configured = process.env.TSF_SECURITY_SCANNER_COMMAND
  if (!configured) {
    return null
  }
  if (configured.endsWith('.mjs') || configured.endsWith('.js')) {
    return { command: process.execPath, args: [configured] }
  }
  return { command: configured, args: [] }
}

export async function runSecurityScan(repoPath) {
  const entry = resolveScannerCommand()
  if (!entry) {
    return {
      ok: false,
      reason: 'SCANNER_UNAVAILABLE',
      detail:
        'No TSF_SECURITY_SCANNER_COMMAND configured -- security scanning is an optional, adapter-driven capability, not a required dependency.'
    }
  }
  const timeoutMs = resolveTimeoutMs()
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(entry.command, [...entry.args, repoPath], { windowsHide: true })
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill()
      resolve({
        ok: false,
        reason: 'SCANNER_TIMEOUT',
        detail: `no response within ${timeoutMs}ms`
      })
    }, timeoutMs)

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        ok: false,
        reason: 'SCANNER_UNAVAILABLE',
        detail: `${entry.command} could not be spawned`
      })
    })
    child.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        resolve({
          ok: false,
          reason: 'SCANNER_ERROR',
          detail: (stderr || stdout).trim().slice(0, 2000) || `exit code ${code}`
        })
        return
      }
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        resolve({ ok: false, reason: 'MALFORMED_RESPONSE', detail: stdout.slice(0, 500) })
        return
      }
      try {
        resolve({ ok: true, result: normalizeSecurityScanResult(parsed) })
      } catch (error) {
        resolve({ ok: false, reason: 'INVALID_SCAN_RESULT', detail: error.message })
      }
    })
  })
}
