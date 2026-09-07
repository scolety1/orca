# Larger Astra Follow-up Benchmark (Phase 5) — Investigation + Ready-to-Run Design

Status: **NOT RUN. Investigation only.** No real paid model call was made or
attempted while producing this document. See the Phase 5 section of
`AUTONOMOUS_POST_CLEANUP_UPGRADE_PROGRAM_V1_CHECKPOINT.md` for the full
narrative; this doc is the design artifact that checkpoint entry references.

## Why this wasn't run

1. **No prior "initial A-E benchmark" artifact exists anywhere in this
   repository.** Exhaustive search (`tsf/docs/tsf/`, `tsf/domain`,
   `tsf/server`, git history/commit messages across all branches, and a
   whole-repo grep for `astra`/`gpt-6`) found zero docs, code, fixtures, or
   commits referencing a prior baseline-vs-Astra comparison. The only
   occurrence of the word "Astra" anywhere in the tracked tree, before this
   phase, is the Phase 5 row-name in the program checkpoint's own status
   table (`NOT_STARTED`). The directive's summary of that benchmark's
   result cannot be independently confirmed from this codebase — it is
   recorded here as unverifiable, not accepted at face value.
2. **`gpt-6-astra` is not an available/reachable model anywhere in this
   environment.** `tsf/routing/provider-role-mappings.v1.json` and
   `tsf/providers/launch-profiles.v1.json` are the real, committed routing
   config `resolveRole` resolves against — they define exactly two launch
   profiles, `CODEX_SAFE` (`providerId: openai`, `agentId: codex`, status
   `VALIDATED_WINDOWS_FIXTURE`) and `CLAUDE_SAFE` (`providerId: anthropic`,
   `agentId: claude-code`, status **`CONFIGURED_RUNTIME_UNAVAILABLE`** in
   this environment). Neither names, aliases, or resolves to anything
   called Astra/gpt-6-astra. A real dispatch always launches the user's own
   already-authenticated Codex or Claude Code CLI through
   `tsf/providers/safe-provider-launch.mjs` — there is no generic
   "call any named external model by string" path in this codebase at all.
   The one literal appearance of `gpt-5.6-sol` in the repo
   (`tsf/programs/daily-driver-autonomy-v1/state.json`, wave 11) is a
   narrative log entry describing a real, already-authenticated Codex CLI
   dispatch from an unrelated prior program (M3 daily-driver autonomy
   dogfooding) — not a benchmark mechanism, and not evidence that a model
   literally identified as "gpt-6-astra" exists or is reachable.
3. **No existing authorized budget/quota covers this comparison.** The one
   paid-provider-approval mechanism found,
   `tsf/domain/research-paid-approval.mjs`, is explicitly scoped to
   Research-mission paid providers (Exa/Parallel) and requires an explicit,
   per-mission owner grant naming one provider and one spend ceiling — it
   is a different subsystem for a different concern, as the task's own
   framing anticipated, and grants nothing here. No env var, config flag,
   or Needs-You grant anywhere authorizes a model-routing/model-comparison
   spend of any kind.
4. **The eval-pack harness (`tsf/domain/evaluation-pack.mjs` +
   `tsf/server/eval-pack-registry.mjs`) is pure/synthetic by construction.**
   Every registered pack (`PLANNER`, `WORKER`, `VERIFIER`, `ROUTING`,
   `MEMORY`, `AUTONOMY`, `ESTIMATOR`, `UI_DOGFOOD`) asserts against a real
   domain function's output from a synthetic/fixture input — none of them
   ever dispatches a live model call. It is a sound harness *shape* to
   extend (packId/cases/assertions/actualOutput), but "run this pack" today
   can never mean "call a real paid frontier model" for any existing pack,
   and extending it to do so is exactly the new capability gated below.

Conclusion: this is `ASTRA_MORE_EVIDENCE_NEEDED` for a reason stronger than
"needs more samples" — the specific model this phase was asked to evaluate
is not a reachable option in this environment at all, and the benchmark
that would need to exist first (however small) to substantiate the
directive's "already complete" framing does not exist in this codebase
either. Nothing was simulated or fabricated to manufacture a result.

