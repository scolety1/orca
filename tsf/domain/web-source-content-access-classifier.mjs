// Phase 3 Wave 2 (3E): REAL post-fetch content classification, distinct
// from web-source-access-gate.mjs's PRE-fetch, input-only gate (which only
// ever reasons about caller-supplied booleans and can never see actual
// response bytes). A 200 status is not proof of real content -- a login
// shell, paywall interstitial, or anti-bot challenge commonly returns 200.
// Fail closed: `blocked: true` on any real signal, so a caller (web-table-
// source-adapter.mjs, the local-artifact/authenticated-download workers)
// can refuse to treat the page as a genuine acquisition instead of silently
// admitting a wrong/incomplete page as if it were the real source.
//
// Deliberately signal-based, not heuristic-based (e.g. "body is short"):
// this codebase's own real fixtures (fixtures/web-table-source-acquisition/
// *.html) are all under 1KB and contain zero blocking markers -- a fuzzy
// "too short to be real" rule would false-positive-block them. Every rule
// here fires only on an explicit, structural, or coded signal.
import { ACCESS_CLASSIFICATIONS } from './web-source-access-gate.mjs'

export const CONTENT_ACCESS_CLASSIFICATION_SCHEMA = 'WEB_SOURCE_CONTENT_ACCESS_CLASSIFICATION_V1'

const ANTI_BOT_PATTERN = /checking your browser before accessing|cf-browser-verification|cf-chl-|please verify you are (a )?human|complete the security check|attention required[!]?\s*\|\s*cloudflare|\bcaptcha\b/i
const PAYWALL_PATTERN = /subscribe to (continue|read)|start your free trial|become a (member|subscriber) to (continue|read)|this (article|content|story) is (for|reserved for) subscribers|log ?in to continue reading|\bmeter ?wall\b/i
const PASSWORD_INPUT_PATTERN = /<input[^>]+type\s*=\s*["']password["']/i
const LOGIN_PATH_PATTERN = /\/(login|signin|sign-in|auth)(?:[/?]|$)/i
// A password field alongside real, substantial page content (a real table
// and enough body to plausibly be an article, not just a bare login shell)
// is genuinely ambiguous -- e.g. a news site's own header login widget
// sitting above a real, freely-readable table. Confidently classifying
// either way here would be a fabrication; PUBLIC_TERMS_UNCLEAR (this
// codebase's existing "fail closed pending operator review" value) is the
// honest outcome.
const SUBSTANTIAL_CONTENT_MIN_LENGTH = 1500

function classification(accessClassification, blocked, signalsDetected, decisionReason) {
  if (!ACCESS_CLASSIFICATIONS.includes(accessClassification)) {
    throw new Error(`Unknown access classification: ${accessClassification}`)
  }
  return {
    schemaVersion: CONTENT_ACCESS_CLASSIFICATION_SCHEMA,
    accessClassification,
    blocked,
    signalsDetected,
    decisionReason
  }
}

/**
 * Classifies what was ACTUALLY encountered by a real fetch, from the real
 * response evidence. `bodyText` may be null (e.g. a non-2xx HTTP status,
 * whose body bounded-http-fetch.mjs never reads) -- rules that need body
 * content are simply skipped in that case, never guessed at.
 */
export function classifyFetchedContentAccess({ httpStatus = null, bodyText = null, finalUrl = null, requestedUrl = null }) {
  if (httpStatus === 401) {
    return classification('AUTHENTICATED_PAGE_NO_EXPORT', true, ['HTTP_401'], 'HTTP 401 Unauthorized -- source requires authentication.')
  }
  if (httpStatus === 403) {
    if (bodyText && ANTI_BOT_PATTERN.test(bodyText)) {
      return classification('ANTI_BOT_CHALLENGE_DETECTED', true, ['HTTP_403', 'ANTI_BOT_MARKER'], 'HTTP 403 with an anti-bot/challenge page marker in the response body.')
    }
    return classification('AUTHENTICATED_PAGE_NO_EXPORT', true, ['HTTP_403'], 'HTTP 403 Forbidden -- treated as an access-control block (no anti-bot marker found to distinguish it further).')
  }
  if (httpStatus === 404 || httpStatus === 410) {
    return classification('SOURCE_UNAVAILABLE', true, [`HTTP_${httpStatus}`], `Source responded HTTP ${httpStatus} -- it no longer exists at this location.`)
  }
  if (httpStatus != null && httpStatus >= 500) {
    return classification('SOURCE_UNAVAILABLE', true, ['HTTP_5XX'], `Source responded HTTP ${httpStatus} -- server-side unavailability.`)
  }

  if (bodyText) {
    if (ANTI_BOT_PATTERN.test(bodyText)) {
      return classification('ANTI_BOT_CHALLENGE_DETECTED', true, ['ANTI_BOT_MARKER'], 'Response body matches a known anti-bot/challenge interstitial pattern (e.g. Cloudflare challenge, CAPTCHA).')
    }
    if (PAYWALL_PATTERN.test(bodyText)) {
      return classification('PAYWALL_ACCESS_CONTROL', true, ['PAYWALL_MARKER'], 'Response body matches a known subscription-paywall interstitial pattern.')
    }
    if (finalUrl && requestedUrl && finalUrl !== requestedUrl && LOGIN_PATH_PATTERN.test(finalUrl)) {
      return classification('AUTHENTICATED_PAGE_NO_EXPORT', true, ['REDIRECT_TO_LOGIN'], `Request for ${requestedUrl} was redirected to a login-shaped path (${finalUrl}).`)
    }
    if (PASSWORD_INPUT_PATTERN.test(bodyText)) {
      const hasSubstantialContent = /<table[\s>]/i.test(bodyText) && bodyText.length > SUBSTANTIAL_CONTENT_MIN_LENGTH
      return hasSubstantialContent
        ? classification('PUBLIC_TERMS_UNCLEAR', true, ['LOGIN_FORM_PRESENT', 'SUBSTANTIAL_CONTENT_ALSO_PRESENT'], 'A login form is present, but so is substantial other content (a real table, a long body) -- genuinely ambiguous, needs human review rather than a guess either way.')
        : classification('AUTHENTICATED_PAGE_NO_EXPORT', true, ['LOGIN_FORM_PRESENT', 'NO_SUBSTANTIAL_CONTENT'], 'A login form is present with no other substantial content -- this looks like a bare login shell, not the real source.')
    }
  }

  return classification('PUBLIC_ALLOWED', false, [], 'No known blocking/challenge/paywall/login signal detected in the real response evidence available.')
}
