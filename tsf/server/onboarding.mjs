// TSF Project Onboarding V1 orchestrator: read-only repository analysis →
// handoff reconciliation → migration classification → Health → live
// direction/upgrade-backlog analysis → (only at commit time) portfolio
// persistence + best-effort Orca registration. Nothing in analyzeRepository
// writes to the target repository, Orca, or TSF state — that's the whole
// point of the read-only-first design in the mission brief.
import path from 'node:path'
import { snapshotRepository, discoverProjectFiles, discoverCommandGuidance, boundedUntrackedDirectorySizes } from './repo-inspector.mjs'
import { classifyMigration, portfolioGatingForClassification, reconcileHandoff, buildOnboardingReceipt } from '../domain/onboarding.mjs'
import { assessRepositoryOnboardingHealth } from '../domain/health.mjs'
import { invokeLiveStructuredAnalysis, providerLabel, fallbackLabel } from './live-planner.mjs'
import { findRegisteredOrcaRepo, registerOrcaRepo } from '../adapters/orca-cli-bridge.mjs'
import { registerProject, setActiveFleet, setWorkSet } from '../domain/portfolio.mjs'

const DIRECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'completedSummary', 'unfinishedSummary', 'alignment', 'recommendedNextMission', 'upgradeCandidates'],
  properties: {
    purpose: { type: 'string' },
    completedSummary: { type: 'string' },
    unfinishedSummary: { type: 'string' },
    alignment: { type: 'string', enum: ['ALIGNED', 'PARTIALLY_ALIGNED', 'MISALIGNED', 'UNKNOWN'] },
    alignmentRationale: { type: 'string' },
    recommendedNextMission: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'rationale'],
      properties: { title: { type: 'string' }, rationale: { type: 'string' } }
    },
    upgradeCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'rationale', 'category', 'importance', 'confidence', 'blocksCurrentWork', 'safeToDefer'],
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          evidence: { type: 'string' },
          category: { type: 'string', enum: ['PRODUCT_UX', 'RELIABILITY', 'ARCHITECTURE', 'TEST_COVERAGE', 'DEVELOPER_TOOLING', 'PERFORMANCE', 'SECURITY', 'RESEARCH', 'OPERATOR_WORKFLOW'] },
          importance: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          blocksCurrentWork: { type: 'boolean' },
          safeToDefer: { type: 'boolean' }
        }
      }
    }
  }
}

const DIRECTION_SYSTEM_PROMPT = [
  'You are the TSF Planner analyzing a repository for onboarding, in the PLANNER_DEEP role.',
  'You have no tools and cannot inspect the repository yourself — everything you need is in the facts below. Do not claim to have read files beyond the excerpts given.',
  'Ground every claim in the given evidence. If something is not knowable from the evidence, say so plainly rather than guessing.',
  'This is analysis only — you are not implementing anything. Upgrade candidates are recommendations, never automatic missions.',
  'Answer strictly as JSON matching the given schema.'
].join('\n')

