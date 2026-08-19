// Live PLANNER_DEEP bridge for Planner Chat. Resolves the stable PLANNER_DEEP
// role (tsf/routing/provider-role-mappings.v1.json) to a real installed
// provider CLI and invokes it headlessly (print mode, --tools "" so it has
// zero ability to edit/run/adopt/merge/push/deploy — pure text reasoning) via
// tsf/providers/resolve-agent-entry.mjs. Session affinity is a real
// tsf/domain/session-affinity.mjs binding, persisted per project in
// tsf/server/data-store.mjs so a project's planner conversation survives
// multiple chat turns (PLANNING_EPISODE scope) until a documented switch
// boundary (provider failure, explicit escalation). Falls back honestly —
// never fabricates a live answer or a provider/model identity.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRole } from '../domain/routing.mjs'
import { createSessionBinding, replaceSessionBinding, assertAffinity } from '../domain/session-affinity.mjs'
import { resolveAgentEntry } from '../providers/resolve-agent-entry.mjs'
import providerRoles from '../routing/provider-role-mappings.v1.json' with { type: 'json' }
import launchProfiles from '../providers/launch-profiles.v1.json' with { type: 'json' }

const HERE = dirname(fileURLToPath(import.meta.url))
// Neutral cwd with no CLAUDE.md/AGENTS.md of its own, so the planner persona
// comes only from the system prompt this module builds, not this repo's own
// coding-agent instructions. Gitignored (sibling of .local-state/).
const NEUTRAL_CWD = join(HERE, '.local-state', 'planner-cwd')

// Read per-call, not frozen at module load, so tests (and ops) can override
// it without needing a fresh process.
function timeoutMs() {
  return Number(process.env.TSF_PLANNER_TIMEOUT_MS) || 45000
}
const MAX_HISTORY_TURNS = 6
const AGENT_DISPLAY_NAME = { 'claude-code': 'Claude Code', codex: 'Codex' }
const MODEL_DISPLAY = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-5': 'Opus 5',
  'claude-fable-5': 'Fable 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5'
}
const AGENT_PROVIDER_ID = Object.fromEntries(Object.values(launchProfiles.profiles).map((p) => [p.agentId, p.providerId]))

export function agentDisplayName(agentId) {
  return AGENT_DISPLAY_NAME[agentId] ?? agentId
}

// Never invents a friendlier label for a model it doesn't recognize — shows
// the exact observed canonical id instead of guessing a pretty name for it.
export function modelDisplayName(observedModel) {
  if (!observedModel) return null
  return MODEL_DISPLAY[observedModel] ?? observedModel
}

function ensureNeutralCwd() {
  mkdirSync(NEUTRAL_CWD, { recursive: true })
  return NEUTRAL_CWD
}

