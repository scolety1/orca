# Dataset Research Platform Requirements Backlog

Tracks `DATASET_RESEARCH_PLATFORM_REQUIREMENT` items raised by customer
lanes (e.g. NWR Historical Redraft Data) against the generic Dataset
Research engine, per the process in
`NWR_HISTORICAL_REDRAFT_DATASET_RESEARCH_HANDOFF.md`'s "Platform
requirement process" section. Each item is classified
`ALREADY_SUPPORTED` / `GENERIC_GAP` / `NWR_SPECIFIC` / `DEFERRED`.
**Filed here for later, generic-governance implementation — never
implemented ad hoc mid-customer-mission.**

## REQ-001: Per-field incremental dispatch onto an already-ADMITTED node

**Classification: GENERIC_GAP (real, confirmed; deferred, not fixed mid-mission)**

**Found by:** `mission:nwr-historical-redraft-calibration-v0` (NWR
Historical Redraft Data customer mission), while attempting to add a
single additional field (`rawStatsWk17Classification`) onto a
season-audit node that had already completed its one real dispatch
cycle and reached `ADMITTED`.

**What happens today:** `computeTaskFingerprint`
(`domain/research-node.mjs`) is keyed on `{nodeId, researchQuestion,
requestedOutputSchema, provider}` — node-level identity, not per-field.
Calling `dispatchResearchNodeDurable` a second time against an
already-`ADMITTED` node produces the same fingerprint as the original
dispatch, so the fingerprint-based dedup either treats it as an
already-resolved duplicate, or — if a genuinely new
`BoundedResearchResult` is forced through anyway — `recordResearchNodeResult`
correctly refuses the `ADMITTED -> RESULT_RECEIVED` transition
(`NODE_ALLOWED` in `domain/research-mission.mjs` has no such edge).
Confirmed live: attempted it, the durable store refused before
committing anything, mission revision/node status verified unchanged
after the failed attempt (no corruption, no partial state — the
fail-closed behavior worked exactly as designed).

**Real-world need:** a research mission legitimately discovers it wants
ONE more field of information about an entity/node whose original
dispatch cycle already completed and admitted — without wanting to
duplicate the whole node, re-pay for a full re-dispatch of everything
already known, or force an architecturally-illegal state transition.

**Workaround used (bounded, this mission only):** recorded the
additional finding as a standalone durable JSON artifact alongside the
mission (same pattern as the mission's own pre-existing
`RAW_STATS_STRUCTURAL_FINDING`/`STABLE_ID_FINDING` records), rather than
as a mission `Claim`/`CanonicalFact`. Honest and durable, but not
part of the mission's own real epistemic ladder / completeness metrics
— a real, disclosed limitation of this workaround, not a silent gap.

**Possible generic fix shapes (not designed or committed to here — future
work, needs its own design pass):**
- A new driver primitive, e.g. `dispatchAdditionalFieldDurable`, that
  computes a field-scoped fingerprint (or otherwise legitimately allows
  a `ADMITTED -> READY -> DISPATCHED -> RESULT_RECEIVED -> ADMITTED`
  cycle for a specific NEW field without touching the node's existing
  claims/facts for its original fields).
- OR: formalize "append a field-scoped sub-node" as the sanctioned
  pattern instead (a new node referencing the same `targetEntity`,
  distinguished by which fields it covers) — arguably already possible
  today without any engine change, just a documentation/convention gap
  (a customer lane could already do this by creating
  `node:season-2018-source-audit-wk17-followup` instead of trying to
  mutate the original node). Worth deciding which shape is the real,
  intended generic pattern before building anything.

**Do not implement without a real HQ/platform-owner decision on which
shape is correct** — this note exists so the choice is made
deliberately, not mid-customer-mission.

## REQ-002: No generic first-class "Platform Learning Ledger"

**Classification: GENERIC_GAP (real, confirmed; deferred, not fixed mid-mission)**

**Found by:** `mission:nwr-historical-redraft-calibration-v0`, while
searching for an existing repo-native mechanism to record cross-checkpoint
platform learning (source knowledge, acquisition performance, data-quality
lessons, architecture classification, reusable assets, engine evaluation)
per Tim's RECONCILE-LEDGER-CONTINUE directive.

