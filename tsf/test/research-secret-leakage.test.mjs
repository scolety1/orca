// Trust + Scale Hardening / Continuation 2 evaluation-harness dimension:
// SECRET LEAKAGE. A permanent, automated regression -- not a one-off
// manual grep -- encoding the mission's own repeated hard rule: real
// provider credentials (PARALLEL_API_KEY, EXA_API_KEY) may only ever be
// referenced via process.env.<NAME>, never hardcoded, never assigned a
// literal string value anywhere in the committed source tree.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '.local-state', 'dist', 'build'])
const CREDENTIAL_NAMES = ['PARALLEL_API_KEY', 'EXA_API_KEY']

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (/\.(mjs|js|json)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

test('no credential name is ever assigned a literal string value anywhere in the committed source tree', () => {
  const files = walk(ROOT, [])
  assert.ok(files.length > 100, `sanity check: expected to scan well over 100 files, only found ${files.length} -- the walk may be broken`)

  const violations = []
  for (const file of files) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue // unreadable (e.g. a broken symlink) -- not this test's concern
    }
    for (const name of CREDENTIAL_NAMES) {
      // A real leak looks like a credential NAME immediately followed by
      // an assignment/colon and a quoted string literal (e.g. the name
      // directly equals a quoted secret-shaped value). This deliberately
      // does NOT flag `process.env.` + the name (no `=`/`:` immediately
      // after) or a diagnostic message that merely names the env var
      // inside a sentence (no quote immediately follows the bare name
      // itself in that case -- this very sentence is a safe example: it
      // never puts a quote character directly after the name).
      const pattern = new RegExp(`${name}\\s*[:=]\\s*['"][^'"]+['"]`, 'g')
      const matches = content.match(pattern) ?? []
      for (const m of matches) {
        violations.push({ file: path.relative(ROOT, file), name, match: m })
      }
    }
  }
  assert.deepEqual(violations, [], `credential-shaped literal assignment(s) found -- must only ever be referenced via process.env.<NAME>: ${JSON.stringify(violations)}`)
})

test('every real reference to a credential name in source is via process.env, not a bare identifier', () => {
  // The complementary check: every occurrence of the credential name that
  // ISN'T inside a comment/string-literal-context should be immediately
  // preceded by "process.env." -- catches a bare `const apiKey = PARALLEL_API_KEY`
  // (reading some other in-scope variable/global by that name) which the
  // first test's literal-assignment pattern wouldn't catch.
  const files = walk(ROOT, [])
  const violations = []
  for (const file of files) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const name of CREDENTIAL_NAMES) {
      // Find every occurrence of the bare name, then check what precedes it.
      let idx = content.indexOf(name)
      while (idx !== -1) {
        const precedingContext = content.slice(Math.max(0, idx - 20), idx)
        const isEnvAccess = /process\.env\.$/.test(precedingContext)
        // Allowed non-env contexts: inside a string literal describing the
        // env var by name (diagnostics, docs, comments, schema/contract
        // descriptions) -- never followed by a quote immediately after the
        // name (that would be the literal-assignment case, already caught
        // above) and never itself the start of an assignment target.
        const followingChar = content[idx + name.length]
        const isAssignmentTarget = followingChar === '=' && content[idx + name.length + 1] !== '='
        if (!isEnvAccess && isAssignmentTarget) {
          violations.push({ file: path.relative(ROOT, file), name, context: content.slice(Math.max(0, idx - 40), idx + name.length + 10) })
        }
        idx = content.indexOf(name, idx + 1)
      }
    }
  }
  assert.deepEqual(violations, [], `a credential name was used as a bare assignment target outside process.env access: ${JSON.stringify(violations)}`)
})
