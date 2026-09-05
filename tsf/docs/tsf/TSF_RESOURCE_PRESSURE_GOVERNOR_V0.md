# TSF Resource Pressure Governor V0

Implements `RESOURCE_PRESSURE_GOVERNOR_REQUIREMENT.md` (durable requirement
record, `tsf-unified-platform-v1` @ `fec9bf3275`) — the host-tier
classification, admission recommendation, and heavy-task lease pieces that
document already certified as buildable with no Orca-core bridge. Built in
its own isolated worktree (`tsf-resource-pressure-governor-v0`), branched
from that exact commit per the mission's own base-reconciliation
instruction, so this extends the frozen Main Unified Platform line rather
than bare `tsf/main`.

## 0. Phase A: emergency RAM recovery (preceded this implementation)

Read-only inventory of this host (15.11 GB total, 2.8 GB free at the
time — PRESSURED, not EMERGENCY) found **zero SAFE_RETIRE_CANDIDATEs**:
every `claude.exe` process mapped to a live session whose transcript had
been written within minutes of the check (all 7 peers, via `ListAgents` +
local transcript-file timestamps), `Orca.exe`/`orca-terminal-daemon.exe`
are shared infrastructure serving every terminal and the one live TSF
server (port 4610) across all of them, and no duplicate/stale pilot server
existed (the only listening TSF-related port was that one, live, in-use
server). Two sessions `ListAgents` reported `Remote Control · offline`
turned out to have live, actively-writing local processes — **"Remote
Control offline" is not a liveness signal and must never be treated as
one**; recorded as a required negative-fixture consideration for any
future richer governor. Separately: this session holds no tool capable of
gracefully retiring another live interactive session even had one
qualified (`TaskStop` only reaches tasks/agents the caller itself
spawned); the only available fallback would be `Stop-Process`, i.e. force
termination, out of scope without separate authorization. Proceeding to
Phase B/C was an explicit owner decision (asked and confirmed), not an
assumption.

## 1. Scope (V0 boundary, unchanged from the requirement doc)

Buildable today, no Orca-core change: host memory tiers, admission
recommendation, heavy-task lease mutual exclusion. **Not** buildable
without an Orca-core bridge (`ORCA_CORE_GAP`, the same one already
disclosed in the Resource Auditor V0 review, not a new one): naming a
specific process/session as reclaimable (needs `collector.ts`'s
`enumerateProcesses()`, which lives in Orca's Electron main process — this
server is a separate plain Node child process with no IPC access to it).
Automatic process retirement/termination is out of scope entirely, V1 at
the earliest, separately authorized.

## 2. Files

- `tsf/domain/resource-pressure-governor.mjs` — pure logic:
  `classifyResourcePressureTier`, `buildAdmissionPolicy`,
  `buildResourcePressureState`, `requestHeavyTaskLease`,
  `releaseHeavyTaskLease`.
- `tsf/server/resource-pressure-collector.mjs` — the real evidence:
  `os.freemem()`/`os.totalmem()`, the exact primitive Orca's own
  `collectHostMemory()` already falls back to on Windows.
- `tsf/server/resource-pressure-governor-http-routes.mjs` — HTTP glue.
- `tsf/server/data-store.mjs` — added `resourcePressureLeases: {}` to
  `DEFAULTS` (the durable lease-store record).
- `tsf/server/http-server.mjs` — one new route registration. Pre-existing,
  unrelated finding: this file was **already 19 lines over the 600-line
  `max-lines` cap on this base commit** before any change here (confirmed
  via `oxlint` immediately after branching, before editing). Per the
  project's absolute rule against ever disabling/bumping `max-lines`,
  fixed by mechanically merging five pre-existing, independent
  `if (await handleXRoute(...)) { return }` dispatch blocks pairwise with
  `||` short-circuiting (identical evaluation order to sequential ifs) and
  hoisting each block's context/helper objects into a named local instead
  of an inline literal — both changes are behavior-preserving, verified by
  running every affected route's own test suite (68/68 passing) plus the
  full suite. `oxlint` on this file is clean after the edit (827 raw
  lines; 600 is a comment/blank-skipped count).

## 3. The `TSF_RESOURCE_PRESSURE_STATE_V0` contract

Matches the requirement doc's schema exactly:

```
{
  schemaVersion: 'TSF_RESOURCE_PRESSURE_STATE_V0',
  observedAt, evidenceSource: 'TSF_OS_MODULE',
  hostMemory: { totalBytes, freeBytes, availableBytes, usedPercent },
  tier: 'HEALTHY'|'PRESSURED'|'CRITICAL'|'EMERGENCY',
  admission: { newFullSuiteTests, newBrowserPilots, newResearchWorkers, reason },
  protectedProcesses: [...],       // caller-supplied, sanitized, honest
  reclaimCandidates: [],           // ALWAYS empty -- see below
  missionsWaitingForResources: [...],
  leases: [...]                    // live (unexpired) heavy-task leases
}
```