// Builds a TSF_PROJECT_CONTEXT_CAPSULE_V1-shaped object (see
// tsf/contracts/project-context-capsule.schema.v1.json) from the same real
// ProjectDetail the rest of the UI already reads — no separate data source.
export function buildProjectContextCapsule(project) {
  const onboarding = project.evidence?.onboarding ?? null
  const blockers = []
  if (project.mission.blockedReason) blockers.push(project.mission.blockedReason)
  for (const f of project.health.findings ?? []) blockers.push(`${f.code}: ${f.summary}`)
  // Every recorded decision, not just favorable ones (e.g. a verifier's
  // REJECT_CURRENT_CANDIDATE) — the capsule schema's "approvals" field is the
  // closest fit, but withholding rejections would make the planner's picture
  // less honest, not more like an approvals list.
  const approvals = []
  if (project.release.adoption?.startsWith('ADOPTED')) approvals.push(`Adopted at ${(project.release.stable.head ?? 'unknown').slice(0, 10)}`)
  for (const r of project.receipts?.chain ?? []) if (r.decision) approvals.push(`${r.kind}: ${r.decision} (${r.timestamp})`)
  const knownRisks = []
  if (project.candidate?.residualRisks) knownRisks.push(project.candidate.residualRisks)
  const completedMissions = (project.evidence?.resultCapsules ?? [])
    .filter((r) => r.status === 'SUCCEEDED' || r.status === 'ADOPTED')
    .map((r) => r.implementationSummary)
    .filter(Boolean)
  const lastResult = project.evidence?.resultCapsules?.at(-1) ?? null

  // Onboarded-project facts: compact decisions, not the full scan (per the
  // "avoid dumping the entire onboarding scan into every chat turn"
  // requirement) — migration classification, top upgrade candidates, and
  // handoff discrepancies, not the raw discovery payload.
  if (onboarding) {
    if (onboarding.completedSummary) completedMissions.push(onboarding.completedSummary)
    blockers.push(`Migration classification: ${onboarding.migrationClassification.classification} (${onboarding.migrationClassification.reasons[0] ?? 'see onboarding record'})`)
    for (const discrepancy of onboarding.handoffReconciliation?.discrepancies ?? []) blockers.push(`Handoff discrepancy: ${discrepancy}`)
    for (const candidate of (onboarding.upgradeCandidates ?? []).slice(0, 5)) knownRisks.push(`Upgrade candidate (${candidate.category}, ${candidate.importance}): ${candidate.title}`)
  }

  return {
    capsule_id: `planner-chat:${project.id}:${Date.now()}`,
    project_id: project.id,
    project_goal: project.purpose ?? project.displayName,
    current_branch: project.branch ?? 'unknown',
    current_lane: project.lifecycle ?? 'UNKNOWN',
    completed_missions: completedMissions.slice(-5),
    active_blockers: blockers.slice(0, 5),
    approvals: approvals.slice(-5),
    known_risks: knownRisks,
    do_not_repeat_lessons: [],
    next_recommended_action:
      project.evidence?.selectedMission?.title && project.evidence?.selectedMission?.rationale
        ? `${project.evidence.selectedMission.title} — ${project.evidence.selectedMission.rationale}`
        : (project.health.findings?.[0]?.remediation ??
          (project.candidate?.state === 'READY_FOR_ADOPTION' ? 'Review and decide the candidate on the Adoption surface.' : 'No specific recommendation recorded.')),
    hq_escalation_history: [],
    artifacts_created: (lastResult?.filesChanged ?? []).slice(0, 20),
    last_worker_role: lastResult?.workerIdentity?.role ?? null,
    last_mission_result: lastResult?.status ?? null,
    updated_at: new Date().toISOString()
  }
}

