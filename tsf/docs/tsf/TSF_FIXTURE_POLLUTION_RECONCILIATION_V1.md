# TSF Fixture Pollution Reconciliation V1

Real, historical reliability incident discovered 2026-09-14 while checking
`/api/update-safety` after resolving an unrelated, legitimate stale Needs
You item on `niners-war-room`. Reconciled 2026-09-15 under a bounded,
explicitly-authorized reopening of the otherwise-frozen backend product
architecture (see `TSF_UI_REDESIGN_BASELINE.md`).

## What happened

82 of 97 real, registered projects in the live owner state file
(`server/.local-state/operator-state.json`) were disposable test fixtures
from `tsf/test/command-operator-integration-adversarial.test.mjs`, written
there by mistake instead of into that test's own isolated state file. 55 of
them carried a real Keep Going run in `WORKING`/`ACTIVE` state, which is
what `/api/update-safety` was correctly reporting as `WAIT_FOR_ACTIVE_WORK`
-- the platform was telling the truth about its own state; the state itself
was wrong.

Timestamps on the polluted records span six distinct days
(2026-09-09 through 2026-09-14), so this was not a single incident -- the
same underlying bug fired repeatedly, undetected, across many separate
days/sessions, until `update-safety`'s own blocking-project-count
incidentally surfaced it tonight.

## Root cause

`tsf/server/data-store.mjs` resolved `TSF_UI_STATE_FILE` into a
module-level `const STATE_FILE` exactly ONCE, the first time the module was
imported in a process:

```js
const STATE_FILE = process.env.TSF_UI_STATE_FILE || REAL_DEFAULT_STATE_FILE
```

`command-operator-integration-adversarial.test.mjs` does set
`process.env.TSF_UI_STATE_FILE` to its own isolated, pid-scoped path before
importing `../server/http-server.mjs` -- the test's own source is correct.
But if ANYTHING in the same OS process imports `data-store.mjs` (directly or
transitively) even one tick before that assignment runs, the module-level
constant is already locked onto whatever `TSF_UI_STATE_FILE` resolved to at
that earlier moment -- permanently, for the rest of that process's life,
regardless of any later `process.env` reassignment. If that earlier import
happened with no override set at all, every subsequent
`loadState()`/`saveState()` call in that process -- including this test's
own real, scripted dispatch calls -- silently read and wrote the REAL owner
default state file instead.

This was empirically confirmed as the general failure class (isolated
`node --test` repro proving import-order-sensitive module caching defeats a
later env override in a shared process), and the classifier
(`domain/fixture-pollution-classifier.mjs`) proved, against the real
forensic backup, that every one of the 82 polluted records carries this
test's own exact fingerprints: the `mkdtempSync`-style id/repoPath naming
scheme, the `stub-plan-for::` goal marker and `stub acceptance criterion`
text from `test/fixtures/stub-planner-cli.mjs`'s own literal stub output,
and (for the 55 that got a real Keep Going run) a chat thread containing
ONLY this test file's own literal scripted dialogue lines.

The standard, committed test invocation (`npm test` in `tsf/`, i.e.
`node --test test/*.test.mjs`) was verified NOT to reproduce this on its
own -- Node's `--test` runner isolates each file into its own OS process by
default, confirmed with a live repro on this host (Node 24.15.0). No
committed script in this repository batches multiple test files into one
shared process. The most likely trigger is therefore an ad-hoc, non-
committed invocation (a manual multi-file batch run, direct-node debugging,
or similar) from an earlier session -- not reproducible from git history,
since such a script was never committed. The FIX closes the underlying
mechanism regardless of the exact historical trigger: it does not depend on
identifying which invocation caused it.

TSF-SAFE-UI-001 (added earlier this program, before this incident's root
cause was known) does not explain this: that guard only fires when
`TSF_DISPOSABLE_RUNTIME=1` is set, and this test never sets that flag at
all -- it only sets `TSF_UI_STATE_FILE`, which is exactly the code path the
old caching bug defeated.

