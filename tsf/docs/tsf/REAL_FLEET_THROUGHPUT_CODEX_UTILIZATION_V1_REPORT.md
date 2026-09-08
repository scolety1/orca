# TSF_REAL_FLEET_THROUGHPUT_CODEX_UTILIZATION_V1_COMPLETE

No new runs created (confirmed both durable run IDs unchanged throughout:
`keep-going-worldforge-sablewake-live-runtime-repair-v3-1788848932351`,
`keep-going-easylifehq-github-io-1788849147560`). Both existing runs were
re-ticked for real, multiple times, across a real, monitored ~20-minute
window. Host memory stayed in CRITICAL the whole window (spiked into
EMERGENCY twice), oscillating roughly 1.3GB–2.2GB free and never once
reaching the 2.5GB PRESSURED floor a new heavyweight dispatch needs. No
wave dispatch was ever admitted. Nothing was forced past a real governor
refusal, and the audit's central question was answered decisively anyway,
using real live provider-capacity evidence rather than requiring an actual
dispatch to complete.

## 1. Initial/final resource state

| | freeBytes | tier | admitted |
|---|---|---|---|
| Initial (session start) | 1,442,074,624 (~1.34GB) | EMERGENCY | false |
| ... 6 more real samples over ~20 min ... | 1.40–2.19GB, oscillating | CRITICAL/EMERGENCY | false (7/7) |
| Final | 1,986,301,952 (~1.85GB) | CRITICAL | false |

`ListAgents` confirmed the real cause, unchanged across the whole window:
`nwr-draft-upgrade-hq-ee` stayed `busy` the entire session (real, external,
correctly-untouched NWR work — exactly the condition this mission's own
NWR-safety section anticipates and requires leaving alone). Real process
inventory (`Get-Process`): 5 live `claude` processes (~2.1GB combined RSS)
— all 5 accounted for as this session plus the 4 real interactive NWR-
related peer sessions; zero orphaned/stray TSF-owned processes found. Zero
`codex`-named processes running (0 active Codex workers — consistent with
0% weekly Codex usage, §4). One stray, unused, clean (no uncommitted work)
EasyLife worktree/terminal was found — a byproduct of the prior session's
live Command-dogfood test, which provisions a worktree before its own
resource check — and retired via `orca worktree rm --force` per the
lifecycle-safe-to-retire rule.

## 2. Nytheria run progress/result

Run `keep-going-worldforge-sablewake-live-runtime-repair-v3-1788848932351`
remains `ACTIVE`, 0 waves. Re-ticked with its intended real wave-1 work
item (interior-movement infrastructure-blocked-verification →
committed-test-hook approach, scoped to `product/topdown-world/app.js` +
`topdown-authority.js`, placed in its already-provisioned worktree on the
now-fixed canonical base `work/worldforge-living-world-vertical-slice-v1-
20260907` @ `9b90989`). Every re-tick this session returned
`DISPATCH_WAITING_FOR_RESOURCES` honestly, durably checkpointed each time
(hash-chained). No progress beyond queuing — genuinely resource-blocked,
not stalled (an ACTIVE run with 0 waves is a distinct, correct state from
STALLED).

## 3. EasyLife run progress/result

Run `keep-going-easylifehq-github-io-1788849147560` remains `ACTIVE`, 0
waves. Re-ticked with its intended real wave-1 discovery/dogfood work item
(placed in its already-provisioned worktree on `main` @ `e48b7a57`). Every
re-tick returned `DISPATCH_WAITING_FOR_RESOURCES` honestly, durably
checkpointed. No progress beyond queuing.

## 4. Codex utilization