function slugify(name) {
  return String(name || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'project'
}

// Simple, deterministic maturity signal from concrete facts — not an LLM
// guess: commit count, presence of docs/tests, dependency install state.
function assessMaturity({ snapshot, hasReadme, hasTestCommand, hasInstructions }) {
  const commits = snapshot.commitCount ?? 0
  const signals = [hasReadme, hasTestCommand, hasInstructions, commits >= 10].filter(Boolean).length
  if (commits === 0) return 'UNINITIALIZED'
  if (commits < 5 || signals <= 1) return 'EARLY'
  if (signals >= 3 && commits >= 20) return 'ESTABLISHED'
  return 'DEVELOPING'
}

function buildDirectionPrompt({ snapshot, discovery, commandGuidance, reconciliation, health, migration }) {
  const readme = discovery.priorityFiles.find((f) => f.kind === 'README')
  const agents = discovery.priorityFiles.find((f) => f.kind === 'AGENTS')
  const claude = discovery.priorityFiles.find((f) => f.kind === 'CLAUDE')
  const roadmap = discovery.priorityFiles.filter((f) => f.kind === 'ROADMAP')
  const facts = {
    repository: { branch: snapshot.branch, head: snapshot.head?.slice(0, 10), dirty: snapshot.dirty, commitCount: snapshot.commitCount, recentCommits: snapshot.recentCommits.slice(0, 8).map((c) => ({ subject: c.subject, date: c.date })) },
    discoveredDocs: discovery.priorityFiles.map((f) => ({ path: f.relativePath, kind: f.kind, truncated: f.truncated })),
    discoveredDirectories: discovery.discoveredDirectories,
    commandGuidance: { packageManager: commandGuidance.packageManager, testCommands: commandGuidance.testCommands, buildCommands: commandGuidance.buildCommands, hasKnownTestCommand: commandGuidance.hasKnownTestCommand },
    health: { status: health.status, findings: health.findings.map((f) => ({ code: f.code, status: f.status, summary: f.summary })) },
    migrationClassification: migration.classification,
    handoffReconciliation: reconciliation.hasHandoff ? { discrepancies: reconciliation.discrepancies, agreements: reconciliation.agreements } : null
  }
  const excerpts = [
    readme ? `=== README.md (excerpt${readme.truncated ? ', truncated' : ''}) ===\n${readme.text}` : null,
    agents ? `=== AGENTS.md (excerpt${agents.truncated ? ', truncated' : ''}) ===\n${agents.text}` : null,
    claude ? `=== CLAUDE.md (excerpt${claude.truncated ? ', truncated' : ''}) ===\n${claude.text}` : null,
    ...roadmap.map((f) => `=== ${f.relativePath} (excerpt${f.truncated ? ', truncated' : ''}) ===\n${f.text}`)
  ].filter(Boolean)

  return [
    '=== REPOSITORY FACTS ===',
    JSON.stringify(facts, null, 2),
    '',
    ...excerpts,
    '',
    'Based only on the above: what is this project trying to accomplish, what appears complete, what is unfinished, is current work aligned with that goal, what is the single highest-value next bounded mission, and what upgrade candidates (if any) are worth tracking for later — separate from the immediate next mission?'
  ].join('\n')
}

// Read-only. Never writes to the target repository, TSF state, or Orca.
export async function analyzeRepository({ repoPath, handoffText = '' }) {
  const snapshot = await snapshotRepository(repoPath)
  if (!snapshot.ok) return { ok: false, reason: snapshot.reason, detail: snapshot.detail }

  const discovery = await discoverProjectFiles(snapshot.root)
  const packageJson = discovery.priorityFiles.find((f) => f.relativePath === 'package.json')
  const commandGuidance = discoverCommandGuidance(snapshot.root, packageJson?.text)
  const largeUntracked = boundedUntrackedDirectorySizes(snapshot.root, snapshot.untracked)

  const readmeFile = discovery.priorityFiles.find((f) => f.kind === 'README')
  const agentsFile = discovery.priorityFiles.find((f) => f.kind === 'AGENTS')
  const claudeFile = discovery.priorityFiles.find((f) => f.kind === 'CLAUDE')
  const deploymentFiles = discovery.priorityFiles.filter((f) => f.kind === 'DEPLOYMENT_CONFIG')
  const hasPackageManifest = discovery.priorityFiles.some((f) => f.kind === 'PACKAGE_MANIFEST')

  const reconciliation = reconcileHandoff({ handoffText, repoFacts: snapshot })

  const migration = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    // Full tracked-file list, not just today's dirty diff — a sensitive file
    // already committed and sitting clean must still be detected.
    trackedAndUntrackedPaths: [...new Set([...snapshot.trackedFiles, ...snapshot.staged, ...snapshot.unstaged, ...snapshot.untracked])],
    readmeExcerpt: readmeFile?.text,
    instructionsExcerpt: [agentsFile?.text, claudeFile?.text].filter(Boolean).join('\n'),
    handoffText,
    declaredSensitive: false,
    activeGitOperation: snapshot.activeGitOperation,
    activeGitOperationKind: snapshot.activeGitOperationKind,
    handoffConflict: reconciliation.hasConflict,
    handoffConflictSummary: reconciliation.discrepancies.join(' '),
    dirty: snapshot.dirty,
    stagedCount: snapshot.stagedCount,
    unstagedCount: snapshot.unstagedCount,
    untrackedCount: snapshot.untrackedCount,
    discoveryConfidence: readmeFile || agentsFile || commandGuidance.hasKnownTestCommand ? 'HIGH' : discovery.priorityFiles.length ? 'MEDIUM' : 'LOW'
  })

  const health = assessRepositoryOnboardingHealth({
    activeGitOperation: snapshot.activeGitOperation,
    activeGitOperationKind: snapshot.activeGitOperationKind,
    conflicted: snapshot.conflicted,
    detached: snapshot.detached,
    dirty: snapshot.dirty,
    stagedCount: snapshot.stagedCount,
    unstagedCount: snapshot.unstagedCount,
    untrackedCount: snapshot.untrackedCount,
    missingWorktrees: [],
    largeUntrackedDirectories: largeUntracked,
    hasKnownTestCommand: commandGuidance.hasKnownTestCommand,
    hasReadme: !!readmeFile,
    hasInstructions: !!(agentsFile || claudeFile),
    hasPackageManifest,
    dependenciesInstalled: commandGuidance.dependenciesInstalled,
    handoffConflict: reconciliation.hasConflict,
    handoffConflictSummary: reconciliation.discrepancies.join(' '),
    deploymentConfigPresent: deploymentFiles.length > 0,
    deploymentConfigFiles: deploymentFiles.map((f) => f.relativePath)
  })

  const maturity = assessMaturity({ snapshot, hasReadme: !!readmeFile, hasTestCommand: commandGuidance.hasKnownTestCommand, hasInstructions: !!(agentsFile || claudeFile) })

  const orcaCheck = await findRegisteredOrcaRepo(snapshot.root)

  const direction = await invokeLiveStructuredAnalysis({
    systemPrompt: DIRECTION_SYSTEM_PROMPT,
    prompt: buildDirectionPrompt({ snapshot, discovery, commandGuidance, reconciliation, health, migration }),
    jsonSchema: DIRECTION_SCHEMA,
    // Schema-constrained multi-part reasoning genuinely takes longer than a
    // conversational chat turn (observed ~35s for a small repo, sometimes
    // 2min+ for a larger real repo with more discovered facts) — this is a
    // one-shot analysis call, not a responsiveness-sensitive chat reply.
    timeoutOverrideMs: 180000
  })

  const projectId = slugify(path.basename(snapshot.root))

  return {
    ok: true,
    schemaVersion: 'TSF_ONBOARDING_ANALYSIS_V1',
    analyzedAt: new Date().toISOString(),
    projectId,
    displayName: path.basename(snapshot.root),
    repoPath: snapshot.root,
    identity: {
      root: snapshot.root,
      gitDir: snapshot.gitDir,
      branch: snapshot.branch,
      detached: snapshot.detached,
      head: snapshot.head,
      tree: snapshot.tree,
      remotes: snapshot.remotes,
      commitCount: snapshot.commitCount
    },
    currentState: {
      dirty: snapshot.dirty,
      staged: snapshot.staged,
      unstaged: snapshot.unstaged,
      untracked: snapshot.untracked.slice(0, 50),
      untrackedTruncated: snapshot.untracked.length > 50,
      conflicted: snapshot.conflicted,
      activeGitOperation: snapshot.activeGitOperation,
      activeGitOperationKind: snapshot.activeGitOperationKind,
      recentCommits: snapshot.recentCommits,
      localBranches: snapshot.localBranches,
      worktrees: snapshot.worktrees
    },
    maturity,
    health,
    migrationClassification: migration,
    portfolioGating: portfolioGatingForClassification(migration.classification),
    handoffReconciliation: reconciliation,
    orcaRegistration: orcaCheck.ok
      ? { checked: true, registered: orcaCheck.registered, repo: orcaCheck.repo }
      : { checked: false, registered: false, reason: orcaCheck.reason, detail: orcaCheck.detail },
    discovery: {
      priorityFiles: discovery.priorityFiles.map((f) => ({ relativePath: f.relativePath, kind: f.kind, truncated: f.truncated, bytes: f.bytes })),
      discoveredDirectories: discovery.discoveredDirectories,
      scanTruncated: discovery.scanTruncated,
      commandGuidance
    },
    direction: direction.ok
      ? { ...direction.data, live: true, providerLabel: providerLabel({ agentId: direction.agentId, model: direction.model }) }
      : { live: false, providerLabel: fallbackLabel(direction.reason), unavailableReason: direction.reason, unavailableDetail: direction.detail, purpose: null, completedSummary: null, unfinishedSummary: null, alignment: 'UNKNOWN', recommendedNextMission: null, upgradeCandidates: [] }
  }
}