## Fix

`data-store.mjs`'s `STATE_FILE` constant became `resolveStateFile()`, a
function that reads `process.env.TSF_UI_STATE_FILE` live on every call
(`loadState`, `saveState`, `getStateFilePath`), instead of caching it once
at import time. A late override is now always honored, regardless of
import order or process-sharing. The original TSF-SAFE-UI-001 fail-closed-
at-import-time guarantee is preserved unchanged (a second call to the same
resolution function at module load time, so a disposable runtime with a
non-propagated override still refuses to even start).

Every real caller of state I/O in this codebase goes through
`loadState`/`saveState`/`getStateFilePath` -- this is the sole point where
`TSF_UI_STATE_FILE` is read anywhere in `tsf/server` or `tsf/domain`
(verified by search) -- so this one fix closes the failure class for every
current and future test/runtime in this codebase, without needing a
per-file change.

Regression proof: `test/data-store-late-override-isolation.test.mjs`
reproduces the exact mechanism (override set after the module's first
import, in a real child process) and was confirmed, via mutation testing,
to fail against the original code and pass against the fix.

## Classification and cleanup

`domain/fixture-pollution-classifier.mjs` requires ALL of: (1) the exact
fixture id-naming scheme, (2) an onboarded-projects entry, (3) a repoPath
under an OS temp directory matching the test's own `mkdtempSync` prefix,
(4) for records with a run, the exact `stub-plan-for::` goal marker, the
exact `stub acceptance criterion` acceptance text, and the exact
`stub-task-id` checkpoint evidence marker, (5) a plausible creation
timestamp, (6) a chat thread (if any) containing only this test's own
literal scripted lines, and (7) no real-authority marker (execution hold,
canonical base, Active Fleet/Work Set membership). Any record failing even
one signal is `AMBIGUOUS_REQUIRES_OWNER` and is never touched. Real-project
negative controls (`niners-war-room`, the real WorldForge project,
`tsf-orca`, plus an adversarial synthetic case carrying fixture-shaped
CONTENT under a real id) are committed regression tests proving the
classifier can never confirm a real project.

Against the real incident: 82/82 candidates confirmed, 0 ambiguous.

`scripts/reconcile-fixture-pollution.mjs` is a narrow, one-time,
dry-run-by-default script (`--apply` required to mutate) that: re-verifies
the plan against a fresh state read inside the same cross-process file lock
`keep-going-run-store.mjs` uses (refusing to apply a stale plan if state
drifted), writes a full quarantine snapshot of every removed record
(gitignored, local-only, timestamped, hashed) before mutating, removes the
confirmed records from `keepGoingRuns`/`onboardedProjects`/`chatThreads`/
`portfolio.projects` (and defensively from `activeFleet`/`workSet`), then
recursively re-scans the ENTIRE resulting state for any leftover reference
to a removed id and refuses to save if any remain.

## What was actually removed (2026-09-15T05:18Z apply)

- 82 `portfolio.projects` / `onboardedProjects` entries
- 55 `keepGoingRuns` / `chatThreads` entries (only the `target`/`keep`
  buckets ever got a real dispatched run; the `exclude` bucket -- proving
  the test's own negation/exclusion behavior -- never did)
- 0 ambiguous records left untouched
- 0 dangling references to any removed id, anywhere in the resulting state
- Real projects (`niners-war-room`, the real WorldForge project,
  `tsf-orca`, and all other legitimate onboarded projects) verified
  byte-for-byte unaffected; `niners-war-room`'s real execution hold and
  `PAUSED` Keep Going run state were both confirmed untouched before and
  after.

Quarantine artifact (gitignored, not committed, local-only):
`server/.local-state/fixture-pollution-quarantine/fixture-pollution-quarantine.2026-09-15T05-18-36-057Z.json`

## Result

`/api/update-safety` moved from `WAIT_FOR_ACTIVE_WORK` (55 fixture projects)
to `SAFE_NOW` immediately after the write, with no server restart required
(the live server reads state fresh on every request).