**0% weekly usage, status "ok"** (real, live `fetchCapacitySnapshot()` —
`{codex: {weeklyUsedPercent: 0, status: 'ok'}}`) — Codex is not rate-
limited, not near any safety reserve, fully available capacity-wise.
`decideCapacityAction(snapshot, 'codex')` would return `PROCEED` right now
(0% is below every threshold). Real historical dispatch dispatch count
this session: 0 (no wave ever admitted). Real historical evidence from
durable state shows Codex-default dispatch HAS worked before in this fleet
(multiple real `COMPLETED` wave outcomes across `niners-war-room`,
`landing-page`, and `tsf-orca`'s own runs) — the mechanism is proven, not
broken; it simply got zero opportunities to run this session.

## 5. Claude utilization

3% session / ~57% weekly (real, live snapshot, status "ok"). This usage is
real but comes from a DIFFERENT pathway than Keep Going project dispatch:
this session's own interactive work plus this mission-family's own
Agent-tool subagent dispatches for TSF-platform build work (Wave 1's
adoption engine, Part H's stalled-run recovery, etc.) — confirmed
established precedent that this class of dispatch is materially
lighter-weight than a real external Keep-Going worker spawn and proceeds
regardless of host pressure. It is not competing with Codex for the same
project-work queue.

## 6. Codex-underutilization verdict

**Confirmed real, but NOT a routing bug.** `tsf/server/keep-going-
dispatch-loop.mjs`'s own `DEFAULT_WORKER_AGENT = 'codex'` — every fresh
Keep Going work item already defaults to Codex unless a work item
explicitly overrides it; `DEFAULT_CAPACITY.provider` is also `'codex'`.
Both real candidate work items this session (Nytheria, EasyLife) would
have dispatched to Codex by default had the host admitted them. The
system's own architecture already routes bounded implementation work to
Codex, matching the mission's own G1 principle, with zero correction
needed there. **The real limiting factor is host RAM, not provider
routing or Codex's own capacity/rate-limit state** — Codex sat at 0%
weekly usage with a fully "ok" status the entire session while the one
real, shared, physical gate (Resource Pressure Governor, driven by real
concurrent NWR memory pressure) refused every admission attempt (7/7).
Answering the mission's own question directly: **RAM/work-admission — not
provider routing — is the limiting factor tonight.**

## 7. Provider-routing changes, if any

None made, and none needed. `DEFAULT_WORKER_AGENT`/`DEFAULT_CAPACITY.
provider` are already Codex-first. No routing/scheduling correction is
justified by tonight's real evidence — the gate that blocked all real
progress is the RAM-based Resource Pressure Governor, which is functioning
exactly as designed (refusing, not silently degrading or losing the
request) and is explicitly not something this mission may weaken.

## 8. Measured safe concurrency envelope

Real natural-workload observation tonight: **0 new heavyweight workers**
were ever safely admittable — the host's real, natural condition this
entire session stayed at CRITICAL/EMERGENCY (never reached the 2.5GB
PRESSURED floor a first new dispatch requires), driven by genuinely
concurrent, correctly-untouched NWR work plus a third real, independently-
active `tsf-orca` self-improvement Keep Going run (found `ACTIVE`,
`RUN_RESUMED` moments before this check — real, legitimate fleet demand
this mission does not own or control). Deliberately did NOT force multiple
concurrent heavyweight workers onto an already CRITICAL/EMERGENCY host to
build a fuller 1-/2-/3-worker curve — doing so would risk directly
degrading the user's other real, in-progress NWR session, which the
mission's own instruction explicitly forbids ("do not deliberately drive
the machine into EMERGENCY"). Historical evidence (multiple real
`COMPLETED` waves across 3 other fleet projects, `tsf-orca`, `niners-war-
room`, `landing-page`) confirms at least 1 heavyweight worker has run
successfully under less-loaded historical conditions, but no memory-at-
dispatch-time telemetry survives from those to reconstruct their envelope
precisely. Honest conclusion: this session could not safely establish the
2-/3-worker part of the curve; only "0 admitted under sustained real
CRITICAL/EMERGENCY load" is real, measured data from tonight.

## 9. Resource-wait times

Both runs have been in `DISPATCH_WAITING_FOR_RESOURCES` continuously since
their first tick last session (~06:30 UTC / 06:32 UTC 2026-09-08) through
every re-tick this session (final check ~20 minutes into this mission) —
i.e., a real, ongoing, multi-tens-of-minutes resource wait for both, still
unresolved as of this report. No durable run silently dropped this state;
every tick re-recorded it, hash-chained.

## 10. Queue/starvation results

NWR: held, untouched, confirmed via `ListAgents` (read-only) throughout —
no modification, no worker wake, no test run, no hold release. Nytheria
and EasyLife: both real, both queued, both received identical treatment on
every re-tick — neither's resource-gate answer was biased toward the
other; no starvation between them was observed (both equally blocked, both
equally ready). Queued-work promotion: correctly wired (the exact same
gate is checked fresh on every tick; the moment memory clears, the next
tick — on either run — would be admitted; nothing needs to be re-decided).
Durable/visible refusal: confirmed — each refusal is a real, hash-chained
`DISPATCH_WAITING_FOR_RESOURCES` checkpoint, not a silent drop. No mission
silently rotted: both runs stayed `ACTIVE` (not `STALLED`) throughout,
correctly distinct from the failure mode Part H's fix addresses (an ACTIVE
run awaiting its first tick is not what that recovery scan targets, nor
should it be — it isn't stuck, it's honestly waiting).

## 11. Project work completed

None this session beyond documentation/audit and one real, safe cleanup
(the stray EasyLife worktree, §1). No wave dispatched for either project;
core logging/gameplay code untouched for both, exactly as intended given
the real resource block.

## 12. Remaining READY_FOR_ADOPTION candidates

None new. WorldForge's old candidate remains honestly REFUSED (unchanged
from the prior mission, `CANDIDATE_WORKTREE_UNRESOLVED`) — not
re-attempted this session since nothing about that specific gap changed.

## 13. Final fleet state

- NWR: HELD, untouched, real external work still active.
- Nytheria/WorldForge: `ACTIVE`, 0 waves, `DISPATCH_WAITING_FOR_RESOURCES`,
  wave-1 worktree provisioned and clean, ready to dispatch to Codex the
  moment the governor admits.
- EasyLife/EasyWorkouts: `ACTIVE`, 0 waves, `DISPATCH_WAITING_FOR_RESOURCES`,
  wave-1 worktree provisioned and clean, ready the same way.
- `tsf-orca` (this platform's own self-improvement run): observed `ACTIVE`,
  real, independent, out of this mission's scope — left untouched.
- Canonical `tsf/main` unchanged by this mission (docs-only additions);
  `fcd16c7a95b648acefa61fb10c46804316e160f3` remains current at mission
  start and stays current (this report itself is committed on top).

---

NWR_EXTERNAL_WORK_HOLD_ACTIVE = YES

DUPLICATE_PROJECT_RUNS_CREATED = NO

CODEX_UNDERUTILIZATION_RESOLVED = NO — real (0% weekly Codex usage
confirmed), but correctly diagnosed as a real, shared host-RAM constraint
this session could not lift without either forcing a real governor
refusal (prohibited) or interfering with real, correctly-protected NWR
memory usage (also prohibited) — not a routing/scheduling defect, so
there was nothing safe to "resolve" tonight beyond confirming no
correction is needed once RAM frees up.

NYTHERIA_PROGRESSING = NO (queued, ready, honestly resource-blocked all
session)

EASYLIFE_PROGRESSING = NO (queued, ready, honestly resource-blocked all
session)
