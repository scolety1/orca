// Command architecture fix (hands-on pilot round 2): a message that never
// names a project was previously routed as if it MUST be about a specific
// project ("I couldn't tell which project this is about"), even for
// questions that never needed one at all -- "are there any projects here
// that are safe to mess around with?" is a real, answerable question about
// the fleet as a whole, not a failed project lookup.
//
// The fix is a real reordering, not a bigger regex table: this module
// classifies SCOPE first (does this message even need a specific project?)
// using PLANNER_DEEP's real natural-language interpretation
// (invokeLiveStructuredAnalysis, the same live-planner bridge onboarding's
// direction analysis and WBS generation already use -- REUSE_DIRECTLY, not
// a second LLM integration). The classifier's output is constrained to a
// closed enum and is NEVER, by itself, authority to dispatch/spend/act --
// it only decides which READ-ONLY or mission-CREATION branch a message
// routes to; every actual action still passes through this codebase's own
// unchanged, deterministic gates (exact-match-only dispatch, TIM_REQUIRED,
// the paid-research scoped-approval mechanism). Deterministic code remains
// the sole authority/security boundary -- the planner only ever advises
// which door to knock on.
//
// Falls back to a small, honestly-labeled deterministic heuristic when no
// live planner is available (no CLI configured, offline, etc.) -- coverage
// there is a best-effort safety net, not the primary mechanism, and every
// caller can tell the two apart via `source`.
import { invokeLiveStructuredAnalysis } from './live-planner.mjs'

export const GLOBAL_SCOPES = Object.freeze([
  'GLOBAL_STATUS',
  'GLOBAL_ADVISORY',
  'RESEARCH_REQUEST',
  'NEEDS_YOU_QUERY',
  'PROJECT_REQUIRED',
  'UNCLEAR'
])

const SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'scope'],
  properties: {
    schemaVersion: { const: 'TSF_COMMAND_SCOPE_CLASSIFICATION_V1' },
    scope: { type: 'string', enum: [...GLOBAL_SCOPES] },
    reasoning: { type: 'string' }
  }
}

const SCOPE_SYSTEM_PROMPT = [
  'You are classifying ONE chat message sent to TSF Command -- a multi-project operator system -- that did NOT resolve to any specific known project by name.',
  'Your only job is to pick exactly one scope label for the message. You are not answering the message, not taking any action, and nothing you say here can dispatch work or spend money -- this is a routing decision only.',
  '',
  'Labels:',
  '- GLOBAL_STATUS: asking what is currently running/happening across the whole fleet, no specific project implied.',
  '- GLOBAL_ADVISORY: asking for a recommendation, explanation, or overview about the fleet or its projects in the abstract (e.g. which projects are safe/disposable/OK to test on, general guidance) -- read-only, not about acting on one named project.',
  '- RESEARCH_REQUEST: asking to research or build a dataset about some real-world topic that is NOT a TSF/Orca project (e.g. historical sports data, market data, any external subject matter).',
  '- NEEDS_YOU_QUERY: asking what outstanding decisions/owner attention are pending across the whole fleet (e.g. "what needs me?", "what am I blocking?").',
  '- PROJECT_REQUIRED: the message is clearly about acting on or asking about ONE SPECIFIC project, but did not name it clearly enough to resolve -- it genuinely needs a project name.',
  '- UNCLEAR: none of the above fit with reasonable confidence.',
  '',
  'Pick the single best label. Give a one-sentence reasoning.'
].join('\n')

function deterministicScopeFallback(message) {
  if (/\bwhat needs me\b|\bwhat am i blocking\b|\bwhat'?s blocked on me\b|\bwhat decisions? (are|do i have) (pending|outstanding|waiting)\b/i.test(message)) {
    return 'NEEDS_YOU_QUERY'
  }
  if (/\b(what'?s (running|going on)|status|catch me up|update me|where are we)\b/i.test(message)) {
    return 'GLOBAL_STATUS'
  }
  const safetyWords = /\b(safe(ly)?|disposable|throwaway|don'?t matter|doesn'?t matter|expendable)\b/i
  const testWords = /\b(project|projects|repo|repos|test|tests|testing|mess (around|with)|play (around|with)|experiment)\b/i
  if (safetyWords.test(message) && testWords.test(message)) {
    return 'GLOBAL_ADVISORY'
  }
  if (/\b(research|build (?:me )?(?:a )?dataset|dataset\s+(?:of|for))\b/i.test(message)) {
    return 'RESEARCH_REQUEST'
  }
  return 'UNCLEAR'
}

// clock is accepted for signature symmetry with every other Command
// function that threads one through, even though this call itself doesn't
// need wall-clock time -- avoids a caller having to special-case this one
// function's argument shape.
export async function classifyGlobalScope({ message }) {
  const live = await invokeLiveStructuredAnalysis({
    systemPrompt: SCOPE_SYSTEM_PROMPT,
    prompt: message,
    jsonSchema: SCOPE_SCHEMA,
    // A routing decision, not a deep analysis -- kept well under Planner
    // Chat's own responsiveness expectations, unlike onboarding's 180s
    // direction-analysis budget.
    timeoutOverrideMs: 20000
  })
  if (live.ok && GLOBAL_SCOPES.includes(live.data?.scope)) {
    return { scope: live.data.scope, source: 'LIVE_PLANNER', reasoning: live.data.reasoning ?? null }
  }
  return {
    scope: deterministicScopeFallback(message),
    source: 'DETERMINISTIC_FALLBACK',
    reasoning: null,
    plannerFailure: live.ok ? 'SCHEMA_MISMATCH' : (live.reason ?? 'UNKNOWN')
  }
}

// Real-catalog-grounded, deterministic, read-only -- no LLM needed for this
// part (it's formatting real facts, not interpreting a question). A
// project counts as safe/disposable to test on when it is a FIXTURE
// (deterministic, no real state to break) or its own id/displayName marks
// it as a test artifact -- the same convention this session's own isolated
// pilots use (a "TEST-" / "test" labeled disposable project). Never
// guesses safety from a REAL project's mere absence of a health finding --
// silence is not evidence of safety.
function isAdvisorySafeProject(project) {
  return project.sourceClass === 'FIXTURE' || /\btest\b/i.test(project.id) || /\btest\b/i.test(project.displayName)
}

export function buildGlobalAdvisoryText(projects) {
  const safe = projects.filter(isAdvisorySafeProject)
  if (safe.length === 0) {
    return "I don't see a project in the current catalog that's clearly marked as disposable/test-only -- every known project here is a real one. Ask me to onboard a throwaway repo if you want something safe to experiment on."
  }
  const lines = safe.map((p) => {
    const why = p.sourceClass === 'FIXTURE' ? 'a deterministic fixture project, not real state' : "its own name marks it as a disposable test project"
    return `- **${p.displayName}** (\`${p.id}\`) -- ${why}.`
  })
  return `Safe to mess around with, from the current catalog:\n${lines.join('\n')}\n\nEverything else in the catalog is a real project -- I won't start anything automatically; say which one you want to act on.`
}
