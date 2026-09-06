# Dataset Research Engine V0 — Final Reconciliation

Historical lane: `dataset-research-engine-v0` @ `32b175fa9b` (branch
`tsf/feature/dataset-research-engine-v0`), retired as part of this
reconciliation. Its full requirements backlog is preserved verbatim
alongside this doc: `DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md`.

Confirmed before any decision below: `git diff --name-status 182c123f5e
32b175fa9b -- tsf/domain tsf/server tsf/adapters` (from the fork point)
is empty — the branch's entire 76-commit tail lives under
`tsf/fixtures/`, `tsf/test/`, and root-level docs/scripts. It never
touched a live domain/server/adapters file after diverging from the
platform-chain lineage that became today's canonical `tsf/main`.

## Seven candidate fixture modules — final disposition

| Module | Decision | Landed as |
|---|---|---|
| `identity-collision-resolver.mjs` | PORT, adapted | `domain/identity-collision-resolution.mjs` — generalized field vocabulary (caller-supplied `disambiguatingFields`, was hardcoded to `position/team/providerId`), candidate shape aligned to the real `candidateEntityRefs`/`entityId` shape, 3-way result mapped onto `research-admission.mjs`'s real `RESOLVED`/`AMBIGUOUS`/`UNRESOLVED` enum (was its own `RESOLVED`/`IDENTITY_REVIEW`/`NO_CANDIDATES`). Both specifically-claimed historical bug fixes (crash on undefined evidence; over-broad contradiction-key scan) independently re-verified real and correctly fixed, by direct reproduction against pre-fix and post-fix code. |
| `evidence-gated-confidence-upgrade.mjs` | PORT, unchanged | `domain/evidence-gated-status-upgrade.mjs` — already fully generic (caller-supplied ordering), only the header comment updated. |
| `chain-of-custody-status.mjs` | PORT, unchanged | `domain/source-chain-of-custody.mjs` — already fully generic. |
| `nfl-team-alias-normalization.mjs` | REJECT for platform promotion | Not ported — genuinely NFL-specific data (era/provider team-code aliases), correctly scoped to a customer mission's own fixtures, not the generic TSF domain layer. |
| `stat-value-completeness-validator.mjs` | PORT, unchanged | `domain/raw-value-completeness-validator.mjs` — already fully generic (parametric `categoryField`/`statColumns`). |
| `team-claim-contamination-classifier.mjs` | PORT, generalized | `domain/claimed-value-temporal-classifier.mjs` — algorithm was already domain-neutral; renamed and re-parameterized (`claimedTeam`→`claimedValue`) to remove sport-specific naming; the one NFL-specific placeholder token (`'FA'`, free-agent marker) dropped from the generic placeholder set. |
| `scoring-format-usability-validator.mjs` | PORT the function, REJECT the constant | `domain/column-requirement-usability-validator.mjs` — the two functions were already generic; `STANDARD_FANTASY_SCORING_REQUIREMENTS` (an NFL-fantasy-specific ruleset) is deliberately not ported, since a mission-scoped ruleset belongs in that mission's own fixtures. |

All 5 ported modules re-tested in their new location and shape: 12+15+10+7+8+4 = 56 tests, 56/56 pass. All were dependency-free before and after porting (no new coupling introduced anywhere).

## Identity collision resolver — adversarial verdict

Independently, adversarially re-verified rather than trusted from prior claims:
- **Uncaught TypeError on undefined evidence**: confirmed real (reproduced the actual pre-fix crash against pre-fix source) and confirmed fixed (`?? {}` default at the correct scope in the final code).
- **Overly broad contradiction-key scanning**: confirmed real (reproduced a false-positive block from an unrelated caller-supplied field against pre-fix source) and confirmed fixed (scoped to the declared field list in both branches of the final code). Adversarial search for a remaining over-broad-matching gap (e.g. partial/substring key overlap) found none — every comparison in the module is strict equality over a fixed field list, no fuzzy/substring logic exists anywhere in it.
- Freshly re-run test suite (not a historical claim): 12/12 pass at the historical HEAD before porting.
- Current main had a real, populated, enforced RECORD/ENFORCE layer for identity resolution (`recordIdentityResolutionState`, `IDENTITY_RESOLUTION_STATES`) but no DECISION algorithm computing which state applies — this module fills exactly that gap, not a competing authority.

## REQ-002 / REQ-004 / REQ-005 — before/after

**REQ-002 (generic Platform Learning Ledger)**: confirmed **STILL_OPEN** — no generic, cross-mission, queryable learning-ledger module exists anywhere in current main. Classified **DEFERRED_FUTURE_ROADMAP**: this asks for a new, open-ended platform capability (an accumulating cross-mission knowledge store), not a small bounded fix, and is out of this reconciliation's scope per its own "not permission to begin a new broad Research-platform architecture wave" instruction. Preserved here and in the backlog doc for a future, separately-authorized mission.

