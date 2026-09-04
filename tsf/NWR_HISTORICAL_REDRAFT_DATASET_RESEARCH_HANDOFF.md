# NWR Historical Redraft Data — Dataset Research Execution Handoff

Bounded handoff so the new NWR Historical Redraft Data execution lane can
reuse the generic Dataset Research platform without rediscovering it. The
Dataset Research lane remains generic and does **not** start or continue
a parallel NWR historical NFL acquisition project.

## 1. Current Dataset Research candidate

- **Worktree**: `C:\Users\codex-agent\orca\workspaces\TSF_ORCA\dataset-research-engine-v0`
- **Branch**: `tsf/feature/dataset-research-engine-v0`
- **HEAD**: `c6b058fc98afa36b537efd05ccd5fb02d373c36f`
  ("non-NFL genericity proof -- real GitHub API acquisition, zero engine code changes")
- **Status**: clean (no uncommitted changes at handoff time)
- Not merged, not deployed, no live TSF restart, no NWR write — isolated
  candidate branch only.

## 2. Reusable generic capabilities already available

All of the following are implemented, tested, and were exercised against
a real, non-trivial dataset (real NFL 2001 season pilot) in this branch.
None of it is NFL-specific — a separate genericity proof (§4) proved the
engine runs against a completely different real domain with zero engine
code changes.

| Capability | Where |
|---|---|
| ResearchMission (create/transition/pause/resume/complete/block, checkpoints, Needs You) | `domain/research-mission.mjs` |
| ResearchSpecification / ExpectedUniverse shape | consumed by `createResearchMission`/`createResearchMissionDurable` — see §3 for the exact required fields |
| Bounded request/result contract, dispatch/result recording | `domain/research-node.mjs` |
| Source discovery/admission (claim admission from a `BoundedResearchResult`) | `domain/research-admission.mjs` |
| Provider adapters (real, behind one Worker seam: `{dispatch, fetchResult}`) | `adapters/parallel-research-worker.mjs`, `adapters/exa-research-worker.mjs`, `adapters/parallel-http-transport.mjs`, `adapters/exa-http-transport.mjs`, `adapters/http-source-adapter.mjs`, `adapters/deterministic-fake-research-worker.mjs` (for tests/deterministic bulk acquisition) |
| Temporal semantics (temporalScope, requiredTemporalScopes, HISTORICAL_STATIC vs LIVE_SNAPSHOT freshness policy, temporal-aware completeness) | `domain/research-node.mjs`, `domain/research-completeness.mjs`, `sourcePolicy.freshnessPolicy` / `temporalRequirements` on the specification |
| Provenance (timeline, provenance package, CSV export) | `domain/research-provenance.mjs` |
| Identity (identity resolution state recording, ambiguous joins) | `domain/research-admission.mjs` (`recordIdentityResolutionState`) |
| Typed missingness | `domain/research-reconciliation.mjs` (`ACCEPT_TYPED_MISSING` decision type) |
| Verification (claim verification, conflict detection) | `domain/research-verification.mjs` |
| Source independence (quality classes, independence states, upstream-chain resolution, conflict independence guidance) | `domain/research-source-independence.mjs` |
| Reconciliation (all decision types incl. derived fields, library reuse) | `domain/research-reconciliation.mjs`, `domain/research-library.mjs` |
| Research Library (cross-mission source/fact reuse, CACHE_HIT/MISS/REJECTED_* outcomes) | `domain/research-library.mjs`, `server/research-library-store.mjs` |
| Artifact generation (status/completeness/review-items/provenance package/provider usage, full CSV+JSON output package) | `server/research-mission-driver.mjs` read surfaces; see the real pilot's 12-item output package for a worked example (§4) |
| Crash/resume (durable, boundary-committed, ambiguity-classified on resume) | `domain/research-dispatch-bookkeeping.mjs`, `server/research-mission-driver.mjs`, proven under real simulated crashes in `test/research-mission-driver.test.mjs` |
| Cost/provider governance (fail-closed metered spend gate) | `domain/research-cost-governance.mjs` |
| Schema versioning (forward-compatible guards on every persisted shape) | `domain/research-schema-versioning.mjs` |
| Integrity checking (read-time CanonicalFact lineage validation) | `domain/research-integrity.mjs` |
| Completeness metrics (no opaque single quality score) | `domain/research-completeness.mjs` |

