// Live robots.txt preflight: retrieves and evaluates a candidate URL's
// robots.txt, producing bounded decision evidence for the access gate.
// Robots permission stays a distinct concern from the broader terms/rights
// gate in web-source-access-gate.mjs -- this module only ever produces the
// `robotsDecision` INPUT that gate already consumes; it never grants access
// by itself.
//
// RFC 9309 interpretation used here (documented per V0.5's requirement):
//  - 200 OK, text/plain, parseable content -> apply matched rules (§2.2).
//  - 404 (or any 4xx) -> "unavailable", RFC 9309 §2.3.1.2 permits treating
//    this as no restrictions specified. Represented as outcome
//    ROBOTS_NOT_FOUND, mapped to gate input 'ALLOWED' -- but this can never
//    independently reach PUBLIC_ALLOWED because the gate still requires a
//    separate explicitPublicAllowance affirmation.
//  - 5xx / network error / timeout -> RFC 9309 §2.3.1.3 permits crawlers to
//    treat this as "temporarily unavailable" and defer/retry, or as a full
//    disallow. This module takes the more conservative reading of "we do
//    not actually know": mapped to gate input 'UNKNOWN' (fail-closed,
//    REQUIRES_REVIEW), not 'DISALLOWED' and not 'ALLOWED'.
//  - Unparseable/invalid content, or an unsafe/blocked redirect -> also
//    'UNKNOWN' -- indeterminate evidence must never be read as permission.

import { createHash } from 'node:crypto'
import { fetchRobotsTxt, TSF_WEB_ACQUISITION_USER_AGENT } from '../adapters/robots-txt-fetch.mjs'
import { parseRobotsTxt, evaluateRobotsRules } from './robots-txt-parser.mjs'

export const ROBOTS_PREFLIGHT_SCHEMA = 'WEB_SOURCE_ROBOTS_PREFLIGHT_V0'

function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

function buildEvidence({
  outcome,
  robotsDecisionForGate,
  fetchResult,
  matchedRule,
  retainRawRobotsContent,
  clock
}) {
  const robotsContentRetained = Boolean(retainRawRobotsContent && fetchResult?.ok)
  return {
    schemaVersion: ROBOTS_PREFLIGHT_SCHEMA,
    outcome,
    robotsDecisionForGate,
    userAgentToken: TSF_WEB_ACQUISITION_USER_AGENT,
    retrievalTime: clock().toISOString(),
    finalUrl: fetchResult?.finalUrl ?? null,
    httpStatus: fetchResult?.httpStatus ?? null,
    contentHash: fetchResult?.ok ? sha256(fetchResult.bodyText) : null,
    matchedRule,
    robotsContentRetained,
    robotsContent: robotsContentRetained ? fetchResult.bodyText : null
  }
}

/**
 * Performs a bounded robots.txt preflight for `url`. Never retains raw
 * robots.txt content unless `retainRawRobotsContent` is explicitly true.
 */
export async function performRobotsPreflight({
  url,
  fetchOptions = {},
  retainRawRobotsContent = false,
  clock = () => new Date()
}) {
  let target
  try {
    target = new URL(url)
  } catch {
    return buildEvidence({ outcome: 'ROBOTS_INVALID', robotsDecisionForGate: 'UNKNOWN', fetchResult: null, matchedRule: null, retainRawRobotsContent, clock })
  }
  const fetchResult = await fetchRobotsTxt(target.origin, { fetchOptions })

  if (!fetchResult.ok) {
    if (
      fetchResult.reason === 'HTTP_ERROR' &&
      fetchResult.httpStatus >= 400 &&
      fetchResult.httpStatus < 500
    ) {
      return buildEvidence({
        outcome: 'ROBOTS_NOT_FOUND',
        robotsDecisionForGate: 'ALLOWED',
        fetchResult,
        matchedRule: null,
        retainRawRobotsContent,
        clock
      })
    }
    if (fetchResult.reason === 'SSRF_BLOCKED' || fetchResult.reason === 'TOO_MANY_REDIRECTS') {
      return buildEvidence({
        outcome: 'ROBOTS_UNSAFE_REDIRECT',
        robotsDecisionForGate: 'UNKNOWN',
        fetchResult,
        matchedRule: null,
        retainRawRobotsContent,
        clock
      })
    }
    if (fetchResult.reason === 'UNSUPPORTED_CONTENT_TYPE') {
      return buildEvidence({
        outcome: 'ROBOTS_INVALID',
        robotsDecisionForGate: 'UNKNOWN',
        fetchResult,
        matchedRule: null,
        retainRawRobotsContent,
        clock
      })
    }
    // NETWORK_ERROR, TIMEOUT, RESPONSE_TOO_LARGE, remaining HTTP_ERROR (5xx) statuses
    return buildEvidence({
      outcome: 'ROBOTS_UNREACHABLE',
      robotsDecisionForGate: 'UNKNOWN',
      fetchResult,
      matchedRule: null,
      retainRawRobotsContent,
      clock
    })
  }

  let parsed
  try {
    parsed = parseRobotsTxt(fetchResult.bodyText)
  } catch {
    return buildEvidence({
      outcome: 'ROBOTS_INVALID',
      robotsDecisionForGate: 'UNKNOWN',
      fetchResult,
      matchedRule: null,
      retainRawRobotsContent,
      clock
    })
  }

  const pathWithQuery = `${target.pathname}${target.search}` || '/'
  const evaluation = evaluateRobotsRules(parsed, {
    productToken: TSF_WEB_ACQUISITION_USER_AGENT,
    pathWithQuery
  })
  const outcome = evaluation.decision === 'ALLOWED' ? 'ALLOWED' : 'DISALLOWED'
  return buildEvidence({
    outcome,
    robotsDecisionForGate: evaluation.decision,
    fetchResult,
    matchedRule: evaluation.matchedRule,
    retainRawRobotsContent,
    clock
  })
}

/**
 * Merges live robots evidence into an accessInput object for
 * classifyWebSourceAccess. The evidence's robotsDecisionForGate always
 * wins -- any robotsDecision the caller tried to supply is discarded, so a
 * live DISALLOWED (or any other live outcome) can never be replaced by a
 * more favorable caller-supplied claim.
 */
export function applyRobotsEvidenceToAccessInput(robotsEvidence, callerAccessInput = {}) {
  const { robotsDecision: _ignoredCallerClaim, ...rest } = callerAccessInput
  return { ...rest, robotsDecision: robotsEvidence.robotsDecisionForGate }
}
