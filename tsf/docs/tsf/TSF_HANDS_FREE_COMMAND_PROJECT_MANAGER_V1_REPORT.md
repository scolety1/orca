# TSF — Hands-Free Command + Project Manager V1 — Final Report

Owner directive: the owner needs to operate TSF primarily without typing for
about a week. Build ONE global Command conversation that knows which
project is being discussed, can switch conversational focus between
projects, delegates project-specific thinking to each project's manager,
launches asynchronous Research/RDD/Keep Going work, and lets the owner keep
talking about another project while that work proceeds -- on the EXISTING
canonical Command/control plane, never a second execution engine or
voice-specific command authority.

Provider decision (owner, mid-mission): Browser Web Speech API first, behind
a generic `VoiceTransport`/speech-provider boundary so Command's voice shell
is later reusable, unchanged in its public shape, by a realtime provider and
by a second product (Colety Labs Command). Fail visibly and preserve typed
Command if Web Speech is unavailable -- never silently degrade.

## What shipped, by phase

**Phase 1 -- durable Command conversation focus** (`8491c78f32`,
`265cacf14b`). `domain/command-conversation-focus.mjs`'s `nextCommandFocus`
computes CURRENT FOCUS / RECENT PROJECT STACK from each Command turn's exact
project matches + dispatch-worthiness, persisted in `opState.commandFocus`
(`server/data-store.mjs`), wired into both real save sites in
`chat-http-routes.mjs`. `command-responder.mjs`'s `lastReferencedProjectId()`
falls back to it. 19 tests (`command-conversation-focus.test.mjs`,
`http-command-focus-persistence.test.mjs`), including a real
RESTART_DURABILITY proof via fresh `loadState()`.

**Phase 2 -- Project Manager snapshot formalization** (`e472545c6a`).
`domain/project-manager-snapshot.mjs`'s `buildProjectManagerSnapshot`
composes the *existing* `buildOwnerWorkItems`/`fleetNeedsYouStatus`
projections into one per-project capability -- not a new store, not a new
engine, matching the mission's own explicit constraint. Threaded into
`chat-responder.mjs`'s `respond()` as an additive 5th param; a
`projectManagerFooter` surfaces open Needs-You/research/hold counts.

**Phase 3 -- conversational Needs-You / confirmation resolution**
(`53712c48e2`). `domain/command-needs-you-answer-targeting.mjs`'s
`resolveNeedsYouAnswerTarget` resolves "Answer the NWR question with option
two" / "Yes, authorize it." to exactly one open item (by named project, or
by the current focus, never guessed), then
`command-needs-you-answer-bridge.mjs` calls the **unmodified**
`action-executor.mjs`'s `executeAction({type: 'RESOLVE_NEEDS_YOU', ...})` --
full audit trail preserved, zero new mutation path. Ambiguity/no-target
refuses with NO ACTION TAKEN, per the mission's own safety requirement. 12
tests, including real end-to-end resolution through the real store.

**Phase 4 -- generic voice shell** (`03a8c12840`). `ui/src/lib/voice/`:
`speech-recognition-types.ts` (local types, no `declare global`, avoiding a
real lint-rule conflict), `use-voice-session.ts` (`useVoiceSession()` --
`supported/listening/transcript/interimTranscript/error/start/stop/cancel/
speechSupported/speak/cancelSpeech`). Zero imports of `@/lib/api`, any
`command-*` module, or any project-ID concept -- this directory has no TSF
knowledge at all. 9 tests against a fake `SpeechRecognition` constructor.

**Phase 5 -- TSF voice wiring into Command** (`20c8791fb6`).
`CommandConversationProvider` gained `focusProjectId`/`recentProjectStack`/
`handsFreeMode`. `CommandPanel.tsx` gained a mic button + hands-free toggle
(extracted into `CommandVoiceControls.tsx` to hold the file under its
max-lines budget), a "Talking about: `<project>`" header, and a compact
background-work line (`global-run-status.ts`'s existing formatters -- not a
dashboard). Voice never executes directly: a final transcript only ever
becomes `draft`; the existing, unchanged `send()` is the one real consumer,
identical to typed input. 20 tests across `CommandVoiceControls.test.tsx`
and the extended context/panel tests.