Thresholds (bytes, configurable via `classifyResourcePressureTier`'s
second argument, defaulting to the requirement doc's own values):
HEALTHY ≥ 4.0 GB, PRESSURED 2.5–4.0 GB, CRITICAL 1.5–2.5 GB, EMERGENCY
< 1.5 GB. Unmeasurable/invalid input (non-number, `NaN`, negative) fails
closed to `EMERGENCY`, never `HEALTHY` — the same fail-closed discipline
`resource-auditor.mjs` established for `DISPOSABLE_CANDIDATE`, applied to
this evidence dimension. Verified against the requirement doc's own
worked example: ~1.69 GB free classifies `CRITICAL`.

### Trust boundary, built in from the start (not a later hardening pass)

Two fields are structurally protected, mirroring Orca Resource Auditor
V0's production trust boundary rather than waiting to be told about it in
review:

- **`evidenceSource` is hard-coded to `'TSF_OS_MODULE'`** inside
  `buildResourcePressureState` — it is not a parameter, so no caller
  shape (HTTP body or otherwise) can make it read `'ORCA_NATIVE_COLLECTOR'`.
  That value can only become honest once the real bridge in §1 exists.
- **`reclaimCandidates` is not a parameter at all** — always `[]`. A test
  proves a request body containing a fabricated
  `reclaimCandidates: [{ kind: 'COMPLETED_PLANNER_SESSION', ... }]` has
  zero effect end to end, over the real HTTP route
  (`http-resource-pressure-governor.test.mjs`).

`protectedProcesses`/`missionsWaitingForResources` ARE caller-supplied
(TSF has no independent mission-state enumeration yet — the same
`ORCA_CORE_GAP`) but are shape-sanitized: malformed entries are silently
dropped rather than thrown on or passed through unchecked.

## 4. Heavy-task lease (Phase C "HEAVY TASK SCHEDULING")

Per-`kind` mutual exclusion (one live holder at a time; default TTL 2h,
self-healing if a holder crashes/forgets to release) so several HQs can't
independently launch full suites/pilots simultaneously — directly
motivated by, and reproduced during, this exact session's own full-suite
run (§6). Two independent gates: the **tier** gate (CRITICAL/EMERGENCY
refuse a new lease outright regardless of slot availability; PRESSURED and
HEALTHY both allow a grant when the slot is free — PRESSURED's "delay/
serialize" language is exactly what per-kind mutual exclusion already
provides, not a second, stricter rule invented beyond what the requirement
doc's table supports), and the **lease** gate (serializes same-kind
requests once a slot is held). A mission can only release its own lease.
Routes: `POST /api/resource-pressure/heavy-task-lease/{acquire,release}`.

## 5. HTTP routes

| Route | Method | Behavior |
|---|---|---|
| `/api/resource-pressure/state` | GET | Live tier/admission/leases; `protectedProcesses`/`missionsWaitingForResources` honestly `[]` (no caller context yet) |
| `/api/resource-pressure/state` | POST | Same, plus caller-supplied `protectedProcesses`/`missionsWaitingForResources` (sanitized); `reclaimCandidates` still structurally `[]` |
| `/api/resource-pressure/heavy-task-lease/acquire` | POST | `{ kind, missionId, ttlMs? }` → grant/refuse per §4 |
| `/api/resource-pressure/heavy-task-lease/release` | POST | `{ kind, missionId }` → release if the caller is the holder |

None of these routes touch the filesystem beyond the existing gitignored
operator-state JSON file, spawn a process, or terminate anything.

## 6. Tests and verification

- `test/resource-pressure-governor.test.mjs` — 26 tests: tier boundaries
  (exact-threshold rounding, the requirement doc's own ~1.69 GB worked
  example, zero, and 7 invalid-input fail-closed cases), admission policy
  per tier, the contract's honesty constraints (evidenceSource hard-coded,
  reclaimCandidates un-injectable, sanitization of malformed
  protected/waiting entries, non-array inputs), and full heavy-task lease
  behavior (grant/refuse per tier, serialization, idempotent refresh,
  expiry, ownership-checked release).
- `test/resource-pressure-collector.test.mjs` — 3 tests: real host values
  are finite/non-negative, an injected fake `os` module is used verbatim,
  a degenerate zero-total reading reports `usedPercent: null` rather than
  a divide-by-zero artifact.