function buildSystemPrompt({ project, capsule, opState, recentHistory, attachments }) {
  const operatorFacts = {
    releaseTrack: { stable: project.release.stable, testing: project.release.testing, adoption: project.release.adoption, published: project.release.published, upgrade: project.release.upgrade },
    health: { status: project.health.status, findings: (project.health.findings ?? []).map((f) => ({ code: f.code, summary: f.summary })) },
    usageMode: opState.usageMode,
    workSet: opState.workSet,
    candidate: project.candidate ? { state: project.candidate.state, decidable: project.candidate.decidable, summary: project.candidate.implementationSummary } : null
  }
  const historyBlock = recentHistory.length ? recentHistory.map((m) => `${m.role === 'user' ? 'Tim' : 'Planner'}: ${m.content}`).join('\n') : '(no prior turns in this session)'
  const attachmentNote = attachments?.length
    ? `Tim attached ${attachments.length} file(s) to this message: ${attachments.map((a) => `${a.name} (${a.type || 'unknown type'})`).join(', ')}. Their CONTENTS are not available to you — only the name and type. Never claim to have seen, read, or understood an attachment; if asked about its contents, say plainly that image/file interpretation isn't wired into this chat yet.`
    : 'No attachments on this message.'

  return [
    'You are the TSF (Thousand Sunny Fleet) Planner — the PLANNER_DEEP role in an Orca-based multi-project operator system. You are having a real, natural conversation with Tim, the operator, about ONE selected project.',
    '',
    'Ground every answer in the project context capsule and operator facts below. Do not invent facts, evidence, test results, or history beyond what is given here and in the conversation — if you do not know something, say so plainly rather than guessing.',
    '',
    '=== PROJECT CONTEXT CAPSULE (TSF_PROJECT_CONTEXT_CAPSULE_V1) ===',
    JSON.stringify(capsule, null, 2),
    '',
    '=== ADDITIONAL OPERATOR FACTS ===',
    JSON.stringify(operatorFacts, null, 2),
    '',
    '=== RECENT CONVERSATION (bounded, this project only) ===',
    historyBlock,
    '',
    '=== ATTACHMENT STATUS ===',
    attachmentNote,
    '',
    'Authority boundaries (hard constraints, not suggestions):',
    "- You may answer questions, explain state, and recommend work — that's the job.",
    '- You may NOT adopt, merge, push, deploy, publish, spend money, use credentials, or perform any destructive/production action. You have no tools and no ability to do any of that even if asked. If Tim asks for one of these, say clearly it requires his explicit action outside this chat.',
    '- Never claim to have taken an action you did not take.',
    '',
    'Answer naturally and specifically, grounded in the material above — a few sentences to a short paragraph, unless real depth is clearly needed.'
  ].join('\n')
}

function spawnAgent({ entry, args, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(entry.command, args, { cwd, shell: !!entry.viaShell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      return resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return resolve({ ok: false, reason: 'TIMEOUT', detail: `no response within ${timeoutMs}ms` })
      resolve({ ok: true, code, stdout, stderr })
    })
  })
}

function buildArgs({ agentId, prompt, systemPrompt, resumeSessionId, jsonSchema }) {
  if (agentId === 'claude-code') {
    const args = ['-p', prompt, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--system-prompt', systemPrompt]
    if (resumeSessionId) args.push('--resume', resumeSessionId)
    if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema))
    return args
  }
  if (agentId === 'codex') {
    // Best-effort fallback shape; codex is PLANNER_DEEP's documented
    // fallbackProfile, not the primary path this mission targets.
    const args = ['exec', '--json', `${systemPrompt}\n\n${prompt}`]
    if (resumeSessionId) args.push('resume', resumeSessionId)
    return args
  }
  return null
}

async function runOnce({ agentId, prompt, systemPrompt, resumeSessionId, jsonSchema, timeoutOverrideMs }) {
  const entry = resolveAgentEntry(agentId)
  if (!entry) return { ok: false, reason: 'PROVIDER_UNAVAILABLE', detail: `no runnable entry found for agent: ${agentId}` }
  const cliArgs = buildArgs({ agentId, prompt, systemPrompt, resumeSessionId, jsonSchema })
  if (!cliArgs) return { ok: false, reason: 'PROVIDER_UNAVAILABLE', detail: `no invocation shape configured for agent: ${agentId}` }
  const outcome = await spawnAgent({ entry, args: [...entry.args, ...cliArgs], cwd: ensureNeutralCwd(), timeoutMs: timeoutOverrideMs ?? timeoutMs() })
  if (!outcome.ok) return outcome
  if (outcome.code !== 0) {
    // A resume against an unknown/expired session id surfaces as plain text
    // on a non-zero exit, not JSON — this is the PROVIDER_FAILURE case the
    // caller retries fresh (session-affinity.v1.json's PROVIDER_FAILURE
    // switch boundary), not a crash.
    return { ok: false, reason: 'PROVIDER_ERROR', detail: (outcome.stdout + outcome.stderr).trim().slice(0, 500) || `exit code ${outcome.code}` }
  }
  let parsed
  try {
    parsed = JSON.parse(outcome.stdout)
  } catch {
    return { ok: false, reason: 'MALFORMED_RESPONSE', detail: outcome.stdout.slice(0, 500) || outcome.stderr.slice(0, 500) }
  }
  if (parsed.is_error) return { ok: false, reason: 'PROVIDER_ERROR', detail: typeof parsed.result === 'string' ? parsed.result.slice(0, 500) : JSON.stringify(parsed).slice(0, 500) }
  if (typeof parsed.result !== 'string' || !parsed.session_id) return { ok: false, reason: 'MALFORMED_RESPONSE', detail: 'provider response missing result/session_id' }
  const modelUsageKeys = Object.keys(parsed.modelUsage ?? {})
  return { ok: true, text: parsed.result, structuredOutput: parsed.structured_output ?? null, sessionId: parsed.session_id, observedModel: modelUsageKeys[0] ?? null, costUsd: parsed.total_cost_usd ?? null }
}

