# Thousand Sunny Fleet Overlay

This directory is the separable TSF-owned overlay for the Orca foundation. It keeps Orca in charge of agents, terminals, sessions, worktrees, provider launch, browser/runtime facts, and recovery. TSF owns provider-neutral roles, compact handoffs, portfolio attention controls, mission state, adoption, release protection, evidence, and high-level Health.

The implementation is fixture-only. It grants no authority to onboard a real project, push, merge, deploy, publish, read credentials, or mutate production.

Run the bounded checks with:

```powershell
node --test tsf/test/foundation-contracts.test.mjs
node --test tsf/test/*.test.mjs
node tsf/health/foundation-health.mjs
node tsf/fixtures/run-dogfood.mjs
```
