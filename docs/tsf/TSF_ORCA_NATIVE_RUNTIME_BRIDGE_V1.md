# TSF Orca Native Runtime Bridge V1

Verdict: `GREEN_TSF_ORCA_NATIVE_RUNTIME_BRIDGE_V1_PROVEN`

This report records the first real vertical slice from the TSF governance overlay through Orca's production runtime to a real Codex worker, independently verified candidate, restart recovery, and explicit fixture-only adoption. No real project was registered or accessed, no remote action occurred, and no Orca core file was modified.

## Scope and immutable identities

- Successor: `C:\TSF_ORCA`
- Starting successor HEAD: `73134b43dbcbfba4d7f88c895525145bb8a08fe7`
- Orca upstream: `stablyai/orca` `v1.4.184`
- Orca upstream commit: `2307f2ebbe1c1e737c0b12d920bb0a208332db2c`
- Disposable fixture: `C:\TSF_ORCA_RUNTIME_BRIDGE_FIXTURE`
- Fixture Stable base: `7b9f1e0429f8c918bd977fba19aa4d4f0152e4ba`
- Fixture Stable tree: `5333ecb6541b14c466004a23b8f128a2179d3e30`
- Upgrade candidate: `c437bd1765ff7de20a33cc2cdb9f3f074126fa3e`
- Upgrade tree: `f4bec901a88edc4843de7aade8bdf0fd6b9c94b4`

## 1. Root cause of stale CLI attachment

The prior attempt mixed two launch/discovery contexts. It invoked the development CLI entry at `C:\TSF_NEXT\out\cli\index.js` while launching the installed packaged application. Orca's CLI discovers the runtime through `orca-runtime.json` under the canonical Electron user-data path; the production native launcher also pins the packaged CLI and canonical profile together. The production profile still contained metadata for a dead prior PID, so the production CLI correctly reported `stale_bootstrap` even though the separately launched development serve process had printed readiness.

The bounded correction was configuration-only: use the installed native launcher at `C:\TSF_FOUNDATION_EVAL\installed\orca\resources\bin\orca.exe` for both `serve` and every control-plane command. No cache was deleted and no source file was changed. The launcher started packaged Orca `1.4.184`, wrote the canonical metadata, and `status --json` immediately reported the identical runtime ID as `ready` and reachable.

## 2. Runtime topology and attachment path

```text
installed native orca.exe CLI
  -> packaged Orca.exe --serve
  -> OrcaRuntimeRpcServer
  -> %APPDATA%\orca\orca-runtime.json
     -> named-pipe control transport
     -> loopback-advertised WebSocket transport
  -> production CLI commands authenticated through runtime metadata
```

The first attached owner was PID `6076`, runtime `34458289-58a0-43d5-aade-bae40a79adb7`, with readiness type `orca_server_ready`. Pairing was explicitly disabled. The native CLI reported `runtime.state=ready`, `runtime.reachable=true`, `graph.state=ready`, and app version `1.4.184` against that exact identity. Auth tokens were never copied into TSF artifacts or this report.

## 3. TSF fixture registration and routing

TSF registered exactly one project, `fixture:tsf-orca-runtime-bridge`, with source class `FIXTURE` and provenance `DISPOSABLE_SYNTHETIC`. It is the sole Known Project, Active Fleet member, and Work Set member.

Usage Mode was `TEST_MINIMAL`. The mission's explicit role requirement overrode that mode's cheap-worker default and resolved stable role `WORKER_BALANCED` to replaceable profile `CODEX_SAFE`, provider `openai`, and agent `codex`. Requested execution was `gpt-5.6-sol` at `high`; the live session observed those exact values.

## 4. Real task, session, and worktree identities

