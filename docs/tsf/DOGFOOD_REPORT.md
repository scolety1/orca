# Fixture Dogfood Report

## Result

`GREEN_OVERLAY_DOGFOOD`

The deterministic fixture exercises the TSF domain and Orca adapter contracts:

1. register one synthetic project;
2. add it to Active Fleet and Work Set;
3. choose Balanced mode;
4. create an ambiguous goal and persistent planner identity;
5. decompose into two disjoint work items;
6. admit two compact worker results with distinct Orca session/worktree identities;
7. admit a GREEN verifier result from a third session;
8. move the high-level mission to `READY_FOR_ADOPTION`;
9. perform exact-binding fixture adoption;
10. emit four valid Receipt Lite records;
11. prove Stable and Published remain unchanged by worker completion and local adoption.

Run with `node tsf/fixtures/run-dogfood.mjs`.

## Native Orca attempt

The already-installed Orca `v1.4.184` headless server started for a disposable temp Git repository and emitted `orca_server_ready`. The production CLI continued to report `stale_bootstrap` / runtime not reachable and could not discover the ready server. The server was stopped cleanly. No Orca worktree or terminal worker was created, no pairing code or credential was inspected, and no raw-Git substitute is presented as native evidence.

Result: `NATIVE_ORCA_WORKTREE_TERMINAL_DOGFOOD_INCOMPLETE_RUNTIME_DISCOVERY`.

## Honesty boundary

The committed deterministic runner proves TSF domain behavior and Orca identity/adapter contracts. It does not claim native Orca worktree execution, a live Claude planner, a live Codex worker conversation, native plugin-to-Run dispatch, browser automation, or a real-project pilot.