**REQ-004 (bidirectional completeness / typed-reason missingness)**: confirmed **STILL_OPEN**, and confirmed materially deeper than the original filing's own synthetic evidence showed — the live admission path (`research-admission.mjs`) had `missingnessType` hard-coded to one single literal (`NOT_PUBLICLY_AVAILABLE`) in every real dispatch, so even a naive aggregation fix would have had no real variety to report yet. **Closed in this reconciliation**:
- `domain/research-completeness.mjs`'s `computeCompletenessMetrics` now additionally returns `observedNotExpectedEntityIds`/`observedNotExpectedCount` (the reverse direction: an entity actually researched that was never in `expectedUniverse.expectedEntities` at all) — `null` (never fabricated as 0) when no named expected-entity list exists to compare against.
- `typedMissingnessByReason` — a real breakdown of the existing flat `typedMissingnessCount` by each record's own `missingnessType`.
- `domain/research-admission.mjs`'s `TypedMissingness` construction now honors a caller-supplied `pc.missingnessType` (additive, backward compatible — no existing caller sets it, so today's behavior is unchanged) instead of a single hardcoded literal, so a future worker CAN report real variety once it has a real reason to distinguish.

**REQ-005 (typed, queryable acquisition-mode field)**: confirmed **PARTIALLY_SATISFIED** at the start of this reconciliation — `domain/web-source-access-gate.mjs`'s `ACQUISITION_MODES`/`ACCESS_CLASSIFICATIONS` taxonomy already existed (REQ-005's own exact proposed naming) and reached durable admission, but only nested inside `modeEvidence`'s raw receipt blob, never as a top-level queryable field. **Closed in this reconciliation** for the one acquisition method that computes it: `adapters/web-table-research-worker.mjs`'s `buildSourceSnapshot` now promotes `acquisitionMode`/`accessClassification` to top-level fields on the `SourceSnapshotReference`, carried through `research-admission.mjs`'s admission path and the JSON schema, additive and backward compatible.

Remaining, explicitly **not** built here (both correctly out of scope, per the mission's own Phase 9 boundary — "stronger auth/paywall handling" is named there verbatim):
- `OWNER_SUPPLIED_LOCAL_ARTIFACT` has no producer anywhere in current main — building a real local-artifact ingestion path is a new capability, not a bounded delta.
- `AUTHENTICATED_OFFICIAL_DOWNLOAD` is unreachable from the one live caller (`web-table-research-worker.mjs` hardcodes `authenticationRequired: false`) — real auth/paywall detection is the same deferred item already tracked as a "KNOWN GAP" comment in that file.
- `BULK_SOURCE_FIRST_HTTP`/`CROSS_MISSION_SOURCE_LIBRARY_REUSE` snapshots still carry no rights/access classification at all (only `acquisitionMethod`) — neither path has a natural way to determine one today; left `null` rather than fabricated.

None of the remaining REQ-005 gaps require resurrecting the stranded `web-table-adapter-main-integration-v1`/`admitSourceSnapshot`-mapper architecture already rejected in the prior Web Source Acquisition reconciliation (`313b64139e`) — every closure here is additive on the current `BoundedResearchWorker`/`providerRunId` architecture.

## Unverified packet claims — resolved

The final historical packet's claims (identity-collision-resolver's later fixes; REQ-004/REQ-005 filings; benchmark numbers; a ~1,334-test full-suite claim) were independently re-verified rather than trusted:
- Both later identity-collision-resolver fixes: confirmed real by direct reproduction (see above).
- REQ-004/REQ-005 filings: located and read verbatim (`DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md`, preserved alongside this doc).
- Cold-vs-warm Research Library reuse benchmark and the 10k/100k scale benchmark: the benchmarked capability (`domain/research-library.mjs`) is confirmed byte-identical, unchanged in current main since the historical branch's fork point — the specific historical millisecond/throughput numbers were not chased (real host-contention variance makes them non-reproducible as exact figures; the underlying capability's correctness, not its historical timing, is what matters), consistent with "test the invariant instead of an obsolete metric."
- The ~1,334-test claim: confirmed obsolete as a literal number (current main has grown far past it) and correctly not chased — this reconciliation's own test counts are reported in the return, not the historical figure.

## Deferred future roadmap (preserved, not built)

- REQ-002: generic Platform Learning Ledger.
- `OWNER_SUPPLIED_LOCAL_ARTIFACT` acquisition-mode ingestion.
- Real paywall/authentication detection (`AUTHENTICATED_OFFICIAL_DOWNLOAD` reachability).
- REQ-003 (chain-of-custody/rights-confidence strength as a first-class mission dimension) — `evidence-gated-status-upgrade.mjs`/`source-chain-of-custody.mjs` are now ported as available, tested platform primitives, but neither is wired into any real mission dispatch path yet; that wiring remains open, separately-authorized future work.
- `schemaFingerprint`/`selectorOrAdapterVersion`/`transformationVersion` (the richer `SourceSnapshotReference` shape originally proposed alongside REQ-005) — not implemented; only `acquisitionMethod`/`modeEvidence`/`acquisitionMode`/`accessClassification` were adopted.

None of the above were started in this reconciliation.