- TSF mission: `tsf-orca-native-runtime-bridge-v1`
- TSF work item: `tsf-orca-native-runtime-bridge-v1-worker-1`
- Orca Run: `run_79578caf1acb`
- Orca task: `task_86fb11c93eed`
- Successful dispatch: `ctx_b1be706d2dec`
- Superseded fenced launch attempt: `ctx_86f4c7d63994`
- Worker terminal: `term_8e453c5b-c8c0-4320-9ce8-c5678050eee1`
- Provider conversation: `01a01270-3aae-7102-9a99-10027248ab64`
- Worktree ID: `ab58eb9a-4367-4091-a9d2-fb8f7d975a83::C:/Users/codex-agent/orca/workspaces/TSF_ORCA_RUNTIME_BRIDGE_FIXTURE/tsf-runtime-bridge-upgrade`
- Worktree path: `C:\Users\codex-agent\orca\workspaces\TSF_ORCA_RUNTIME_BRIDGE_FIXTURE\tsf-runtime-bridge-upgrade`
- Branch: `tsf-runtime-bridge-upgrade`

Orca created the isolated linked worktree and task. TSF bound the real runtime facts into `TSF_SESSION_BINDING_V1` and `TSF_ORCA_DISPATCH_V1`; it did not duplicate Orca's terminal, process, task, or worktree state.

## 5. Worker launch and bounded Windows correction

The initial native `worker-start --agent codex` created one terminal but PowerShell resolved bare `codex` to the protected WindowsApps executable. That executable failed with `Access is denied`; Orca fenced the attempt after its readiness timeout. No task, terminal, or worktree was duplicated.

The existing TSF `CODEX_SAFE` profile was then used inside the same Orca-created terminal. It resolves the installed npm Codex JavaScript entry, keeps `workspace-write`, `on-request` approval, network disabled, and rejects blanket bypass arguments. Codex `0.144.1` started in the exact Upgrade worktree and visibly reported `gpt-5.6-sol high`. Orca's supported `--retry-of` flow reused that terminal and task, accepted the task input, and settled dispatch `ctx_b1be706d2dec` as `succeeded` after the worker sent genuine `worker_done` message `msg_c56929574670`.

This correction stayed in the TSF provider adapter. `ORCA_CORE_FILES_MODIFIED=0`.

## 6. Plan capsule evidence

The validated compact handoff is `tsf/fixtures/runtime-bridge-v1/plan-capsule.json`. Its exact JSON was stored in the Orca task spec and the worker independently read the same file before editing. It allowed only `src/greeting.js` and `test/greeting.test.js`, required `npm test` and a local candidate commit, and prohibited real-repository access and all remote/release actions.

## 7. Real edit and test evidence

The worker changed `bridgeGreeting()` from `bridge pending` to `Orca native runtime bridge verified.` and updated the exact assertion. It ran `npm test`; one test passed and zero failed. It created local Upgrade commit `c437bd1765ff7de20a33cc2cdb9f3f074126fa3e` with message `feat: verify native runtime bridge`. The Upgrade worktree was clean afterward and only the two authorized files differed from Stable.

Stable/main remained at `7b9f1e0429f8c918bd977fba19aa4d4f0152e4ba` throughout worker completion and verification.

## 8. Result capsule evidence

The validated real result is `tsf/fixtures/runtime-bridge-v1/result-capsule.json`. It records the real mission/work item, provider, model, Orca terminal, provider conversation, worktree, candidate commit/tree, changed files, test exit, settled dispatch, worker message, clean Git state, and empty blockers. It was constructed only after independent Git and Orca facts agreed with the worker report.

## 9. Independent verifier evidence

A distinct Orca terminal, `term_61264a97-98ac-4023-813a-9fa7a630d185`, ran the deterministic TSF verifier. It did not reuse the implementation session. After correcting its own Windows `.cmd` invocation, it returned GREEN on 11 checks:

- candidate commit and tree match the result capsule;
- Stable commit and tree are unchanged;
- the exact isolated linked worktree is in use and clean;
- only the two allowed paths changed;
- source value and test assertion are exact;
- an independent `npm test` run passed 1/1.

The durable result is `tsf/fixtures/runtime-bridge-v1/verifier-result.json`.

## 10. READY_FOR_ADOPTION transition

TSF admitted the real worker result into `REVIEW`, then admitted the independent GREEN verifier. Only then did the mission and candidate reach `READY_FOR_ADOPTION`. Receipts recorded mission creation, candidate completion, and verification. No adoption or Stable change occurred at worker completion.

## 11. Restart and recovery proof

The first runtime was stopped with the documented Ctrl+C path. PID `6076` exited and port `64243` had no listener. Restart produced runtime `517051c4-ba54-41a7-979a-c558e57547c3` and PID `27324`.