**What exists today, and why none of it is a real match:**
- `domain/research-dispatch-bookkeeping.mjs`'s "attempt ledger" — real,
  but scoped to per-node dispatch-attempt delivery-guarantee
  classification (`EXACTLY_ONCE`/`AT_MOST_ONCE`/etc.), not mission-level
  learning.
- `migration/capability-migration.v1.json` /
  `docs/architecture/TSF_CAPABILITY_PRESERVATION_LEDGER.md` — a real
  ledger, but for legacy-system capability-migration tracking, a
  different domain entirely.
- `pilots/first-real-project-v1/result-capsules.json` — a real,
  structured per-mission result-capsule format (worker identity, repo
  head/tree, files changed, tests run), closer in *spirit* but scoped to
  one specific pilot mission's own delivery record, not a reusable,
  generic, cross-mission learning-ledger concept.

**Real-world need:** Dataset Research customer missions (this one
included) repeatedly discover the SAME kind of platform-level lessons —
rights/access classification patterns, temporal-verification techniques,
identity-collision handling, contamination-detection methods, engine bugs
(e.g. this mission's own periodScope-mismatch recurrence, hit twice) —
with no generic place for that knowledge to accumulate and be found by
the NEXT customer mission instead of being re-discovered from scratch.

**Workaround used (bounded, this mission only):** a mission-scoped ledger
artifact was created directly in this mission's own results directory —
`fixtures/nwr-historical-redraft-results/platform-learning-ledger.json`
— covering the six requested categories (source knowledge, acquisition
performance, data-quality lessons, architecture classification, reusable
assets, engine evaluation) per major checkpoint this mission reached.
Honest and durable, but mission-scoped, not a generic platform mechanism
another customer mission would automatically discover.

**Do not implement without a real HQ/platform-owner decision** on where a
generic ledger should live and what its schema should be — this note
exists so that choice is made deliberately.

## REQ-003: No generic "temporal chain-of-custody strength" concept, independent of any one source's own settings

**Classification: GENERIC_GAP (real, confirmed; deferred, not fixed mid-mission)**

**Found by:** `mission:nwr-historical-redraft-calibration-v0`, during the
2026-09-04 rigorous multi-axis re-verification of the 2016-2019 official
FFA export seasons.

**Concrete evidence (the packet Main TSF HQ asked for):** Four
independently-verified seasons (2016, 2017, 2018, 2019 — different real
files, different real row counts, different real per-position stat
profiles) each received an explicit multi-axis status table
(`contentValid` / `identityValid` / `temporallyVerified` /
`rightsValid` / `admissionReady`, kept deliberately un-collapsed — see
`fixtures/nwr-historical-redraft-results/priority1-2016-2018-pack-rigorous-verification.json`
and `.../priority2-2019-rebuild-from-hashed-source.json`). All four
independently landed on the **identical** `temporallyVerified: YELLOW`
result, for the **identical** stated reason each time: "provenance
established per owner directive; no independent source_as_of
chain-of-custody timestamp found in the artifact itself." A coincidence
across four unrelated real files is unlikely — this reads as a real,
structural property of how this mission currently represents temporal
trust, not a one-off customer detail.

**What exists today:** This mission's own `temporalClassification`
vocabulary (`PROVEN_CONTEMPORANEOUS_PRESEASON` /
`BOUNDED_CONTEMPORANEOUS_PRESEASON` /
`PROVISIONALLY_CONTEMPORANEOUS_ARCHIVE` / `TEMPORALLY_UNVERIFIED` /
`RETROSPECTIVE_RECONSTRUCTION` / `BLOCKED_FUTURE_CONTAMINATION`) captures
*whether* a source is contemporaneous, but has no separate axis for
*how strongly the chain of custody from acquisition to admission is
itself evidenced* — e.g. "owner directive established provenance" is a
real but categorically weaker claim than "a cryptographically verified
session log ties this exact byte sequence to this exact authenticated
download event," and today both would be reported the same informal way
(free text in a `verdictRationale` field), not as a distinguishable,
queryable state.

**Real-world need:** Any acquisition mode that is NOT a simple public
download with its own embedded timestamp (i.e. `OWNER_SUPPLIED_LOCAL_ARTIFACT`
and `AUTHENTICATED_OFFICIAL_DOWNLOAD`, per the acquisition contract in
`shared-generic-acquisition-contract.json`) will hit this same gap —
this is not specific to FFA or to NWR.

**Workaround used (bounded, this mission only):** reported `YELLOW`
honestly and consistently in each season's own multi-axis status table,
rather than either silently upgrading to `GREEN` (overclaiming) or
blocking the whole season on it (which would be disproportionate given
the real, if informal, provenance basis that does exist).

**Do not implement without a real HQ/platform-owner design decision** on
what a generic chain-of-custody-strength axis should look like (a typed
enum? a numeric confidence score? a required-evidence checklist?) — this
entry exists to hand Main TSF HQ the concrete evidence packet requested,
not to pre-decide the shape.

**Addendum (2026-09-04, 2020-2025 discovery pass):** the same mission
found a real, sharper sub-case: files sitting in an owner-supplied
intake's *unorganized staging area* (not yet run through that intake's
own organizer/manifest process) warrant a **materially weaker**
chain-of-custody rating than files already organized and logged — today
both would be reported the same informal way. This suggests the eventual
generic axis should be able to represent at least: (a) no provenance
evidence at all, (b) provenance asserted but not yet processed/logged by
the source's own intake tooling, (c) provenance asserted and logged by
that tooling, (d) provenance independently, cryptographically verified.
Not a new REQ — folded into this one as sharper evidence for the same
underlying gap.

