// Pure RFC 9309 (Robots Exclusion Protocol) group parsing and rule
// evaluation. No I/O here -- see adapters/robots-txt-fetch.mjs for
// retrieval. Deliberately covers only what this adapter needs: user-agent
// group selection, allow/disallow longest-match-wins evaluation, and the
// '*'/'$' path wildcards (RFC 9309 §2.2.3). crawl-delay/sitemap directives
// are parsed as unknown fields and ignored -- not needed for an access
// decision.

/**
 * Splits robots.txt text into RFC 9309 groups: one or more consecutive
 * User-agent lines followed by their allow/disallow rules, ending at the
 * next User-agent line that follows a rule line.
 */
export function parseRobotsTxt(text) {
  const groups = []
  let current = null
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.split('#')[0].trim() // '#' starts a comment anywhere on the line
    if (!line) {
      continue
    }
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }
    const field = line.slice(0, separatorIndex).trim().toLowerCase()
    const value = line.slice(separatorIndex + 1).trim()
    if (field === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { userAgents: [], rules: [] }
        groups.push(current)
      }
      current.userAgents.push(value)
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) {
        continue // a rule before any User-agent line is malformed; ignore it
      }
      if (value !== '') {
        current.rules.push({ allow: field === 'allow', pattern: value })
      }
      // an empty Disallow value means "disallow nothing" per RFC 9309 -- no
      // rule to record; an empty Allow value is likewise a no-op.
    }
    // other fields (crawl-delay, sitemap, ...) are recognized-but-ignored.
  }
  return { schemaVersion: 'TSF_ROBOTS_GROUPS_V1', groups }
}

function patternToRegExp(pattern) {
  const anchoredEnd = pattern.endsWith('$')
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern
  const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
  return new RegExp(`^${escaped}${anchoredEnd ? '$' : ''}`)
}

/**
 * RFC 9309 §2.2.1 group selection: the most specific matching group wins
 * (an exact/substring product-token match beats the '*' wildcard group);
 * if more than one matching group shares the same specificity tier
 * (multiple non-wildcard matches, or multiple separate `User-agent: *`
 * blocks), all of that tier's rules are merged (a documented V0.5
 * convention -- the RFC does not define this case). A robots.txt with more
 * than one `User-agent: *` block is real-world-common; picking only the
 * first (as an earlier version of this function did via .find()) silently
 * dropped the other block's Disallow rules -- a fail-open bug.
 */
function selectApplicableRules(groups, productToken) {
  const token = productToken.toLowerCase()
  const specific = groups.filter((g) =>
    g.userAgents.some((ua) => ua !== '*' && token.includes(ua.toLowerCase()))
  )
  if (specific.length > 0) {
    return specific.flatMap((g) => g.rules)
  }
  const wildcardGroups = groups.filter((g) => g.userAgents.includes('*'))
  return wildcardGroups.length > 0 ? wildcardGroups.flatMap((g) => g.rules) : null // null: no applicable group at all
}

/**
 * RFC 9309 §2.2.2: the longest matching pattern wins; a tie between an
 * allow and a disallow rule of equal length resolves to allow.
 */
export function evaluateRobotsRules(parsed, { productToken, pathWithQuery }) {
  const rules = selectApplicableRules(parsed.groups, productToken)
  if (rules === null) {
    return { decision: 'ALLOWED', matchedRule: null, ruleSource: 'NO_APPLICABLE_GROUP' }
  }
  let best = null
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(pathWithQuery)) {
      continue
    }
    const isLonger = !best || rule.pattern.length > best.pattern.length
    const isTieFavoringAllow =
      best && rule.pattern.length === best.pattern.length && rule.allow && !best.allow
    if (isLonger || isTieFavoringAllow) {
      best = rule
    }
  }
  if (!best) {
    return { decision: 'ALLOWED', matchedRule: null, ruleSource: 'NO_MATCHING_RULE_IMPLICIT_ALLOW' }
  }
  return {
    decision: best.allow ? 'ALLOWED' : 'DISALLOWED',
    matchedRule: best,
    ruleSource: 'MATCHED_RULE'
  }
}