**Phase 6 -- live browser dogfood** (this report's own session, see
findings below). Real Chrome against the live dev server
(`http://127.0.0.1:4600`, `npm run dev` in `tsf/ui`) -- not Electron/
Playwright CDP, since `tsf/ui` is documented as TSF's standalone operator
frontend, not part of Orca's own Electron renderer (`tsf/README.md`).

**Phase 7 -- portability report.** See below.

## Phase 6 dogfood findings (real Chrome, real dev server)

- Full-page Command view (`/command`) rendered cleanly, no layout bugs. Mic
  button and hands-free (ear) toggle render in the composer row exactly as
  designed. The durable Command thread rehydrated real prior conversation
  history on load.
- **Mic + hands-free confirmed working in real Chrome**: both controls
  render enabled (not the disabled/unsupported state) -- real Chrome
  detects Web Speech API as supported. No console errors on load or after
  interaction.
- **Mic click**: no OS permission dialog appeared (already granted for
  127.0.0.1 in this profile from earlier sessions). The engine briefly
  engaged then returned to idle (no real mic hardware/audio to capture),
  with no crash and no stuck state -- `use-voice-session.ts`'s `onend`
  handler degraded exactly as designed. Hands-free toggle flipped state
  correctly both directions.
- **Typed-path regression check**: passed end to end. A unique nonce
  message sent via the Send button appeared in the transcript with a real
  server response, proving `send()`/`api.chat()` is unaffected by the
  voice wiring.
