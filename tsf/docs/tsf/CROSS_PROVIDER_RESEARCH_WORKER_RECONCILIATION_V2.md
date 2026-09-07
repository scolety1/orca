# TSF/Orca — Cross-Provider Research Worker Reconciliation V2

`NWR_CROSS_PROVIDER_RESEARCH_CAPABILITY_RECONCILED_V2`

## 1. Why the prior NWR research session was Claude-only

Root cause is layered, both parts confirmed against real code/config:

- **Primary — `CLAUDE_PEER_AGENT_TOOL_ONLY`.** The mission used the Claude
  Code Agent/subagent (Remote-Control peer-agent) tool, which is Claude-only
  by the harness's own design (its `subagent_type`/`model` parameters name
  only Claude agent types and Claude models). This is not TSF/Orca code and
  not this program's to change.
- **Secondary — `CODEX_ROLE_NOT_DEFINED_FOR_RESEARCH`.** Even had the
  mission used TSF's real `ResearchMission`/`BoundedResearchWorker`
  pipeline instead, it would still have found no LLM-knowledge-probe
  worker — every pre-existing adapter (web-table, Exa, Parallel,
  owner-supplied-local-artifact, authenticated-official-download) is a
  grounded, citation-required acquisition mechanism. No adapter, for any
  provider, ever treated a model's own latent knowledge as a candidate
  source.
- The mission's own claim ("no OpenAI/Codex access exists in this
  environment") was **factually wrong** — see §2.

## 2. Current Codex capability (verified live)

`tsf/routing/provider-capabilities.v1.json`: `openai/codex` is
`AVAILABLE`, `subscriptionBacked: true` (codex-cli 0.144.1);
`anthropic/claude-code` is `UNAVAILABLE_ON_VALIDATION_HOST` as a launch
profile on this specific host. `CODEX_HOME`'s `auth.json` shows a live,
actively-refreshed ChatGPT-OAuth session (`auth_mode: "chatgpt"`,
`OPENAI_API_KEY: null`). A bounded "PONG" round-trip proved the CLI
answers a plain non-coding prompt using this existing session, in a
disposable throwaway repo, with the real TSF sandbox flags
(`-s workspace-write`, network access off, no approval-bypass). Codex is
not coding-execution-only — it's a general prompt interface already used
that way by `live-planner.mjs`.

