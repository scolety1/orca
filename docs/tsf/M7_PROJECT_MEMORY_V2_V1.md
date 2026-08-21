# M7: Project Memory V2 — Wave 1 Research

## What already exists (read directly from source, not assumed)

The acceptance criteria's own first line requires inspecting existing
capsules/onboarding state/receipts/session affinity/backlog before adding
new storage — done here.

1. **`tsf/domain/receipts.mjs`** already provides a real, hash-chained,
   append-only decision/audit record (`createReceipt`/`verifyReceipt`),
   used today for `MISSION_CREATED`, `CANDIDATE_FINISHED`,
   `VERIFIER_RESULT`, `ADOPTION_DECISION`, `RELEASE_PROMOTION`,
   `HUMAN_CONSEQUENTIAL_APPROVAL`, `PROJECT_ONBOARDED`. Each receipt
   chains to `previousReceiptHash` and self-verifies via `sha256`. This
   structurally satisfies "explicit user decisions cannot be silently
   overwritten" (append-only + tamper-evident) — **a strong candidate
   backbone for the Decisions memory class**, not something to
   reinvent.

2. **`tsf/domain/session-affinity.mjs`** is about provider/session
   *identity* continuity (which model/session is bound to which
   role/scope) — unrelated to project *content* memory. Confirmed by
   reading it in full: no facts/preferences/experience data lives here.

3. **`tsf/domain/onboarding.mjs`** (`classifyMigration`/
   `reconcileHandoff`) is a one-time, stateless classification pass over
   facts handed to it — it produces a classification and reasons, but
   persists nothing across sessions itself (persistence, if any, is the
   caller's job via `buildOnboardingReceipt`, which just wraps the
   generic receipt system above).

4. **`tsf/domain/keep-going.mjs`'s `settleInFlightWave`** (an M4 finding)
   already persists compact, real wave outcomes onto a run's own
   `waves[].waveResult.outcomes` — a genuine, existing per-run
   "what happened" history. This is scoped to **one Keep Going run**,
   though, not aggregated or retrievable across multiple runs/projects —
   a real gap remains for cross-session "Experience/Lessons" recall.

5. **M6's own research surfaced a real, already-integrated persistence
   primitive worth considering here**: Orca's plugin host API
   (`plugin-host-api.ts`'s `storage.get/set/delete/keys`) is a genuine
   plugin-private key-value store (capped at 256KB/value, 5MB total per
   plugin) already reachable from `tsf/main.mjs`'s `activate(orca)` via
   `orca.host.call`. It's a candidate storage backend for some memory
   classes (small, structured, plugin-scoped data) — though its 5MB
   total cap and lack of any query/filter capability (`storage.keys`
   returns ALL keys, no scoping) means it likely isn't sufficient alone
   for "retrieval is project-scoped, selective, provenance-aware,
   bounded" without a layer on top.

6. **No existing "Facts" or "Preferences" store exists anywhere** in
   `tsf/domain`, `tsf/server`, or `tsf/contracts` — confirmed by reading
   every domain module's exports. These two of the four required memory
   classes are a genuine, real gap requiring new (additive) storage.

7. **`result-capsule.schema.v1.json`'s `evidence`/`implementationSummary`/
   `recommendedNextStep` fields** are per-mission response data — no
   evidence anywhere that these are durably persisted beyond the
   immediate HTTP response/chat turn they're produced in. A real gap:
   nothing currently retains a worker's own "what I learned/what didn't
   work" content for later cross-session recall.

8. **Hindsight is explicitly an `OPTIONAL_MEMORY_BACKEND`**, per
   `docs/tsf/SOURCE_HARVEST_LEDGER_V1.md`'s own ledger row and this
   program's established harvesting discipline: harvest concepts from
   named sources (Zenith/Command Center/Smithers/OpenWeft/Hindsight),
   never vendor a runtime, and for Hindsight specifically — evaluate it
   only *after* trying whether TSF's own, smaller, native primitives
   (the receipt chain, a new bounded fact/preference store) are
   sufficient. Every prior harvested concept in that ledger ended up
   implemented as a pure function or mapped onto an existing Orca CLI
   primitive, never a new runtime — the same bar applies here.

## Real, remaining gap (confirmed, not assumed)

Two of the four required memory classes (Facts, Preferences) have no
existing storage anywhere; the other two (Decisions, Experiences-Lessons)
have strong existing partial building blocks (the receipt chain; keep-going's
per-run wave history) that are not yet unified into one project-scoped,
retrievable, provenance-aware memory surface. The acceptance criteria's
"retrieval is project-scoped, selective, provenance-aware, bounded" and
"stale facts can be superseded" criteria have no existing implementation
to check against at all — this is real, additive design work, not a false
gap like M4/M5 found in their own first drafts.

## Open questions for wave 2 (deliberately not resolved by guessing)

1. **Storage backend choice**: does a new memory store belong in
   `tsf/server/data-store.mjs`'s existing local-state JSON file (matching
   the pattern every other TSF server-side state uses today), or does it
   need its own file/store given potential size (bounded, but a project
   could accumulate many facts/experiences over a long lifetime)? Read
   `data-store.mjs`'s actual current size/growth characteristics before
   deciding.
2. **Provenance shape**: what, concretely, does "provenance-aware"
   retrieval mean here — does every fact/preference/experience record
   need to cite the receipt/mission/wave it came from (mirroring the
   receipt chain's own `previousReceiptHash`/`identities` pattern), and
   should recall surface that provenance to the reader (matching the
   onboarding classifier's own "every reason cites the exact fact"
   discipline)?
3. **Supersession semantics**: "stale facts can be superseded; explicit
   user decisions cannot be silently overwritten" implies two different
   mutation policies for two different memory classes. What triggers a
   fact's supersession (time-based staleness? an explicit newer
   observation contradicting it? both?), and how is a "cannot be
   silently overwritten" decision enforced structurally (a `authorizedBy`
   gate, matching `keep-going.mjs`'s own `replaceGoal` pattern harvested
   from Zenith) rather than just documented as a rule nothing enforces?
4. **Retrieval bound**: "no giant transcript injection" (an explicit
   test requirement) — what's the actual mechanism that keeps retrieved
   memory bounded when handed to a planner/chat call? Does this reuse
   `project-context-capsule.schema.v1.json`'s existing capsule-size
   discipline, or does it need its own cap?

Wave 2's job is answering these with real evidence (reading
`data-store.mjs`, `project-context-capsule.schema.v1.json`, and
`chat-responder.mjs`'s own context-building path) before writing any
schema or storage code, exactly the research-first discipline this
program has now validated across M4, M5, and M6.