## REQ-004: `computeCompletenessMetrics` is one-directional (expected→present only) and reports missingness as a flat aggregate, not typed reason distributions

**Classification: GENERIC_GAP (real, confirmed; deferred, not fixed mid-mission)**

**Found by:** `mission:dataset-research-engine-unattended-hardening-v0`,
Priority 2A engine-coverage audit, by direct reading of
`domain/research-completeness.mjs` (the real, core, already-adopted
platform module implementing schema `TSF_COMPLETENESS_METRICS_V1`) and
`test/research-completeness.test.mjs` (confirmed via grep: no existing
test covers "observed not expected", "bidirectional", "reverse
direction", "typed reason", or "reasonDistribution").

**Concrete evidence:** `test/completeness-bidirectional-gap-evidence.test.mjs`,
a new, bounded, standalone test exercising the REAL, unmodified
`computeCompletenessMetrics` against a synthetic mission built with the
real `createResearchMission`/`addResearchNode` functions:
- Adding a node whose `targetEntity.entityId` is deliberately outside
  `expectedUniverse.expectedEntities` produces **no signal anywhere** in
  the returned metrics object — no `unexpectedEntityIds`, no
  `observedNotExpectedCount`, nothing. `expectedEntityCoverage` and
  `presentEntityCoverage` are both computed purely from the expected
  side; an entity that is genuinely present with real evidence but was
  never expected is structurally invisible.
- Two synthetic missions with completely different `typedMissingness`
  reasons on their sole node (`BLOCKED` — a real problem worth
  escalating — vs. `NOT_APPLICABLE` — a benign, expected non-answer)
  produce the **identical** `typedMissingnessCount: 1`. The real,
  different reasons exist on the node data itself but are never
  surfaced in the aggregate metrics a caller would actually look at.

**What exists today:** `expectedEntityCoverage` (ratio of expected
entities matched by present nodes) and `presentEntityCoverage` (ratio of
ADMITTED/COMPLETED nodes against `expectedCount`) — both directions of
"how much of what we expected did we get," never "did we get anything we
did NOT expect." `typedMissingnessCount` is a single integer, not broken
down by the reason vocabulary the node-level `typedMissingness` entries
already carry.

**Real-world need:** Priority 2A's own wording is "bidirectional
ExpectedUniverse ... require typed reason distributions ... population-level
reconciliation, not just example records" — this is a generic engine
property, independent of any one corpus. A source that returns entities
outside the declared expected universe (a real, plausible outcome of any
broad web/API scrape) currently reports as if nothing unusual happened at
the completeness-metrics layer, and two very different missingness
situations (a real blocker vs. an expected non-answer) are indistinguishable
to any caller reading only the aggregate metrics.

**Workaround used (bounded, this mission only):** documented the gap with
a real, evidence-only test against the unmodified module; did not modify
`domain/research-completeness.mjs` itself. No standalone candidate module
was built for this one — unlike REQ-001/002/003, the desired fix is not a
new, independent computation but a change to `TSF_COMPLETENESS_METRICS_V1`'s
own return shape (new fields on an existing, consumed schema), which is a
compatibility-sensitive decision for whoever owns that schema's consumers,
not something a dependency-free fixture module can safely stand in for.

**Do not implement without a real HQ/platform-owner design decision** on
the new field shape (e.g. `observedNotExpectedEntityIds: string[]`,
`typedMissingnessByReason: Record<string, number>`) and on backward
compatibility for existing consumers of `TSF_COMPLETENESS_METRICS_V1` —
this entry exists to hand Main TSF HQ concrete, reproducible evidence, not
to pre-decide the schema change.

## REQ-005: No typed, queryable `acquisitionMode` field -- the three acquisition modes converge in practice but only informally

**Classification: GENERIC_GAP (real, confirmed; deferred, not fixed mid-mission)**

**Found by:** `mission:dataset-research-engine-unattended-hardening-v0`,
Priority 2G acquisition-mode convergence assessment. Formalizes prior
analysis already on file in this branch
(`fixtures/nwr-historical-redraft-results/platform-gap-analysis-acquisition-modes.json`
and `.../shared-generic-acquisition-contract.json`, both recorded
2026-09-04) as a proper backlog entry, since that analysis had not yet
been routed through this document.

**Concrete evidence:** All three acquisition modes
(`OWNER_SUPPLIED_LOCAL_ARTIFACT`, `AUTHENTICATED_OFFICIAL_DOWNLOAD`,
`PUBLIC_WEB_SOURCE_EXTRACTION`) were **independently, really** exercised
through the identical `dispatchResearchNodeDurable` →
`pollAndAdmitResearchNodeDurable` → `verifyAndReconcileResearchNodeFieldDurable`
→ `admitReconciliationDecision` path this mission, using the same
`sourceReferences`/`sourceSnapshotsOrSnapshotRefs` shape every time —
differing only in what `sourceReferences.publisher` and
`sourceSnapshotsOrSnapshotRefs.rawContentRef` pointed at. **The
convergence itself already works and does not lose distinct
provenance** — this is a real, proven fact, not a design goal.

**What exists today:** No `acquisitionMode` field exists anywhere in the
current `ResearchNode`/`BoundedResearchResult`/`SourceReference` schema.
The distinction between the three modes has been carried entirely
informally, inside free-text publisher strings (e.g. `'FFA-GitHub
(public mirror, RIGHTS_UNVERIFIED)'` vs an authenticated-export
publisher string) — real, human-readable, but not a queryable,
enforceable, typed field a caller could filter or validate against.

**Real-world need:** Any future generic reconciliation/reporting logic
that needs to reason about acquisition mode specifically (e.g. "only
trust `AUTHENTICATED_OFFICIAL_DOWNLOAD` sources for X") has nothing to
query — it would have to parse free text, which is exactly the kind of
silent, brittle coupling this platform's typed-status discipline exists
to avoid elsewhere.

**Workaround used (bounded, this mission only):** continued recording
the distinction in free-text publisher strings, as already established;
did not add a new field to the shared domain schema.

**Do not implement without a real HQ/platform-owner design decision** on
the exact field shape — `shared-generic-acquisition-contract.json`
proposes one candidate shape (`acquisitionMode`, `accessClassification`
against a 7-value taxonomy, `schemaFingerprint`,
`selectorOrAdapterVersion`, `transformationVersion`, etc.), built from
real acquisition experience this mission had, but adding fields to
`ResearchNode`/`BoundedResearchResult` is a schema change affecting every
existing consumer — Main TSF HQ's decision, not this branch's.
