# TSF Overlay Architecture

## Shape

```text
Orca v1.4.184
├── native projects, worktrees, terminals, agents and sessions
├── native provider launch, browser, diffs, runtime recovery and orchestration facts
├── plugin API v1
└── tsf/
    ├── adapters/       Orca-fact and dispatch boundary
    ├── contracts/      compact handoffs, context and session affinity
    ├── domain/         mission, portfolio, routing, adoption, release, receipts, Health
    ├── providers/      safe provider profiles (configuration)
    ├── routing/        roles and Usage Modes (configuration)
    ├── migration/      111-capability and upstream-delta records
    ├── fixtures/       synthetic dogfood only
    ├── pilots/         real pilot project evidence (read-only source for server/)
    ├── server/         narrow adapter: projects tsf/domain + tsf/pilots into JSON for ui/ (see docs/tsf/TSF_ORCA_OPERATOR_UI_V1.md)
    ├── ui/             standalone operator frontend (Vite/React); not an Orca plugin panel
    ├── test/           overlay, plugin contract, and operator-UI-server tests
    ├── main.mjs        Orca plugin worker entry
    └── panel.html      smallest read-only TSF operator surface
```

## Rules

1. Orca runtime/session/worktree facts are never duplicated as TSF process truth.
2. TSF maps Orca facts into high-level mission and Health states.
3. Provider/model names are replaceable configuration below stable TSF roles.
4. Planner, worker, and verifier identities remain distinct.
5. Worker completion is evidence. It is not adoption, release promotion, commit, or publication authority.
6. Stable and Published remain unchanged while Upgrade and Testing candidates are worked.
7. Consequential actions use exact bindings and idempotent request identities.
8. Plugin API v1 is experimental; all host coupling stays behind `tsf/adapters/` and contract tests.

## Extension-seam result

The official Orca plugin seam supports a sandboxed panel, commands, private storage, and bounded worktree/agent events. It does not yet expose the complete Run/task/dispatch graph through the public plugin API. The successor therefore uses the plugin for bounded operator integration and keeps orchestration adapters explicit. No Orca core patch was introduced to hide this gap.

## Operator UI V1

`tsf/server` + `tsf/ui` are a standalone TSF-owned overlay/module (the rung below the plugin seam in this file's preference order), not a plugin panel and not an Orca core change. `tsf/panel.html` remains the plugin-native drill-down surface. See `docs/tsf/TSF_ORCA_OPERATOR_UI_V1.md` for the full architecture, what's real vs. fixture-backed, and remaining gaps.
