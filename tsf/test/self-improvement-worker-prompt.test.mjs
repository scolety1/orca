import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAuthorityEnvelope } from '../domain/self-improvement-authority-envelope.mjs'
import { buildWorkerPrompt } from '../domain/self-improvement-worker-prompt.mjs'

const finding = {
  status: 'ELIGIBLE_FOR_AUTOFIX',
  findingId: 'finding:abc',
  sourceDetector: 'RUNTIME_ASSERTION',
  severity: 'P1',
  confidence: 0.95,
  evidence: { assertion: 'expected true, got false' },
  reproduction: { command: 'node --test tsf/test/fixture.test.mjs' },
  affectedSurface: 'tsf/domain/fixture.mjs',
  candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['tsf/domain/fixture.mjs'] },
  verificationMethod: 'RECHECK'
}

test('the prompt is built entirely from the finding/envelope -- every structured field appears verbatim', () => {
  const envelope = buildAuthorityEnvelope(finding, 'mission:selfimprove:abc')
  const prompt = buildWorkerPrompt(finding, envelope)
  assert.match(prompt, /RUNTIME_ASSERTION/)
  assert.match(prompt, /expected true, got false/)
  assert.match(prompt, /node --test tsf\/test\/fixture\.test\.mjs/)
  assert.match(prompt, /tsf\/domain\/fixture\.mjs/)
})

test('forbidden surfaces are always listed, even without an explicit filesHint entry naming them', () => {
  const envelope = buildAuthorityEnvelope(finding, 'mission:selfimprove:abc')
  const prompt = buildWorkerPrompt(finding, envelope)
  for (const forbidden of envelope.forbiddenPathPrefixes) {
    assert.ok(prompt.includes(forbidden), `prompt must name forbidden path ${forbidden}`)
  }
  for (const structural of envelope.structurallyForbiddenSurfaces) {
    assert.ok(prompt.includes(structural.surface))
  }
})

test('an empty allowedScope produces an explicit stay-minimal instruction, not a silent free pass', () => {
  const noScopeFinding = { ...finding, candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: [] } }
  const envelope = buildAuthorityEnvelope(noScopeFinding, 'mission:selfimprove:abc')
  const prompt = buildWorkerPrompt(noScopeFinding, envelope)
  assert.match(prompt, /stay MINIMAL/)
})

test('the prompt requires the worker to self-verify reproduction and never push/merge canonical directly', () => {
  const envelope = buildAuthorityEnvelope(finding, 'mission:selfimprove:abc')
  const prompt = buildWorkerPrompt(finding, envelope)
  assert.match(prompt, /Run the reproduction criteria above yourself and CONFIRM/)
  assert.match(prompt, /NEVER attempt to push, merge, or write to the canonical repository directly/)
})

test('never free-form "improve this" text -- the prompt always names ONE specific finding', () => {
  const envelope = buildAuthorityEnvelope(finding, 'mission:selfimprove:abc')
  const prompt = buildWorkerPrompt(finding, envelope)
  assert.doesNotMatch(prompt.toLowerCase(), /improve this\b/)
  assert.match(prompt, /Fix EXACTLY ONE defect/)
})