## 3. Exact repo-native entrypoints the Historical Redraft lane should use

**Do not call domain functions directly for real, persisted work** — use
the durable driver (`server/research-mission-driver.mjs`), which wraps
every domain call in crash-safe, separately-committed storage writes:

```js
import {
  createResearchMissionDurable,   // (missionId, {projectId, specification, expectedUniverse, nodes}, clock)
  dispatchResearchNodeDurable,    // (missionId, nodeId, providerId, worker, clock, {costGovernance})
  pollAndAdmitResearchNodeDurable,// (missionId, nodeId, worker, clock)
  verifyAndReconcileResearchNodeFieldDurable, // (missionId, nodeId, fieldName, decidedBy, clock)
  adoptResearchLibraryReuseDurable, // (missionId, nodeId, fieldName, library, {requiredTemporalScope, valueType, decidedBy, rationale}, clock)
  cancelResearchNodeDurable,
  readResearchMissionStatus,
  readResearchMissionReviewItems,
  readResearchMissionArtifacts,
  readResearchMissionCompleteness,
  readResearchMissionProviderUsage
} from './server/research-mission-driver.mjs'
import { readResearchMission, withResearchMission } from './server/research-mission-store.mjs'
import { readResearchLibrary, withResearchLibrary } from './server/research-library-store.mjs'
import { createResearchLibrary } from './domain/research-library.mjs'
import { buildBoundedResearchRequest } from './domain/research-node.mjs' // only needed to compute a taskFingerprint for a synthetic/deterministic worker result, exactly as the real pilot does
```

**Required `ResearchSpecification` shape** (`schemaVersion:
'TSF_RESEARCH_SPECIFICATION_V1'` is mandatory):
`{ schemaVersion, id, researchQuestion, entityType, requestedFields:
[{fieldName, valueType, required, derivationRule}], sourcePolicy:
{preferredSources, disallowedSources, licensingConstraints,
freshnessPolicy, requireIndependentSources, minSourceCount,
allowCrossMissionLibraryReuse}, temporalRequirements: {asOfDate,
periodScope}, budget: {maxCostUsd, maxLatencyMs, maxToolCallsPerNode},
toolPermissions, expectedUniverse }`.

**Required `ExpectedUniverse` shape**
(`schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1'` mandatory):
`{ schemaVersion, entityType, expectedCount, expectedEntities:
[{entityId, identityHints}], source }` — `source` should cite a real,
independent oracle, never "all rows our acquisition source returns."