// Attempts PLANNER_DEEP live, honoring sticky per-project session affinity
// and falling back across the documented switch boundaries only:
// PROVIDER_FAILURE (stale/rejected resume, retried fresh) then, if still
// unavailable, the role's own configured fallbackProfile. Returns
// { ok:false, reason, detail } rather than throwing so the caller can render
// an honest degraded state instead of a 500.
export async function invokeLivePlanner({ project, message, opState, recentHistory = [], attachments = [] }) {
  const roleResolution = resolveRole({ role: 'PLANNER_DEEP', mappings: providerRoles, profiles: { profiles: launchProfiles.profiles } })
  const capsule = buildProjectContextCapsule(project)
  const systemPrompt = buildSystemPrompt({ project, capsule, opState, recentHistory: recentHistory.slice(-MAX_HISTORY_TURNS), attachments })
  const preferredAgent = roleResolution.requested.agentId
  const stored = opState.plannerSessions?.[project.id] ?? null

  const canResume = !!stored && stored.agentId === preferredAgent
  let result = await runOnce({ agentId: preferredAgent, prompt: message, systemPrompt, resumeSessionId: canResume ? stored.providerConversationId : null })

  // session-affinity.v1.json's documented switch boundaries: a stale/rejected
  // resume, or the preferred agent being unavailable at all, are both
  // PROVIDER_FAILURE — the only cases this turn is allowed to replace a
  // sticky session rather than keep it for the PLANNING_EPISODE scope.
  let boundary = null
  if (!result.ok && canResume) {
    boundary = 'PROVIDER_FAILURE'
    result = await runOnce({ agentId: preferredAgent, prompt: message, systemPrompt, resumeSessionId: null })
  }

  let agentUsed = preferredAgent
  if (!result.ok && roleResolution.fallbackProfile) {
    const fallbackAgentId = launchProfiles.profiles[roleResolution.fallbackProfile]?.agentId
    if (fallbackAgentId && fallbackAgentId !== preferredAgent) {
      const fallbackResult = await runOnce({ agentId: fallbackAgentId, prompt: message, systemPrompt, resumeSessionId: null })
      if (fallbackResult.ok) {
        result = fallbackResult
        agentUsed = fallbackAgentId
        if (stored) boundary = 'PROVIDER_FAILURE'
      }
    }
  }

  if (!result.ok) {
    return { ok: false, role: 'PLANNER_DEEP', reason: result.reason, detail: result.detail, attempted: preferredAgent }
  }

  const nextIdentity = {
    providerId: AGENT_PROVIDER_ID[agentUsed] ?? 'unknown',
    agentId: agentUsed,
    modelClass: roleResolution.requested.modelClass,
    modelObserved: result.observedModel,
    // No live Orca Run/task/dispatch feed exists yet (Wave 5, out of scope)
    // — this is a chat-scoped local session key, not a claim of a live Orca
    // runtime session.
    orcaSessionId: `tsf-planner-chat:${project.id}`,
    providerConversationId: result.sessionId
  }

  let binding
  let replacementReceipt = null
  if (!stored) {
    binding = createSessionBinding({ role: 'PLANNER_DEEP', ...nextIdentity })
  } else if (boundary) {
    const replaced = replaceSessionBinding(stored, nextIdentity, { boundary, reason: 'live planner session was no longer resumable', checkpointRef: null, unresolvedWork: [] })
    binding = replaced.binding
    replacementReceipt = replaced.receipt
  } else {
    assertAffinity(stored, { providerId: stored.providerId, agentId: stored.agentId, orcaSessionId: stored.orcaSessionId, worktreeId: stored.worktreeId ?? null })
    binding = { ...stored, modelObserved: result.observedModel, providerConversationId: result.sessionId }
  }

  return {
    ok: true,
    role: 'PLANNER_DEEP',
    text: result.text,
    agentId: agentUsed,
    providerId: binding.providerId,
    model: result.observedModel,
    sessionId: result.sessionId,
    binding,
    replacementReceipt,
    costUsd: result.costUsd,
    freshSession: !stored || !!boundary
  }
}

