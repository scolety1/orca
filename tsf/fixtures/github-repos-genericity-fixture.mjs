// HQ §22 -- non-NFL genericity proof. All domain-specific naming for
// THIS entity type (open-source GitHub repositories) lives here, exactly
// like nfl-2001-qb-research-fixture.mjs does for the NFL domain. The
// generic engine (domain/*.mjs, server/*.mjs) must not need a single line
// changed to run this. Real, public, deterministic GitHub REST API data
// (unauthenticated, $0, no paid research needed for any of these fields).
export const EXPECTED_UNIVERSE_SOURCE = 'GitHub REST API v3, https://docs.github.com/en/rest/repos/repos (public, unauthenticated GET /repos/{owner}/{repo})'

// A small, real, well-known, bounded set -- not chosen to make the proof
// look clean; these are simply widely-known public repos.
export const REPOS = Object.freeze([
  { entityId: 'github:facebook/react', owner: 'facebook', repo: 'react' },
  { entityId: 'github:nodejs/node', owner: 'nodejs', repo: 'node' },
  { entityId: 'github:python/cpython', owner: 'python', repo: 'cpython' },
  { entityId: 'github:django/django', owner: 'django', repo: 'django' },
  { entityId: 'github:pandas-dev/pandas', owner: 'pandas-dev', repo: 'pandas' },
  { entityId: 'github:rust-lang/rust', owner: 'rust-lang', repo: 'rust' }
])

export const FIELD_TYPES = Object.freeze({
  stargazersCount: 'number',
  forksCount: 'number',
  openIssuesCount: 'number',
  primaryLanguage: 'string',
  licenseSpdxId: 'string',
  defaultBranch: 'string'
})

export function requestedOutputSchema() {
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(FIELD_TYPES).map(([name, type]) => [name, { type }]))
  }
}

export function requestedFields() {
  return Object.keys(FIELD_TYPES).map((fieldName) => ({
    fieldName,
    valueType: FIELD_TYPES[fieldName],
    required: fieldName !== 'licenseSpdxId', // real gap: some real repos report license null via the API
    requiredTemporalScopes: ['as-of-fetch']
  }))
}
