import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRobotsTxt, evaluateRobotsRules } from '../domain/robots-txt-parser.mjs'

const UA = 'TsfWebSourceAcquisitionBot/0.1'

test('a wildcard group applies when no specific group matches', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /private/')
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/private/page' })
  assert.equal(result.decision, 'DISALLOWED')
  assert.equal(result.ruleSource, 'MATCHED_RULE')
})

test('a specific matching group takes precedence over the wildcard group', () => {
  const parsed = parseRobotsTxt(
    `User-agent: *\nDisallow: /\n\nUser-agent: TsfWebSourceAcquisitionBot\nAllow: /public/`
  )
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/public/page' })
  assert.equal(result.decision, 'ALLOWED')
})

test('longest matching pattern wins over a shorter, less specific one', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /a\nAllow: /a/b/c')
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/a/b/c/page' })
  assert.equal(result.decision, 'ALLOWED')
  assert.equal(result.matchedRule.pattern, '/a/b/c')
})

test('a tie in pattern length between allow and disallow resolves to allow', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /page\nAllow: /page')
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/page' })
  assert.equal(result.decision, 'ALLOWED')
})

test('no matching rule at all is an implicit allow', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /admin/')
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/public/page' })
  assert.equal(result.decision, 'ALLOWED')
  assert.equal(result.ruleSource, 'NO_MATCHING_RULE_IMPLICIT_ALLOW')
})

test('no groups at all is an implicit allow with no applicable group', () => {
  const parsed = parseRobotsTxt('Sitemap: https://example.com/sitemap.xml')
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/anything' })
  assert.equal(result.decision, 'ALLOWED')
  assert.equal(result.ruleSource, 'NO_APPLICABLE_GROUP')
})

test('supports the * wildcard and $ end-anchor in patterns', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /*.pdf$')
  const allowed = evaluateRobotsRules(parsed, {
    productToken: UA,
    pathWithQuery: '/report.pdf.html'
  })
  const blocked = evaluateRobotsRules(parsed, {
    productToken: UA,
    pathWithQuery: '/files/report.pdf'
  })
  assert.equal(allowed.decision, 'ALLOWED')
  assert.equal(blocked.decision, 'DISALLOWED')
})

test('comments and blank lines are ignored, and an empty Disallow value disallows nothing', () => {
  const parsed = parseRobotsTxt('# comment\nUser-agent: *\n\nDisallow:\n')
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/anything' })
  assert.equal(result.decision, 'ALLOWED')
})

test('consecutive User-agent lines share one group', () => {
  const parsed = parseRobotsTxt(
    'User-agent: bot-a\nUser-agent: tsfwebsourceacquisitionbot\nDisallow: /x'
  )
  assert.equal(parsed.groups.length, 1)
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/x' })
  assert.equal(result.decision, 'DISALLOWED')
})

test('a rule line before any User-agent line is ignored, not a crash', () => {
  const parsed = parseRobotsTxt('Disallow: /x\nUser-agent: *\nAllow: /x')
  const result = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/x' })
  assert.equal(result.decision, 'ALLOWED')
})

test('two separate User-agent: * blocks are merged, not just the first one applied (regression: fail-open bug)', () => {
  const parsed = parseRobotsTxt(
    'User-agent: *\nDisallow: /admin/\n\n' +
      'User-agent: Googlebot\nAllow: /\n\n' +
      'User-agent: *\nDisallow: /secret/\n'
  )
  const firstBlockPath = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/admin/x' })
  const secondBlockPath = evaluateRobotsRules(parsed, { productToken: UA, pathWithQuery: '/secret/x' })
  assert.equal(firstBlockPath.decision, 'DISALLOWED')
  assert.equal(
    secondBlockPath.decision,
    'DISALLOWED',
    'the second User-agent: * block must not be silently dropped'
  )
})