// Commit step: persists into the real tsf/domain/portfolio.mjs structure and
// attempts Orca registration. Only ever called after Tim reviews an
// analysis — registration is the one write-adjacent action onboarding is
// allowed to take automatically (section 17), and it only registers repo
// metadata in Orca, never touches Git or creates a worktree.
export async function commitOnboarding({ portfolio, analysis, addTo, previousReceiptHash = null, clock }) {
  const gating = portfolioGatingForClassification(analysis.migrationClassification.classification)
  const wantsKnown = addTo?.knownProjects !== false
  const wantsActiveFleet = !!addTo?.activeFleet && gating.activeFleet.allowed
  const wantsWorkSet = !!addTo?.workSet && gating.workSet.allowed && wantsActiveFleet

  let nextPortfolio = portfolio
  const alreadyKnown = !!portfolio.projects[analysis.projectId]
  if (wantsKnown && !alreadyKnown) {
    nextPortfolio = registerProject(
      nextPortfolio,
      { id: analysis.projectId, displayName: analysis.displayName, root: analysis.repoPath, sourceClass: 'REAL', lifecycle: 'ONBOARDED', provenance: 'TSF_ONBOARDING_V1' },
      clock
    )
  }
  if (wantsKnown) {
    const activeFleetIds = wantsActiveFleet ? [...new Set([...nextPortfolio.activeFleet, analysis.projectId])] : nextPortfolio.activeFleet.filter((id) => id !== analysis.projectId)
    nextPortfolio = setActiveFleet(nextPortfolio, activeFleetIds, clock)
    const workSetIds = wantsWorkSet ? [...new Set([...nextPortfolio.workSet, analysis.projectId])] : nextPortfolio.workSet.filter((id) => id !== analysis.projectId)
    nextPortfolio = setWorkSet(nextPortfolio, workSetIds, clock)
  }

  let orcaRegistration = null
  if (wantsKnown) {
    const registration = await registerOrcaRepo(analysis.repoPath)
    orcaRegistration = registration.ok
      ? { attempted: true, ok: true, alreadyRegistered: !!registration.alreadyRegistered, repo: registration.repo }
      : { attempted: true, ok: false, reason: registration.reason, detail: registration.detail }
  }

  const receipt = buildOnboardingReceipt({
    projectId: analysis.projectId,
    repoPath: analysis.repoPath,
    classification: analysis.migrationClassification.classification,
    addedTo: { knownProjects: wantsKnown, activeFleet: wantsActiveFleet, workSet: wantsWorkSet },
    orcaRegistration,
    previousReceiptHash,
    clock
  })

  return { portfolio: nextPortfolio, receipt, orcaRegistration }
}
