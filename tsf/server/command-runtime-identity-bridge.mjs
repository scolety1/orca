// Stale-UI-build-prevention spec, Phase 7: Command <-> runtime identity
// bridge. Same early layer/reasoning as command-dogfood-bridge.mjs and
// command-fleet-attention-bridge.mjs (checked ahead of project-fleet intent
// classification in command-responder.mjs) -- "what version am I running"/
// "is the UI current" is never about a registered fleet project. Pure
// message-classification + read-only reporting over
// ui-build-orchestrator.mjs's own getRuntimeIdentityWithBuildState (the
// same real read GET /api/runtime-identity and first-run-setup.html use),
// no mutation, no rebuild trigger of its own -- a diagnostic answer path,
// not a new persistent UI surface (Health page etc. stays untouched).
import path from 'node:path'
import { getRuntimeIdentityWithBuildState } from './ui-build-orchestrator.mjs'

const VERSION_QUERY_PATTERNS = [
  /\bwhat\s+version\s+(am\s+i|is\s+this)\s+(actually\s+)?running\b/i,
  /\bis\s+(the\s+|this\s+)?ui\s+(actually\s+)?current\b/i,
  /\bis\s+(the\s+|this\s+)?ui\s+up[\s-]?to[\s-]?date\b/i,
  /\bwhat\s+commit\s+(am\s+i|is\s+this)\s+(running|on)\b/i,
  /\bruntime\s+identity\b/i
]

export function classifyRuntimeIdentityRequest(message) {
  return VERSION_QUERY_PATTERNS.some((pattern) => pattern.test(message))
    ? 'RUNTIME_IDENTITY_QUERY'
    : null
}

export function shouldRouteToRuntimeIdentityBridge(message) {
  return classifyRuntimeIdentityRequest(message) !== null
}

function shortSha(commit) {
  return commit ? commit.slice(0, 10) : 'unknown'
}

function formatAnswer(identity) {
  return [
    `Running commit: \`${shortSha(identity.runningCommit)}\``,
    `Disk commit: \`${shortSha(identity.diskCommit)}\``,
    `Served UI bundle commit: \`${shortSha(identity.uiBundleCommit)}\``,
    `State: **${identity.state}** -- ${identity.reason}`
  ].join('\n')
}

export async function respondRuntimeIdentityCommand({ message, deps = {} }) {
  if (!shouldRouteToRuntimeIdentityBridge(message)) {
    return null
  }
  const distDir = deps.distDir ?? path.join(import.meta.dirname, '..', 'ui', 'dist')
  const readIdentity = deps.getRuntimeIdentityWithBuildState ?? getRuntimeIdentityWithBuildState
  const identity = await readIdentity(distDir)
  return {
    intent: 'RUNTIME_IDENTITY',
    decisionClass: 'RECOMMEND_AND_PROCEED',
    text: formatAnswer(identity),
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · real read from runtime identity + UI build state, no mutation',
    live: true,
    resolvedProjectIds: [],
    scope: 'RUNTIME_IDENTITY'
  }
}
