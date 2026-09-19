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
- `TSF_HANDS_FREE_READY_FOR_OWNER` = **CONDITIONAL YES** -- every wired
  path (typed-equivalent behavior, targeting safety, focus persistence,
  UI states) is real and tested; the one remaining gap is a human
  microphone dogfood pass, which no automated session can perform.

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

## Commits (local `tsf/main`, not yet pushed)

`8491c78f32`, `265cacf14b`, `e472545c6a`, `53712c48e2`, `03a8c12840`,
`20c8791fb6`, plus one closing commit for the Phase 6 focus-rehydration fix
and this report.

**Push to `fork/tsf/main` still needs owner action** -- consistent with
this session's prior RDD V1 mission, `git push` is blocked for this session
by Claude Code's own auto-mode safety classifier, not by any real
conflict or CI failure.

## What the owner should do next

1. Pull/inspect the local commits above (or ask this session to push once
   you're ready) and run `npm run dev` in `tsf/ui`.
2. Do one real hands-free pass with an actual microphone: start on one
   project by voice, dispatch research, switch focus to a second project
   by voice, dispatch work, ask the first project's status without moving
   focus, go back, answer a real Needs-You by voice, reload the page mid-
   conversation and confirm history + focus + background work all survive.
3. Report back anything that feels wrong in real use -- this report's
   `CONDITIONAL YES` becomes a plain `YES` once that pass is clean.