Under that new runtime, Orca recovered the same Run, completed task, settled successful dispatch, worker report, worktree ID, branch, and candidate commit. The original terminal handle remained as a durable dispatch reference but its PTY was stale, which is expected after daemon restart. The provider conversation `01a01270-3aae-7102-9a99-10027248ab64` was then actually resumed in a new Orca PTY, `term_4e1c8d9d-9890-47a7-8d05-0528a1392c87`, in the same worktree; the prior transcript and result were visible. No new task, dispatch, worktree, or provider conversation was created. The resumed Codex process was exited after proof.

TSF affinity checks matched Run, task, dispatch, original session reference, and worktree identities, and the mission remained `READY_FOR_ADOPTION`. Evidence is in `recovery-facts.json` and `recovery-resume-proof.json`.

## 12. Explicit fixture adoption

After recovery was GREEN, TSF executed request `fixture-adopt-native-runtime-bridge-v1` against the candidate binding. The candidate and mission became `ADOPTED`, the Upgrade track became `ADOPTED_LOCAL`, and the adoption receipt extended the valid receipt chain.

Adoption did not merge or promote Stable. Stable/main deliberately remained on the base commit/tree while the adopted local Upgrade track points to the verified candidate. This preserves the rule that worker completion is not adoption and adoption is not automatic Stable promotion.

## 13. Post-adoption recovery

Runtime `517051c4-ba54-41a7-979a-c558e57547c3` was stopped; PID `27324` and the listener disappeared. Runtime `7588786d-2bf7-40cc-8c8f-e5a65e4a62ed`, PID `7164`, then recovered the same completed task and settled dispatch. TSF reloaded `ADOPTED` mission/candidate state, `ADOPTED_LOCAL` Upgrade state, two successful recovery checks, and a valid receipt chain. No duplicate mission, worker, task, dispatch, or worktree appeared.

## 14. Windows reliability subset

- Short roots were used for successor and fixture; TSF-controlled artifact filenames are at most 64 characters.
- Each shutdown released its owner PID and port `64243`; no stale owner or listener survived.
- One successful worker session was used. The recovery dispatch reused its terminal; the fenced failed startup record is preserved for provenance.
- The worktree was an Orca-managed isolated linked worktree and finished clean.
- Stable/main remained unchanged and no cross-repository write was observed.
- Plan, result, verifier, recovery, and state artifacts are UTF-8 JSON and validated after transport.
- No `0xc0000142` occurred.
- No dependency or global CLI install ran. The Codex update prompt was explicitly skipped.
- Ctrl+C leaves non-authoritative runtime metadata long enough for `status` to say `stale_bootstrap`, but no process/listener remains and the next native serve atomically replaces it.

## 15. Orca core delta

`ORCA_CORE_FILES_MODIFIED=0`.

All successor changes are under `tsf/` and `docs/tsf/`. The bridge uses Orca's native runtime, Run/task/dispatch, worktree, terminal, and persistence seams rather than introducing a second worker runtime.

## 16. Caveats

1. On this Windows host, packaged Orca's generic Codex command resolution selected the inaccessible WindowsApps executable. Until upstream command resolution is hardened, TSF should select `CODEX_SAFE` explicitly for native Windows workers.
2. The worker's bare in-terminal `orca` alias initially targeted a non-attached CLI profile. Long runs should inject the installed native CLI path or canonical `ORCA_USER_DATA_PATH` for completion messages.
3. Orca terminal PTYs are not live across server restart. Durable task/dispatch identity and provider conversation resume provide the recovery seam; TSF should treat the new PTY as a recovery attachment, not a new mission worker.
4. A nonfatal Codex session scanner `ENOENT` warning appeared during the second shutdown for a date directory that did not exist. It did not affect runtime, task, or session recovery.

## 17. Long autonomous fixture authorization readiness

The successor is ready for a carefully bounded long autonomous **fixture-only** real-runtime run. That run should mandate the native production CLI, the `CODEX_SAFE` Windows launch profile, explicit completion routing to the attached runtime, durable task/dispatch checks before retry, and recovery-by-provider-conversation when PTYs restart. This mission does not authorize a real-project pilot or automatically start the long run.