## Ready-to-run design (for the moment gpt-6-astra, or its current real
equivalent, is a genuinely reachable, owner-authorized paid provider)

This section is deliberately concrete enough to execute without further
design work once (a) a real, reachable model identifier and provider
adapter exist for "Astra" (or its current equivalent) in
`tsf/providers/launch-profiles.v1.json`, and (b) the owner has explicitly
authorized a named spend ceiling for this comparison, mirroring
`research-paid-approval.mjs`'s existing pattern (explicit provider name +
explicit $ ceiling, never inferred).

### Task set

8 categories per the original spec, 4 tasks each = **32 tasks**
(meaningfully larger than the prior 5-task A-E pass, still bounded):

1. Bounded implementation (small, self-contained feature/fix with a clear
   acceptance test)
2. Bug diagnosis (reproduce + root-cause a real or injected defect, no fix
   required to score the diagnosis)
3. Architecture reconciliation (read 2+ conflicting docs/modules, produce a
   reasoned adoption/rejection decision)
4. Adversarial code review (a diff seeded with 1-2 real-shaped defects,
   scored on defects found vs. false positives raised)
5. Long-horizon multi-step mission planning (a goal requiring a sequenced
   plan across several dependent steps, scored on plan soundness, not
   execution)
6. Ambiguous/conflicting evidence resolution (two sources disagree; scored
   on whether the resolution is evidence-grounded and honestly hedged)
7. Test repair (a genuinely failing test + code; scored on whether the fix
   addresses the real defect vs. papering over the assertion)
8. Repo-navigation/reconciliation (find the real existing mechanism for a
   named concern before it's built; scored like this very investigation)

Tasks should be drawn from real, already-completed TSF/Orca work
(anonymized where necessary) so a known-good reference answer exists for
scoring — never invented tasks with no ground truth.

### Fairness methodology

- Identical prompt, identical repo snapshot (pinned commit), identical
  tool/file access, identical time/turn budget per task, for both models.
- Task order randomized per model to control for any drift across a run.
- Each task run once per model per this pass (paired, not crossed) — no
  self-consistency/best-of-N sampling, to keep the cost bounded and the
  comparison apples-to-apples with the original A-E pass's own paired
  design (per the directive's own description of it).

### Scoring

- Blind: the scorer (a third, independent model or a human reviewer) sees
  only the task and the two anonymized outputs (labeled A/B, order
  randomized per task), never which model produced which.
- Rubric per task: correctness (does it solve the real problem),
  groundedness (claims match real evidence, no fabrication), safety
  (no unauthorized destructive action, no scope creep beyond the task),
  and — for the long-horizon category specifically — plan robustness to a
  named failure mode.
- Aggregate to a per-category win/tie/loss table plus an overall paired
  win rate; report the raw table, not just a single verdict, so a human
  reviewer can see where any signal concentrates.

### Cost estimate

**Unknown — no pricing data for a model called "Astra"/"gpt-6-astra"
exists anywhere in this codebase or was looked up externally in this pass
(this investigation deliberately made no external network calls to price
a model that isn't confirmed to exist).** Flag for owner: before
authorizing spend, supply (a) the real provider + model identifier this
maps to today, (b) that provider's real per-token pricing, and (c) an
expected token budget per task (prompt + tool-call context + completion)
so a concrete `N tasks × 2 models × M tokens × $/token ≈ $X` figure can be
computed honestly, rather than guessed here.

### Result categories (unchanged from the directive)

`ASTRA_NO_ROUTING_CHANGE` / `ASTRA_MORE_EVIDENCE_NEEDED` /
`ASTRA_ROUTING_CHANGE_RECOMMENDED` — recording a recommendation only; no
routing config (`provider-role-mappings.v1.json` / `launch-profiles.v1.json`)
changes as part of this or any future run of this design without a
separate, explicit owner decision.
