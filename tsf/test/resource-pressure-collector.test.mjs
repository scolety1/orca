// Real os.freemem()/os.totalmem() evidence collector -- proves it never
// claims a richer evidence source than it has, and computes usedPercent
// honestly from injected values (no dependency on the real host's memory).
import assert from 'node:assert/strict'
import test from 'node:test'
import { collectHostMemoryEvidence } from '../server/resource-pressure-collector.mjs'

test('the real os module produces finite, non-negative values on this host', () => {
  const evidence = collectHostMemoryEvidence()
  assert.equal(typeof evidence.totalBytes, 'number')
  assert.equal(typeof evidence.freeBytes, 'number')
  assert.ok(evidence.totalBytes > 0)
  assert.ok(evidence.freeBytes >= 0)
  assert.equal(evidence.availableBytes, evidence.freeBytes)
})

test('an injected os module is used verbatim, never the real host', () => {
  const fakeOs = { totalmem: () => 1000, freemem: () => 250 }
  const evidence = collectHostMemoryEvidence(fakeOs)
  assert.deepEqual(evidence, { totalBytes: 1000, freeBytes: 250, availableBytes: 250, usedPercent: 75 })
})

test('a zero totalBytes reading (degenerate/fake evidence) reports usedPercent honestly as null, not a divide-by-zero artifact', () => {
  const evidence = collectHostMemoryEvidence({ totalmem: () => 0, freemem: () => 0 })
  assert.equal(evidence.usedPercent, null)
})
