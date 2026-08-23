// Real V1 stabilization finding (Planner Chat live-use defect): a real,
// live-reproduced defect where a healthy PLANNER_DEEP · Claude Code ·
// Sonnet 5 indicator (live:true, a real session/model observed) still
// answered with a generic/self-reported-truncated response
// ("Hi! How can I help you today?" / "It looks like your message got cut
// off...") to real project-grounded questions. Root cause: on Windows,
// resolveAgentEntry's last-resort PATH fallback could return
// { viaShell: true }, and Node's shell:true spawn does ZERO argument
// escaping (its own DEP0190 warning) -- a large/multi-line argument (the
// real system prompt, or even just a multi-word chat message) is silently
// shredded into wrongly-split fragments by cmd.exe's own re-tokenization
// before the child process ever sees it. The CLI still exits 0 with
// well-formed JSON and a real session/model, so every existing malformed-
// response/error check passes -- Claude is just honestly answering the
// corrupted fragment it actually received. Fixed in providers/
// resolve-agent-entry.mjs: the fallback never returns viaShell:true on
// Windows any more (falls through to an honest PROVIDER_UNAVAILABLE
// instead -- see test/resolve-agent-entry.test.mjs).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { invokeLivePlanner, spawnAgent } from '../server/live-planner.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')

function fixtureProject(overrides = {}) {
  return {
    id: 'arg-safety-project',
    displayName: 'Arg Safety Project',
    purpose: 'Prove message integrity survives transport',
    branch: 'main',
    lifecycle: 'ONBOARDED',
    mission: { blockedReason: null },
    health: { status: 'HEALTHY', findings: [] },
    release: {
      stable: {},
      testing: 'UNKNOWN',
      adoption: 'NOT_APPLICABLE_ONBOARDING_ONLY',
      published: 'UNCHANGED'
    },
    candidate: null,
    receipts: { chain: [] },
    evidence: {},
    ...overrides
  }
}

const baseOpState = { plannerSessions: {}, usageMode: 'ECONOMY', workSet: [], projectMemory: {} }

// Every real message shape message D's spec called out: short, long,
// multiline, and punctuation/quote-heavy -- each must arrive at the real
// provider CLI byte-for-byte identical to what Tim typed, through the
// actual production spawnAgent/runOnce path (viaShell:false).
const MESSAGES = {
  short: 'hi',
  long: `${'a'.repeat(3800)} -- a genuinely long message, near the real 4000-char UI cap`,
  multiline: 'line one\nline two\n\nline four after a blank line\n\ttabbed line five',
  punctuation:
    'quotes "like this" and \'like this\', braces {like: "this"}, a backslash \\ and a % percent & ampersand | pipe ^ caret'
}

for (const [label, message] of Object.entries(MESSAGES)) {
  test(`message integrity: a real ${label} message survives transport byte-for-byte via the real spawn path`, async () => {
    const debugFile = path.join(mkdtempSync(path.join(tmpdir(), 'tsf-arg-safety-')), 'debug.json')
    const original = process.env.TSF_PLANNER_CLAUDE_COMMAND
    const originalDebug = process.env.STUB_DEBUG_FILE
    process.env.TSF_PLANNER_CLAUDE_COMMAND = STUB
    process.env.STUB_DEBUG_FILE = debugFile
    try {
      const result = await invokeLivePlanner({
        project: fixtureProject(),
        message,
        opState: baseOpState
      })
      assert.equal(result.ok, true)
      const debug = JSON.parse(readFileSync(debugFile, 'utf8'))
      const promptIndex = debug.args.indexOf('-p')
      assert.notEqual(promptIndex, -1)
      assert.equal(
        debug.args[promptIndex + 1],
        message,
        'the exact message received by the provider CLI must match what was sent, unchanged'
      )
    } finally {
      if (original === undefined) {
        delete process.env.TSF_PLANNER_CLAUDE_COMMAND
      } else {
        process.env.TSF_PLANNER_CLAUDE_COMMAND = original
      }
      if (originalDebug === undefined) {
        delete process.env.STUB_DEBUG_FILE
      } else {
        process.env.STUB_DEBUG_FILE = originalDebug
      }
      rmSync(path.dirname(debugFile), { recursive: true, force: true })
    }
  })
}

// The defense-in-depth structural guard added to spawnAgent itself: even
// if resolveAgentEntry is modified again in the future and reintroduces a
// viaShell:true entry, spawnAgent must refuse it honestly rather than
// silently corrupt the call -- a real process must never actually be
// spawned in this case.
test('spawnAgent: refuses a viaShell:true entry honestly, never spawns a process', async () => {
  const result = await spawnAgent({
    entry: { command: 'this-command-does-not-exist-and-must-never-run', viaShell: true },
    args: ['--should-never-be-seen'],
    cwd: process.cwd(),
    timeoutMs: 5000
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'PROVIDER_UNAVAILABLE')
})

// Documents the real corruption mechanism directly -- the permanent
// regression anchor for why resolveAgentEntry must never return
// viaShell:true with a complex argument on Windows again. Only meaningful
// on win32 (the corruption is a cmd.exe re-tokenization behavior; POSIX
// spawn execs directly with no shell re-parsing).
test('REQUIRED PROOF: Windows shell:true silently corrupts a large multi-line argument (the real mechanism, reproduced directly)', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('shell:true argument corruption is a Windows-specific cmd.exe behavior')
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-shell-true-repro-'))
  const echoScript = path.join(dir, 'echo-argv.mjs')
  const outFile = path.join(dir, 'received.json')
  writeFileSync(
    echoScript,
    "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))\n"
  )
  // Mirrors the real shape live-planner.mjs's buildSystemPrompt produces:
  // multi-line, JSON-embedded, well over a single "word".
  const largeArg = JSON.stringify(
    {
      note: 'a real project context capsule',
      lines: Array(30).fill('some real fact about the project')
    },
    null,
    2
  )
  const shortWords = 'hi can you tell me about this project'

  await new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [echoScript, outFile, '-p', shortWords, '--system-prompt', largeArg],
      {
        cwd: dir,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore']
      }
    )
    child.on('error', reject)
    child.on('close', () => resolve())
  })

  const received = JSON.parse(readFileSync(outFile, 'utf8'))
  const promptIndex = received.indexOf('-p')
  const systemPromptIndex = received.indexOf('--system-prompt')
  // The real defect: neither argument survives shell:true's naive
  // concatenation-then-cmd.exe-re-tokenization intact.
  assert.notEqual(
    received[promptIndex + 1],
    shortWords,
    'a multi-word message must NOT survive shell:true unmangled -- this is the real corruption'
  )
  assert.notEqual(
    received[systemPromptIndex + 1],
    largeArg,
    'a large multi-line system prompt must NOT survive shell:true unmangled -- this is the real corruption'
  )
  rmSync(dir, { recursive: true, force: true })
})