- `test/http-resource-pressure-governor.test.mjs` — 8 real end-to-end
  HTTP tests via `createRequestHandler()` (same harness pattern as
  `http-capacity.test.mjs`), using a test-only env-var host-memory
  override (`TSF_RESOURCE_PRESSURE_TEST_{TOTAL,FREE}_BYTES` — mirrors this
  codebase's existing `STUB_ORCA_*` test-double convention, has no HTTP-
  reachable trigger): honest GET state, CRITICAL-tier admission end to
  end, POST-supplied context merged while `reclaimCandidates` injection is
  proven inert, a full acquire/serialize/deny-cross-release/release/re-
  grant lease round trip, CRITICAL-tier lease refusal, clean 422s on
  malformed bodies (including a literal `null` body), and a clean 404 for
  an unknown sub-route.
- **Regression proof for the `http-server.mjs` route-merge**: the five
  routes whose dispatch blocks were merged (`onboarding`, `keep-going`,
  `fleet-optimizer`, `capacity`, `portfolio-membership`,
  `prepare-for-work`) all still pass their own real HTTP test suites —
  68/68 across `http-onboarding`, `http-keep-going`, `http-fleet-
  optimizer`, `http-capacity`, `http-portfolio-membership`, `http-prepare-
  for-work`, `http-eval`, `http-flight-recorder`.
- **Full suite**: `node --test test/*.test.mjs` — 1574 tests, 1571 pass, 1
  skipped, **2 failed**. Feature suites (everything above, and every test
  this change touches) are green; full suite has two independently
  reproduced shared-machine contention failures, not a defect in this
  change. Isolated re-runs of both, on the same code, alone:
  `health-repair-io.test.mjs`'s bounded-timeout-kill test (20/20 pass,
  2.4s, vs. a 61s timeout-bound miss under full-suite load) and
  `keep-going-autonomy-proof.test.mjs` (1/1 pass, 3.8s, vs. a 144s stall
  under full-suite load) — neither file is touched by this change. This
  is itself a live instance of exactly the problem this feature exists to
  address (`ListAgents` showed 5 other active peer sessions mid-run); it
  does not retroactively justify skipping the isolation check, which was
  still run and did pass. The one skip is
  `plugin-real-load-proof.test.mjs`'s own documented, pre-existing
  environment guard (`t.skip` when `127.0.0.1:4610` is already bound) —
  confirmed real and expected: Phase A's own process inventory (§0) found
  the live Orca desktop app's TSF server bound to exactly that port at
  the time.
- `oxlint` and `oxfmt` are clean on every new/edited file, including
  `http-server.mjs` (see §2). `git diff --check`: clean (only benign
  CRLF/LF autocrlf notices, no real whitespace errors).

## 7. Independent verification

Self-review pass (adversarial, mirroring the discipline the Resource
Auditor V0 review used) before commit: attempted to inject
`reclaimCandidates` and a false `evidenceSource` through every route that
takes a body — both proven structurally inert by test, not just by
inspection. Attempted a TOCTOU-style double-acquire race conceptually
(not exercised as a live concurrency test in V0 — the lease store is a
single in-process JSON file guarded by the same `saveState` write path
every other TSF feature already uses; a real concurrent-request race here
would be a pre-existing `data-store.mjs` property, not new to this
feature, and is out of this V0's scope to fix). Confirmed a lease can
never be granted under CRITICAL/EMERGENCY even with an empty lease store
(tier gate ordering checked first, before any lease lookup).

## 8. Remaining gaps

- **`ORCA_CORE_GAP` (pre-existing, not new)**: per-process/session
  attribution for `reclaimCandidates` and real `protectedProcesses`/
  `missionsWaitingForResources` population needs Orca's
  `enumerateProcesses()` bridge, already called for in the Resource
  Auditor V0 review. This governor's contract is shaped to receive that
  data the moment the bridge exists, without a schema change.
  Committed to Main TSF review is required before this can honestly
  produce anything richer.
  Nothing in this V0 asserts otherwise.
  Nothing in this V0 fabricates that data meanwhile.
- **`GENERIC_GAP`**: no real caller (Command/HQ layer) is wired to POST
  `protectedProcesses`/`missionsWaitingForResources` yet, and no real
  caller acquires/releases heavy-task leases around an actual full-suite
  or browser-pilot dispatch yet — this V0 is the primitive, not the
  integration. Session/worker/pilot lifecycle (`ACTIVE → IDLE → RETIRED`,
  the ownership registry, `session-affinity.mjs` integration) remains
  design-only per the requirement doc §4, not built here — a larger,
  separate effort.
- None of the above authorizes any destructive behavior; this V0 has none
  to gate in the first place (no route deletes, terminates, or mutates
  anything outside its own gitignored lease-state file).

## 9. Status

`TSF_RESOURCE_PRESSURE_GOVERNOR_V0_READY_FOR_MAIN_REVIEW`
