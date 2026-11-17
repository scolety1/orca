# TSF overlay: engineering tour

Thousand Sunny Fleet (TSF / T dot) coordinates work across software projects on top of [Orca](https://github.com/stablyai/orca). The distinguishing work is the overlay's explicit mission, evidence, adoption and release state—not the upstream IDE, terminal, session or worktree implementation.

## Product direction: an agentic corporation

Spencer Colety describes TSF as an **agentic corporation**: a captain coordinates team leads and specialist workers, divides large projects into bounded tasks, runs independent work in parallel, reviews results and escalates serious blockers. The purpose is sustained progress across large software projects with less repeated manual prompting.

Spencer reports using Dot as the conversational interface connected to TSF's backend, bringing project discussion and the fleet workflow together. **T.Dot is a working name for that integration.** This owner-reported workflow does not mean every integration or newer local change is present in this public branch.

Reliable overnight and multi-day execution is an ongoing engineering goal. Completing a game-scale project in a few days is an ambition, not a measured throughput guarantee. Test-driven development, handoffs, recovery and acceptance checks remain central to the work. Orca, Dot and model providers retain credit for their underlying systems.

## Contribution and attribution

Spencer Colety directs and develops the TSF project with AI assistance. The `tsf/` overlay contains project-specific domain logic, orchestration and operator surfaces. The underlying Orca application and its contributors retain credit for the substrate; this fork must not be described as a wholly original IDE. Git author labels alone do not establish which lines were manually written.

## Start reading here

1. [Adoption](domain/adoption.mjs): completed work becomes a candidate; exact binding and decision gates control acceptance.
2. [Release state](domain/release-state.mjs): stable, upgrade and testing states remain separate.
3. [Executable adoption/release examples](test/adoption-release.test.mjs).
4. [Foundation contracts](test/foundation-contracts.test.mjs): bounded commands, provider-role configuration and handoff schemas.
5. [HTTP adapter](server/http-server.mjs) and [operator UI](ui/): the I/O boundary around the domain.

## Run a bounded example

With Node.js 24, from the repository root:

```sh
node --test tsf/test/foundation-contracts.test.mjs tsf/test/adoption-release.test.mjs
```

Verified November 14, 2026 against public `tsf/main` source `2c069c68488cd045ed3dc3e7714c57848f59a0fb`: seven tests passed. These fixture examples exercise contract registration, adoption and release state without starting a real agent or merging a user repository.

For operator setup see [the TSF README](README.md). The full Orca/Electron build, provider-backed dispatch and all TSF tests were not rerun for this documentation update. Seven passing checks are not a claim that the full runtime is green. Real orchestration can mutate project repositories and requires an intentionally configured environment.

This page documents the current public branch. Newer local recovery/adoption work and dirty worktrees were not merged or published with it. No runtime, provider configuration or operational state changed.