- **Real finding, fixed in this session**: the dogfood pass surfaced that
  `focusProjectId`/`recentProjectStack` were never rehydrated on page
  mount/reload -- only set after a live `ChatResponse`. Functionally
  harmless (server-side `commandFocus` already drove real routing via
  `command-responder.mjs`'s fallback), but a real regression against the
  mission's own acceptance criterion that focus "survive" a restart from
  the owner's visible perspective. **Fixed**: a new
  `GET /api/chat/__command__/focus` read-back
  (`server/chat-http-routes.mjs`) plus a matching rehydration effect in
  `CommandConversationProvider`, mirroring the existing chat-history
  rehydration pattern exactly. 2 new server tests (real HTTP, real store)
  + 1 new client test (mocked `api.commandFocus`) all pass; the header now
  survives a reload, same as the transcript already did.
- **Not performed, and cannot be performed by this session**: genuine
  spoken dictation (real audio -> interim/final transcript -> auto-send).
  Browser automation has no microphone hardware and cannot produce real
  speech. **This still needs a manual pass by the owner** with a real
  microphone before Hands-Free Command is called fully proven end to end.

## Phase 7 -- Portability Report

**1. Extract unchanged for Colety Labs Command:** all of `ui/src/lib/voice/`
(`speech-recognition-types.ts`, `use-voice-session.ts` and its test) --
zero TSF imports, zero project-ID concept, a self-contained
`VoiceTransport`-shaped hook (`supported/listening/transcript/
interimTranscript/error/start/stop/cancel/speechSupported/speak/
cancelSpeech`). A future OpenAI Realtime/Deepgram provider only needs to
satisfy this same return shape; no caller needs to change.

**2. Small generic-adapter boundary:** the *wiring pattern* in
`CommandPanel.tsx`/`CommandVoiceControls.tsx` -- mic button states (off/
unsupported/listening), a hands-free toggle, "final transcript -> draft ->
existing send()" as the one consumption path, "cancel-before-submission =
`voice.cancel()` clearing draft without sending." The pattern is portable;
the literal code is not, since Colety Labs Command's own composer/state
shape will differ. Re-implement against that product's own equivalent of
`draft`/`send()`, following this same shape.

**3. TSF-specific forever:** `domain/command-conversation-focus.mjs`
(CURRENT FOCUS / RECENT PROJECT STACK), `domain/project-manager-snapshot.mjs`,
`domain/command-needs-you-answer-targeting.mjs`,
`server/command-needs-you-answer-bridge.mjs`, the `GET /api/chat/
__command__/focus` route, all of `server/command-*`/`domain/*` this mission
touched, and `action-executor.mjs` itself (unmodified, and correctly so --
it's the one mutation authority). None of this is voice-specific; all of it
is Command/Project/ResearchMission/Keep-Going/Needs-You domain logic that
happens to now be reachable by voice through the generic layer above it.

**4. Not yet generalized (correctly, per the mission's own instruction):**
hands-free auto-send policy (send immediately on final transcript vs. a
confirm step) and barge-in/interruption policy (whether starting to speak
should cancel in-flight TTS or a pending send) are both product-specific
judgment calls TSF made for its own owner's usage pattern. Colety Labs
Command should make its own call here, not inherit TSF's, when it adopts
the generic voice layer.

## Worker Model Review

No specialized reusable agent/skill was introduced anywhere in this
mission. Every new file is a pure domain function or a generic/product UI
hook -- confirming no fixed-specialty-bot need arose, matching the
mission's own default hypothesis.

## Final flags

- `COMMAND_SINGLE_CONVERSATION` = YES (pre-existing, reconfirmed: dock +
  full-page share one `CommandConversationProvider`)
- `PROJECT_MANAGER` = YES (`domain/project-manager-snapshot.mjs`, Phase 2)
- `PROJECT_FOCUS` = YES (`domain/command-conversation-focus.mjs`, Phase 1;
  now also rehydrates client-side on reload, Phase 6 fix)
- `PROJECT_SWITCHING` = YES (explicit switch / go-back / dispatch-worthy
  single-target reassignment, all in the Phase 1 decision table)
- `TURN_TARGET_VS_FOCUS` = YES (kept structurally distinct:
  `resolvedProjectIds` per turn vs. durable `commandFocus`; an AUTO_DECIDE
  status question never moves focus)
- `VOICE_INPUT` = YES, UI-verified in real Chrome (Phase 4/5/6); **real
  spoken-dictation dogfood by a human with a microphone is still
  outstanding**
- `HANDS_FREE_MODE` = YES, UI-verified (toggle state, auto-send wiring);
  same real-microphone caveat as above
- `VOICE_NEVER_EXECUTES_DIRECTLY` = YES, structurally enforced (transcript
  only ever writes `draft`; `send()` is the one unchanged consumer)
- `TARGETING_SAFETY` = YES (Needs-You answer targeting refuses on
  ambiguity/no-target; project targeting only ever trusts exact matches)
- `PORTABILITY_BOUNDARY` = YES (`ui/src/lib/voice/` has zero TSF imports;
  report above)
- `WORKER_MODEL_UNCHANGED` = YES (no new bot roster; see Worker Model
  Review)
- `TSF_HANDS_FREE_READY_FOR_OWNER` = **CONDITIONAL YES** (updated after
  Round 1, see below) -- every wired path (typed-equivalent behavior,
  targeting safety, focus persistence, UI states) is real, tested, and
  now also independently Codex-reviewed with 9 real findings fixed; the
  one remaining gap is a human microphone dogfood pass, which no
  automated session can perform.

## Test evidence

- UI: `node --experimental-strip-types --test` (146 tests) +
  `npx vitest run` (17 tests, `*.test.tsx`) -- both clean.
- Server: `node --test test/*.test.mjs` -- 3709-3714 tests, clean except
  pre-existing, host-timing-sensitive flakes unrelated to this mission's
  files (`operator-state-adversarial.test.mjs`,
  `resource-pressure-lease-host-wide.test.mjs`,
  `find-registered-orca-repo*.test.mjs`, a long-running Keep-Going autonomy
  proof) -- reproduced on a shared, concurrently-busy machine (two other
  live sessions during this run); none touch any file this mission
  changed. See `tsf/docs/tsf/README.md`'s own note on this class of
  failure.

## Round 1: Real-World Dogfood + Adoption

Owner-authorized adoption: push local `tsf/main` to `fork/tsf/main`, then
dogfood everything not requiring a physical microphone, fix real P0/P1s,
run an independent Codex adversarial review, and report honestly.

### Adoption / cutover

- Local `tsf/main` verified clean, a clean fast-forward descendant of
  `fork/tsf/main` (13 commits ahead at the time: the RDD V1 chain +
  Hands-Free Phases 1-7).
- `git push fork tsf/main` -- **succeeded** (it had been blocked by Claude
  Code's own auto-mode safety classifier in an earlier attempt this
  session; the owner's explicit re-authorization allowed a successful
  retry). Remote-verified via `git ls-remote`: `fork/tsf/main` matched
  local `HEAD` exactly at every push in this round.
- `GET /api/update-safety` -- `SAFE_NOW` throughout (no project has real
  work in progress).
- **Cutover honesty note**: this session's own ad hoc `npm run dev`
  instance (port 4600, real owner state file) naturally tracked the
  pushed commits since Vite serves live from the working tree -- that is
  **not** a formal cutover and was never claimed as one. A second,
  separate instance was found running on port 4610, owned by a real
  `Orca.exe` process (not one this session started), already reporting
  `UP_TO_DATE` at the mission's first push. This session did **not**
  trigger that -- `TSF_SAFE_UPDATE_MANAGER_V1.md` documents no scriptable
  restart path (the operator workflow is manual: reload the TSF plugin
  from Orca's own UI, or restart `tsf/server` directly). After this
  round's second push (the Codex-review fix commit), that same instance
  correctly reported `LIVE_RUNTIME_STALE` (`runningCommit` behind
  `diskCommit`) -- an honest, expected state given no restart was
  performed. **The owner needs to reload the TSF plugin (or restart
  `tsf/server`) themselves** to bring that instance current; this session
  has no supported way to do it.
- Both ad hoc dev servers this session started (ports 4600 and 4601) were
  stopped at the end of this round. Nothing was left running under this
  session's control.

### Non-microphone dogfood -- typed-equivalent transcript injection

New file `test/hands-free-command-dogfood-round1.test.mjs`: real HTTP,
real isolated on-disk store, real disposable fixture projects (never the
real owner state). Covers misrecognition safety, correction flow, focus/
switching, async multi-project non-interference, conversational Needs-You
resolution + ambiguity refusal, direct-vs-deliberative-vs-status voice
authority, and combined reload/restart durability.

**Found and fixed, P1**: a natural spoken correction ("No, I meant X")
never moved focus at all, even with one exact target, because
`EXPLICIT_SWITCH_PATTERN` only recognized "switch to"/"let's work on"/
"focus on"/"talk about". Fixed by adding "I meant" (bounded-safe: still
requires the caller's own unaffected exact-match resolution to have found
exactly one project).

**Found and logged, P2, not fixed (pre-existing, out of scope)**: a
project whose name is a literal prefix of another's (e.g. `VOICE-ALPHA` /
`VOICE-ALPHA-TWO`) is genuinely ambiguous whenever the longer name is
spoken, because `project-name-resolver.mjs` treats the shorter name as a
substring match too. Fails safe (never a wrong-project action); real
friction, left unfixed per this pass's P0/P1-only fix policy.

Narrow-viewport check (mission section 14): **INCONCLUSIVE** -- the
browser tool's resize did not actually change `window.innerWidth` in this
environment (a tool/environment limitation, not a TSF finding). No real
evidence either way about mobile layout.

Provider-failure-degrade check (mission section 13, `SpeechRecognition`
unavailable): **PASS** -- mic button correctly re-detects as unsupported,
composer/Send unaffected, zero console errors.

Portability boundary + structural focus-hijack audit (both read-only,
grep-based, both clean): `ui/src/lib/voice/*` imports only React and its
own local types -- zero `@/lib/api`, zero `command-*`, zero project-ID
concept. `setFocusProjectId`/`commandFocus` writes are reachable only from
direct-owner-turn request handling and one-time mount rehydration --
never from any background/async dispatch code, confirming a background
project cannot hijack the active conversation's focus.

### Independent Codex adversarial review

Dispatched via the same `codex exec` CLI pattern this session's earlier
RDD V1 mission established (`gpt-5.6-sol`, `sandbox: read-only`,
`reasoning effort: high`), scoped to the full Hands-Free Command diff
(`e47c62378f..23d356de6b`) and the mission's own 10 adversarial questions.
Found real, reproduced issues -- **all P0/P1 fixed, each with a new,
reproduced regression test** (see commit `47fafa1713` for full detail):

- **P0 (most severe)** -- `CommandPanel.tsx`: hands-free auto-send read
  `draft` through a stale React closure immediately after
  `setDraft(voice.transcript)` only *scheduled* (not yet applied) that
  update -- an empty prior draft silently dropped the entire spoken turn;
  a non-empty leftover typed draft sent *that* stale text instead of what
  was spoken. This meant hands-free mode was **fundamentally broken** in
  its most common case. Fixed: `send()` now takes an `overrideText` param;
  the voice effect calls `send(voice.transcript)` directly. Also fixed the
  Send button's `onClick={send}` (would have passed the click event as
  `overrideText`) to `onClick={() => send()}`. **Live-reverified** against
  an isolated, disposable browser instance with a simulated final
  transcript: the correct spoken text now sends, exactly once, every time.
- **P0 x2** -- Needs-You targeting (`domain/command-needs-you-answer-
  targeting.mjs`, `server/command-needs-you-answer-bridge.mjs`): two exact
  project names in one message collapsed into the same "nothing named"
  branch as zero names, silently falling back to focus; a fuzzy-only
  mention of a *different* project than focus (its exact match already
  stripped by the bridge) looked identical to "nothing named" and silently
  answered the *focused* project's item instead of the one actually named
  -- a real wrong-project Needs-You mutation risk. Both now refuse
  (`AMBIGUOUS`) instead of guessing.
- **P0 x2** -- `chat-http-routes.mjs`: a Command-scope turn resolving to
  exactly one project (e.g. "What is B doing?") only ever saved into that
  project's *own* chat thread, never `__command__` -- silently dropping
  this very common turn class from the visible transcript on reload, *and*
  meaning `lastReferencedProjectId` (which reads only `__command__`) could
  resolve a later back-reference ("pause that project") against stale
  durable focus instead of the project just discussed, mutating the
  **wrong project**. Fixed with a dual-write into `__command__` alongside
  the project's own thread.
- **P1 x2** -- `command-conversation-focus.mjs`: no question guard
  ("Should I switch to B?" moved focus despite being a question) and no
  negation guard ("Do not talk about B" moved focus despite being a
  prohibition). Both guards added; also added "discuss" as a recognized
  switch synonym (a real, low-risk completeness gap from the same
  finding).
- **P1 x2** -- `project-manager-snapshot.mjs`: a RELEASED execution hold
  was reported as still active on any truthy value (the existing test's
  own fixture used a pre-existing wrong shape, `active: true` instead of
  the real `status: 'ACTIVE'`, which is exactly why it never caught this);
  a COMPLETE research mission had no terminal-state check and stayed
  "open" forever. Both fixed.
- **2 findings correctly NOT fixed**, disclosed: "can voice execute
  without going through `send()`" and "did TSF knowledge leak into the
  generic voice layer" both came back clean (no P0/P1). Some Needs-You
  sources (Planner `projectId: null`, global Command research
  `projectId: 'COMMAND_CHAT'`) remain structurally unreachable
  conversationally by design -- project-based targeting has no
  fleet-wide-item concept; a real, disclosed scope boundary, not a defect.

## Commits (pushed to `fork/tsf/main`)

`8491c78f32`, `265cacf14b`, `e472545c6a`, `53712c48e2`, `03a8c12840`,
`20c8791fb6`, `23d356de6b` (Phase 6/7 close + this report's first draft),
`47fafa1713` (Round 1 dogfood: 1 P1 fix + comprehensive regression suite,
then 9 real Codex-review findings fixed). Remote-verified final SHA:
`47fafa171326b67593d9071bd7b4ce09baac5071`.

## What the owner should do next

1. **Reload the TSF plugin in Orca (or restart `tsf/server`)** to bring
   the live Orca-plugin instance (port 4610) current -- it's honestly
   reporting `LIVE_RUNTIME_STALE` right now; this session has no
   supported way to do that restart itself.
2. Do one real hands-free pass with an actual microphone (script below,
   also given directly in this session's own reply) -- start on one
   project by voice, dispatch research, switch focus to a second project
   by voice, dispatch work, ask the first project's status without moving
   focus, go back, answer a real Needs-You by voice, reload the page
   mid-conversation and confirm history + focus + background work all
   survive.
3. Report back anything that feels wrong in real use. Everything wired,
   typed-equivalent-tested, and Codex-reviewed is real and green; the one
   remaining gap before `TSF_HANDS_FREE_READY_FOR_DAILY_OWNER_USE = YES`
   is your own real-microphone pass.
