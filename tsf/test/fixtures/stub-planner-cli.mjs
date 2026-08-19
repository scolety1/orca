#!/usr/bin/env node
// Stands in for a real provider CLI (claude/codex) in tests, driven entirely
// by env vars so tests never spend real API cost or depend on network/auth.
// Emulates the real `claude -p ... --output-format json` contract observed
// from the actual binary, including its actual failure shapes: a rejected
// --resume prints plain text and exits 1 (not JSON).
const args = process.argv.slice(2)
const mode = process.env.STUB_MODE || 'success'
const sessionId = process.env.STUB_SESSION_ID || 'stub-session-aaaa'
const model = process.env.STUB_MODEL || 'stub-model-x'

function argValue(flag) {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1]
}

if (process.env.STUB_DEBUG_FILE) {
  const fs = await import('node:fs')
  fs.writeFileSync(process.env.STUB_DEBUG_FILE, JSON.stringify({ args }, null, 2))
}

if (mode === 'timeout') {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  process.exit(0)
}

if (mode === 'malformed') {
  process.stdout.write('this is not json')
  process.exit(0)
}

if (mode === 'provider-error') {
  process.stdout.write(JSON.stringify({ is_error: true, result: 'deliberate stub provider error', session_id: sessionId }))
  process.exit(0)
}

const resume = argValue('--resume')
if (resume && resume !== sessionId) {
  process.stderr.write(`No conversation found with session ID: ${resume}`)
  process.exit(1)
}

const prompt = argValue('-p') || ''
process.stdout.write(
  JSON.stringify({
    is_error: false,
    result: `stub-answer-for::${prompt}`,
    session_id: sessionId,
    total_cost_usd: 0.001,
    modelUsage: { [model]: { canonicalModel: model } }
  })
)
process.exit(0)
