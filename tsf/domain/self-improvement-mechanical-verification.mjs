// Native Self-Improvement Loop V1, Phase 9: minimal glue closing the real
// DETECTED -> VERIFIED gap Wave A/B left open (no detector in this program
// yet produces one, but self-improvement-finding.mjs's own STATUS_ALLOWED
// table requires it before any autofix-eligibility classification can ever
// run). Pure: takes an ALREADY-GATHERED real reproduction-command result
// (server/self-improvement-verifier-dispatch.mjs's own runCommand, reused
// directly -- never a second reproduction-check implementation) and maps it
// onto a real finding-status transition. Only ever applies to a finding
// whose reproduction is mechanically checkable (reproduction.command) --
// anything else fails closed rather than guessing a verdict.
import { transitionFinding } from './self-improvement-finding.mjs'

export function classifyMechanicalVerification(finding, reproductionResult) {
  if (typeof finding?.reproduction?.command !== 'string' || !finding.reproduction.command.trim()) {
    return { verifiable: false, reason: 'NO_MECHANICAL_REPRODUCTION_COMMAND' }
  }
  // A "finding" whose own reproduction command does not actually fail was
  // never a real defect -- caught here rather than silently verified.
  if (reproductionResult.passed) {
    return { verifiable: true, status: 'REJECTED_FALSE_POSITIVE', reason: 'REPRODUCTION_DID_NOT_FAIL' }
  }
  return { verifiable: true, status: 'VERIFIED', reason: 'MECHANICAL_REPRODUCTION_CONFIRMED_FAILING' }
}

export function applyMechanicalVerification(finding, reproductionResult, clock) {
  const classification = classifyMechanicalVerification(finding, reproductionResult)
  if (!classification.verifiable) {
    const error = new Error(`cannot mechanically verify finding ${finding.findingId}: ${classification.reason}`)
    error.code = 'TSF_SELF_IMPROVEMENT_NOT_MECHANICALLY_VERIFIABLE'
    throw error
  }
  return transitionFinding(
    finding,
    classification.status,
    { reason: classification.reason, evidence: [{ exitCode: reproductionResult.exitCode ?? null }] },
    clock
  )
}