**Isolated state file pattern (mandatory for any one-off script, not
just tests)**: set `process.env.TSF_UI_STATE_FILE` to an **absolute**
path inside an `async function main()`, THEN `await import(...)`
(dynamically) every module that transitively imports
`server/data-store.mjs`. A static top-of-file `import` runs before a
textually-earlier `process.env` assignment because ES module imports are
hoisted — this bit two real pilot runs in this session (see
`run-nfl-2001-real-pilot.mjs`'s own comment on the incident). Every real
runner script in this repo (`run-nfl-2001-real-pilot.mjs`,
`run-nfl-2001-second-mission-library-proof.mjs`,
`run-github-repos-genericity-proof.mjs`) is a working, copy-from example
of the full real pattern end to end (spec/expectedUniverse construction,
bulk deterministic acquisition via a synthetic worker, real paid-provider
gap dispatch under a cost gate, verify/reconcile, library indexing,
artifact writeout).

**Real Parallel API constraint** (undocumented before this session,
confirmed live): `requestedOutputSchema` on a node **must** include a
real `properties` key (`{type:'object', properties:{...}}`) — a bare
`{type:'object'}` is rejected with HTTP 422.

## 4. Existing NFL/fantasy-related generic adapters and prior probes (reusable as-is)

- `fixtures/nfl-2001-real-pilot-data.mjs` / `run-nfl-2001-real-pilot.mjs`
  — a full, real, worked reference implementation: 33-entity real
  NFL-season mission, bulk Wikipedia deterministic acquisition, 2 real
  Parallel gap dispatches, verify/reconcile/canonicalize, library
  indexing, 12-item output package. **Copy the pattern, not the NFL
  field names** — this stays a fixture for the generic engine's own
  regression proof, it is not meant to become shared NFL infrastructure.
- `run-nfl-2001-second-mission-library-proof.mjs` — real cross-mission
  Research Library reuse, worked example.
- `run-github-repos-genericity-proof.mjs` /
  `fixtures/github-repos-genericity-fixture.mjs` — proves (not just
  claims) the engine needs zero domain-specific code changes; use as the
  template for how little a new domain (including NWR's redraft data)
  should need to add.
- **`docs/tsf/TSF_HISTORICAL_ADP_SOURCE_FEASIBILITY_V0.md`** (local file,
  this worktree, not committed — see §6, copy it into your own lane if
  you need it durably) — a real, already-completed source-discovery pass
  for **historical fantasy ADP** specifically (2007/2012/2017/2022
  representative years), the closest existing prior art to "historical
  redraft data." Read this before doing your own source discovery — see
  §6.
- Provider adapters (`adapters/parallel-research-worker.mjs`,
  `adapters/exa-research-worker.mjs`) are generic and NFL-agnostic;
  reusable without modification for any redraft-data provider dispatch.

No other NFL/fantasy-specific code exists in the generic
`domain/`/`server/` tree (verified by search — the handful of
unrelated hits for the string "NWR" elsewhere in this repo are a
different, unrelated acronym collision in generic TSF orchestration
files, not fantasy-football or redraft related).

## 5. Current generic limitations relevant to Historical Redraft Data

- **Historical snapshots**: `freshnessPolicy` supports `HISTORICAL_STATIC`
  vs a live/current default, but there is no first-class "point-in-time
  as-of" verification primitive beyond `temporalRequirements.asOfDate` +
  per-field `temporalScope`/`requiredTemporalScopes` string tags — the
  engine trusts what you assert as the temporal scope; it does not
  independently *prove* a value was true as of that date.
- **As-of proof**: no cryptographic or archival (e.g. Wayback Machine)
  as-of proof mechanism exists yet. `sourceSnapshotsOrSnapshotRefs` on a
  `BoundedResearchResult` is the only structural hook for "here is a
  frozen copy of what we saw" — currently populated ad hoc (the real NFL
  pilot left it empty for its deterministic Wikipedia acquisitions,
  relying on `retrievedAt` + `sourceRef` URL instead). A real redraft-ADP
  mission needing defensible as-of claims (e.g. "this WAS the actual
  average draft position as of August 2012, not a later-revised figure")
  would need to decide how rigorously to populate this field — the
  engine doesn't yet enforce or generate real snapshot proofs itself.
- **Bulk acquisition**: the deterministic-acquisition pattern (a real,
  honestly-labeled synthetic provider like
  `DETERMINISTIC_WIKIPEDIA_EXTRACTION` / `DETERMINISTIC_GITHUB_API_EXTRACTION`
  wrapping already-fetched real data through the real durable
  dispatch/poll/admit path) works and is proven at ~30-entity scale
  twice now. It has not been proven at the scale a full multi-year,
  multi-position historical redraft dataset would likely require
  (hundreds to low thousands of entities) — the disclosed O(n²)
  mission-clone cost was evaluated only at the real pilot's ~200-mutation
  scale and a synthetic 1,000-node gauntlet; a real redraft mission of
  that size has not been attempted and should be watched for performance
  during a real run, not assumed safe.
- **Source rights**: `sourcePolicy.licensingConstraints` is a free-text
  list, not enforced structurally — the engine does not itself block a
  disallowed-source fetch; that discipline is entirely the calling
  script's responsibility (as it was in the real NFL pilot, which
  hand-coded a `disallowedSources: ['pro-football-reference.com']` entry
  and separately never called that host). A redraft-data mission must
  independently verify each source's ToS/robots.txt itself — see the ADP
  feasibility doc (§6) for a concrete, real example of this diligence
  (including a real robots.txt-vs-UI-copy tension found on Fantasy
  Football Calculator, unresolved).
- **Cross-provider identity**: `recordIdentityResolutionState` exists and
  IDENTITY_REVIEW is a real, supported outcome, but the real pilot never
  exercised a genuinely ambiguous cross-provider identity case (0
  real-world ambiguous joins occurred) — the mechanism is implemented and
  unit-tested with synthetic fixtures, but not yet proven against a real,
  messy, multi-source identity-matching problem (e.g. reconciling player
  identities across ESPN/Yahoo/Sleeper/NFFC redraft platforms, which
  would likely be a real, non-trivial part of a redraft-data mission).
- **Temporal verification**: verification (`verifyResearchClaim`,
  conflict detection) is temporal-scope-aware (a claim's `temporalScope`
  is part of what's compared/reconciled) but has no special handling for
  "this source revised its own historical data after the fact" (a
  plausible real risk for redraft/ADP archives, given the FFC 2007-page
  discrepancy found in §6) beyond ordinary conflict detection if two
  differently-timed fetches of the same nominal period disagree.

## 6. NWR-specific investigation already done — do not duplicate

**A real, completed Historical Fantasy ADP source-feasibility pass
already exists** in this worktree (HQ §21 of the prior Dataset Research
mission, source-discovery only, $0 real spend):

- File: `docs/tsf/TSF_HISTORICAL_ADP_SOURCE_FEASIBILITY_V0.md` (local to
  this worktree; `docs/**` is gitignored in this repo, so it will **not**
  travel with a `git fetch`/checkout of this branch elsewhere — if the
  Historical Redraft lane runs in a different worktree, ask for this file
  directly or have it copied over, rather than re-discovering the same
  sources from scratch).
- **What it found**: Fantasy Football Calculator
  (fantasyfootballcalculator.com) is a real, in-season,
  `CONTEMPORANEOUS_SNAPSHOT`-classifiable ADP archive for 2012/2017/2022
  (narrow 1-2 day pre-season mock-draft windows, directly WebFetch-
  confirmed); 2007 is `UNKNOWN_TEMPORAL_STATUS` due to a genuine,
  naturally-occurring discrepancy between FFC's own live page and an
  independent mirror of the same nominal dataset (FF Today), reported
  honestly rather than resolved by guessing.
- **Real, disclosed gap**: no independent second data lineage was found
  for any sampled year — FF Today and fantasyhistorydata.com are mirrors/
  aggregators of the same FFC dataset, not independent confirmation.
  FantasyPros is a real, separate organization plausibly holding its own
  historical ADP data since ~2012, but no browsable historical archive
  was found on their live site (would need Wayback Machine or direct
  contact — out of scope for source-discovery).
  A real, disclosed robots.txt-vs-UI-copy tension on FFC (bulk `/api/`
  and `/adp/csv/` paths are robots.txt-disallowed even though the page's
  own copy advertises a free API) is unresolved and should be settled
  deliberately before any bulk programmatic pull, not inferred from UI
  text.
- **Feasibility verdict**: FEASIBLE, WITH A DISCLOSED INDEPENDENCE GAP.

**Point the Historical Redraft lane at this file first.** If it needs
this preserved more durably (e.g. because it runs in a separate worktree
that won't see this branch's local files), request it be copied
verbatim rather than re-running the same WebSearch/WebFetch discovery.

## Platform requirement process

If the Historical Redraft lane sends a `DATASET_RESEARCH_PLATFORM_REQUIREMENT`,
it will be treated as a request for a **generic** capability and
implemented only if it genuinely belongs in the reusable Dataset Research
platform (i.e., it would benefit any future domain, not just NWR redraft
data) — never as NWR-specific code inside `domain/`/`server/`.

## Boundaries preserved

This handoff makes no change to NWR Draft Upgrade, any NWR historical-data
worktree, or NWR model logic — none were read, modified, or touched to
produce it. The Dataset Research lane continues its own existing generic
mission after this handoff; no push/merge/deploy occurs unless already
separately authorized.