Incidental finding (not fixed here, out of this reconciliation's scope):
`live-planner.mjs`'s Codex fallback branch invokes `codex exec` from a
bare OS-tmp `NEUTRAL_CWD` with no `--skip-git-repo-check`; Codex refuses
non-git directories without that flag. This may make the documented
PLANNER_DEEP→Codex fallback fail if actually exercised from that cwd —
flagged as a follow-up, not evaluated further here.

## 3. ChatGPT vs. Codex-CLI vs. OpenAI-API-billing, for this environment

Same underlying authenticated ChatGPT account/session — not two separate
subscriptions. No separate, newly-metered OpenAI API billing surface was
engaged by anything in this reconciliation (`OPENAI_API_KEY` stays `null`
throughout; the genuinely separate paid surface, Exa/Parallel research
providers, was not touched).

## 4. Real platform defect — confirmed and fixed

A real, narrow gap existed: no `BoundedResearchWorker` adapter anywhere
treated LLM latent knowledge as a candidate-generation source. Not a
billing/auth wall (Outcome C) — the generic, already-proven-live
invocation plumbing (`routing.mjs`'s `resolveRole`, `live-planner.mjs`'s
`invokeLiveStructuredAnalysis`, already used narrowly by
`field-source-reconciliation.mjs`) existed and needed only a new,
disciplined consumer (Outcome B).

## 5. Implementation

`tsf/adapters/llm-latent-knowledge-research-worker.mjs` — new
`BoundedResearchWorker`. Reuses `invokeLiveStructuredAnalysis` (the
`PLANNER_DEEP` role) verbatim rather than adding a new routing role
(routing config's role set is documented as a small, closed, "stable"
set; adding a role would have widened that one proven entrypoint's
contract too). Honesty guarantees enforced in code, not just docs:
`evidence`/`sourceReferences` always empty; the one
`SourceSnapshotReference` it ever produces carries
`provenanceStrength: NONE` (the weakest tier) and a real, never-hardcoded
`providerId`/`agentId`/`model`/`role`; a genuine provider-unavailable
failure is reason-code-disjoint from a genuine model-reported `UNKNOWN`;
only `status === 'KNOWN'` with a real value ever becomes a claim. Gated
behind `TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED` (default off,
its own trust-category opt-in, distinct from the paid-dispatch gate since
this worker spends no new money but is a fundamentally different trust
category than a $0 web fetch). Never wired into the free autonomous
driver (`research-mission-fleet-driver-bootstrap.mjs`) — confirmed by a
real test reading that file's source, not just a comment.

Additive: `registerDispatchedWorker` (`planner-mission-checkpoint.mjs`)
gained optional `providerId`/`agentId` fields, forwarded from
`PlannerSessionLifecycle` only when a real dispatcher reports them —
existing callers unaffected.

12 new unit tests + 1 regression test, all passing, dependency-injected
(no live provider call in the worker's own test suite). Full-suite
regression run showed byte-identical pre-existing failure set before/
after. `npx oxlint` clean.

**Adopted** @ `b1ef3f1a779c33c1de1ef8104539e4deaaf5abf8`, pushed to
`fork/tsf/main` (verified), temporary worktree retired.

## 6. Golden cross-provider proof (Phase 6)

One bounded, supervised run, `TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED=1`
set only for this single invocation, never persisted:

- **Claude side**: a clean Agent-tool subagent (no shared context with
  this mission's control values or the Codex side), asked the identical
  5-player question set.
- **Codex side**: the newly-adopted production worker, invoked directly
  (`createLlmLatentKnowledgeResearchWorker().dispatch(...)`), which
  routed through the real `CLAUDE_SAFE → CODEX_SAFE` fallback chain —
  resolving to a real Codex CLI call since `CLAUDE_SAFE` is unavailable
  as a launch profile on this host.
- Neither side saw the other's answer or any ground-truth value before
  both were frozen.

**Result: 5/5 UNKNOWN on both sides**, including all four
independently-grounded controls (Lance Moore 2008, Reggie Wayne 2007,
Antonio Brown 2017, Julio Jones 2017) and Jarvis Landry 2017. Both
providers, when explicitly forbidden from calculating/estimating,
declined to report an exact PFF routes-run/snaps-in-route figure for any
of the five player-seasons asked. Full transcripts of both sides are
preserved in this session's own record; not duplicated here to avoid a
stale, unmaintained copy.

## 7. Jarvis Landry 2017 resolution

**`LANDRY_2017_REMAINS_UNVERIFIED`.** Neither blind probe produced a
candidate value to use as a search anchor. Independent free-public-web
research (11 searches/fetches: PFF's own public pages, PlayerProfiler,
FantasyPros, Pro-Football-Reference, StatMuse, 2017-18 retrospective and
trade-value coverage) found no corroboration for the owner's remembered
"600" figure or any other specific routes-run/snaps-in-route number for
that season. "Routes run" is specifically PFF's proprietary charting
stat; PFF's public player pages show only recent-season data without a
subscription, and this mission was explicitly directed not to purchase
or contact PFF. The 600 figure should continue to be treated as
unverified, not as ground truth.

## 8. Was the prior 2008 Claude-only experiment provider-incomplete?

**No.** A real, currently-available non-Claude path (Codex, via the
newly-adopted worker) was tried on the same class of question and
produced the same result pattern (no confident recall) as the
Claude-family probes, including on values described as independently
grounded. The original 30/30 UNKNOWN result was not an artifact of only
testing one provider family — it now stands corroborated across two
independent, currently-available provider families. No further scaling
(e.g. toward the full 436-player set) is warranted on this basis, per
this mission's own explicit bound.

## 9. Does this change the PFF-purchase conclusion?

No. This reconciliation neither recommends nor discourages a PFF
purchase — that remains explicitly out of scope here — but it does
establish that **LLM latent-knowledge recall is not currently a
productive substitute source** for this specific proprietary charting
metric, across both available provider families. If exact PFF
routes-run/snaps-in-route figures are needed for Jarvis Landry 2017 or
similar historical player-seasons, the evidence here points toward a
real PFF data source (subscription or an already-authorized alternative)
being the only reliable path, a decision that remains the owner's.

## 10. Recommended next action

No further autonomous action on this specific mission — it has reached a
clean, evidence-based stopping point on every phase this reconciliation
was scoped to answer. If the owner wants Jarvis Landry's real 2017 routes
figure, the next action is an owner decision (authorize a bounded PFF
data purchase, or accept the value as permanently unverified). The new
`llm-latent-knowledge-research-worker.mjs` capability itself is now a
permanent, generic, opt-in-gated part of the research platform, available
for other bounded knowledge-recall tasks whenever a mission judges the
low provenance tier acceptable for its purpose — it should never be
silently promoted to canonical/verified status for any dataset,
including NWR's.