export function providerLabel({ agentId, model }) {
  const display = [agentDisplayName(agentId), modelDisplayName(model)].filter(Boolean).join(' · ')
  return `PLANNER_DEEP · ${display}`
}

// One-shot, schema-validated PLANNER_DEEP analysis — used by onboarding's
// direction analysis (tsf/server/onboarding.mjs), not the chat session
// affinity path. No --resume (each onboarding analysis is independent), and
// the CLI's own --json-schema validates the shape so the caller gets a real
// parsed object back, not free text to regex against. Still zero-tool
// (--tools ""): the model reasons only over the facts given in the prompt,
// it cannot go re-inspect the repository itself.
export async function invokeLiveStructuredAnalysis({ systemPrompt, prompt, jsonSchema, timeoutOverrideMs }) {
  const roleResolution = resolveRole({ role: 'PLANNER_DEEP', mappings: providerRoles, profiles: { profiles: launchProfiles.profiles } })
  const preferredAgent = roleResolution.requested.agentId
  let result = await runOnce({ agentId: preferredAgent, prompt, systemPrompt, jsonSchema, timeoutOverrideMs })
  let agentUsed = preferredAgent

  if (!result.ok && roleResolution.fallbackProfile) {
    const fallbackAgentId = launchProfiles.profiles[roleResolution.fallbackProfile]?.agentId
    if (fallbackAgentId && fallbackAgentId !== preferredAgent) {
      const fallbackResult = await runOnce({ agentId: fallbackAgentId, prompt, systemPrompt, jsonSchema, timeoutOverrideMs })
      if (fallbackResult.ok) {
        result = fallbackResult
        agentUsed = fallbackAgentId
      }
    }
  }

  if (!result.ok) return { ok: false, role: 'PLANNER_DEEP', reason: result.reason, detail: result.detail, attempted: preferredAgent }

  let parsed = result.structuredOutput
  if (!parsed) {
    try {
      parsed = JSON.parse(result.text)
    } catch {
      return { ok: false, role: 'PLANNER_DEEP', reason: 'MALFORMED_RESPONSE', detail: 'structured output was not valid JSON', attempted: preferredAgent }
    }
  }

  return {
    ok: true,
    role: 'PLANNER_DEEP',
    data: parsed,
    agentId: agentUsed,
    providerId: AGENT_PROVIDER_ID[agentUsed] ?? 'unknown',
    model: result.observedModel,
    costUsd: result.costUsd
  }
}

export function fallbackLabel(reason) {
  const REASONS = {
    PROVIDER_UNAVAILABLE: 'provider not found on this machine',
    TIMEOUT: 'provider timed out',
    PROVIDER_ERROR: 'provider returned an error',
    MALFORMED_RESPONSE: 'provider returned a malformed response',
    SPAWN_ERROR: 'could not start the provider process'
  }
  return `Planner unavailable — using recorded project-state fallback${reason ? ` (${REASONS[reason] ?? reason})` : ''}`
}
