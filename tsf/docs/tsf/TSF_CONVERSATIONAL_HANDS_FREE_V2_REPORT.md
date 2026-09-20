# TSF — Conversational Command + Continuous Hands-Free V2 — Final Report

Owner directive: Hands-Free Command V1 was real and working in Chrome, but
real microphone dogfood exposed four concrete product failures. Turn
Command into a genuinely conversational, multi-project development
interface -- fix the four failures, make hands-free feel like a live
conversation rather than dictation-into-a-textbox, and keep the strict
generic/TSF-specific portability boundary intact throughout. Zero-relay:
no owner check-ins for implementation choices.

## The four real, reported failures

1. **Project resolution too brittle** -- "Thousand Sunny Fleet"/"TSF"/
   "Sunny Fleet" and "CLC"/"Colety Labs" resolved to nothing, even though
   the canonical projects exist.
2. **Hands-free ends after every turn** -- the owner had to manually
   reactivate voice after each submission.
3. **Feels like dictation, not conversation** -- click mic -> dictate ->
   send -> read reply -> click mic again, not a live back-and-forth.
4. **Multi-project conversation must feel natural** -- switching projects
   mid-conversation, asking about a different project without losing
   focus, "go back," background work continuing independently.

## Phase 2 (Reconcile) -- why "Thousand Sunny Fleet" didn't resolve

Traced, not assumed: TSF's real onboarded project is `tsf-orca`,
displayName `TSF_ORCA`. `tokenize('TSF_ORCA')` -> `['tsf', 'orca']`. "TSF"
alone overlaps only 1 of 2 tokens (a 0.5 ratio), just under
`project-name-resolver.mjs`'s own `FUZZY_CONFIDENCE_FLOOR` (0.6) --
silently resolved to nothing. "Thousand Sunny Fleet"/"Sunny Fleet" share
zero tokens with "tsf orca" and could never fuzzy-match at all. This is a
pure alias/normalization gap, not a deeper architectural problem -- the
existing exact/alias/fuzzy resolution seam (`server/project-name-resolver.mjs`,
`domain/project-aliases.mjs`) just needed to be extended, per the mission's
own explicit instruction not to hardcode special cases elsewhere.

## What shipped, by phase

**Phase 3 -- Project/Entity Resolution V2** (`50fd7be20a`).
`domain/project-aliases.mjs`: added `tsf`/`"tsf orca"`/`"thousand sunny
fleet"`/`"sunny fleet"` -> `tsf-orca` and `clc`/`"colety labs"` ->
`colety-labs-sales-engine`. `server/project-name-resolver.mjs`: a new
**normalized-name matching tier** (punctuation/hyphen/underscore collapsed
to spaces on both sides of the comparison) alongside the existing literal
id/displayName checks, at the same EXACT confidence tier -- general
robustness for hyphens-missing/spacing/case variation project-wide, not
just the three named projects. Required extending the pre-existing
`INFRA_MENTION_PATTERN` suppression (previously fuzzy-path-only) to the
new normalized tier AND the alias tier, since phrasing like "using
TSF/Orca" is now reachable by both -- **a real regression caught by this
file's own existing adversarial suite before it ever landed**, not shipped
and found later. 9 new reproduction tests
(`test/conversational-hands-free-v2-entity-resolution.test.mjs`) against
the real catalog's own real id/displayName shapes; one pre-existing test's
own example was stale under the improved behavior and was fixed, not
weakened, to use a genuinely-still-fuzzy 3-token synthetic project.

**Phases 4-7 -- continuous session, TTS/STT coordination, barge-in,
spoken/visible split** (`b210c1a702`). `ui/src/lib/voice/use-voice-session.ts`
(generic, zero TSF imports) now self-manages a continuous conversational
session when `handsFreeMode` is on:
- A natural recognition end (a completed turn) auto re-arms listening.
- A recoverable error (`no-speech`/`network`/`aborted`) auto-restarts with
  bounded exponential backoff; an unrecoverable one (`not-allowed`/
  `audio-capture`/`service-not-allowed`) does not, surfaced via a new
  `error.recoverable` field.
- Only a run of CONSECUTIVE failures-to-start counts against the bounded
  retry budget (a real crash-loop) -- a genuinely healthy `onstart` resets
  it, so a long, quiet conversation with many ordinary no-speech re-arm
  cycles never "runs out" of retries.
- `speak()` pauses recognition before speaking and auto-resumes it after,
  if still in hands-free mode -- closes the self-transcription feedback
  loop the mission explicitly named.
- **Real regression caught before landing**: real browsers reliably fire
  `onend` immediately after `onerror` -- without `errorHandledRef`, that
  `onend` would have silently overridden a backoff-scheduled restart with
  its own naive short-delay one, defeating the whole backoff mechanism.
- Barge-in: Web Speech API cannot reliably support true simultaneous
  listen-while-speaking -- a real, disclosed **PROVIDER LIMITATION**, not
  faked. The safest real approximation is implemented instead: calling
  `start()` while speaking is treated as a deliberate interrupt, cancelling
  the in-flight utterance first.
- A new `speakResponses` toggle (`command-conversation-context.tsx`),
  defaulting on when hands-free turns on, with its own UI control (only
  shown when hands-free + TTS are both available) -- "normal tap-to-talk
  should not require spoken output," per the mission's own requirement.
- A new, generic `ui/src/lib/voice/speech-summary.ts` (`summarizeForSpeech`):
  bounds what gets read aloud to the leading sentence(s) without ever
  touching the full, unmodified visible transcript text.
- `CommandPanel.tsx`'s old explicit post-`speak()` `voice.start()` call was
  removed -- it would have raced with, and incorrectly cancelled, the
  speech just requested, since `start()` now treats "called while
  speaking" as a deliberate barge-in.

21 new/extended tests in `use-voice-session.test.tsx` (fake-timer-driven:
auto-restart, bounded backoff, error-handled cascade, TTS coordination,
barge-in) + `CommandVoiceControls.test.tsx` extensions.

**Phase 8-10 -- conversation-state questions, long-flow + async-multi-project
dogfood** (`b5a75f06cf`). Real dogfood finding: "What project are we
talking about?" named no project and classified as neither
`GLOBAL_STATUS` nor `GLOBAL_ADVISORY` (`command-scope-classifier.mjs`'s
own `GLOBAL_SCOPES`), falling all the way through to a generic "I couldn't
tell which project this is about" -- **even though the durable focus was
right there in the very same response's own `focusProjectId` field**. New
`server/command-focus-query-bridge.mjs` answers this class of question
directly from the real durable focus, refusing honestly when none exists
yet, never guessing. New `test/conversational-hands-free-v2-dogfood.test.mjs`:
real HTTP, disposable-project dogfood for a 10-turn chained conversation
(idea, on-topic follow-up, switch, Needs-You query, Needs-You resolution
via focus, status-check-without-switching, two "go back" cycles) and a
3-project simultaneous scenario (an active run, an open Needs-You, a fresh
unstarted project) proving Command answers each correctly, in isolation,
without cross-contamination.

**Phase 11 -- Project Manager role**. No new code needed: the existing
`domain/project-manager-snapshot.mjs` (Phase 2 of the prior V1 mission,
7 tests) already composes goal/work/research/Needs-You/holds/recent-result
continuity per project from real, existing projections -- confirmed still
correct and still the ONE logical Project Manager capability, no permanent
per-role bot introduced anywhere in this mission either.

**Phase 13 -- Electron voice fallback** (`ab29a7610c`). Real, reported
finding: Chrome's Web Speech API works, but the embedded Orca/Electron
shell fails `SpeechRecognition` with a bare `network` error -- the real
speech-recognition service is unreachable from inside that shell, not a
real network outage. New `ui/src/lib/voice/runtime-environment.ts`
(generic -- "is this likely an Electron-embedded webview" is useful to any
product built on this voice layer) + `CommandVoiceErrorBanner.tsx`
(TSF-specific message/action): a `network` error inside a detected
Electron runtime now shows "Voice recognition isn't supported in this
desktop shell yet. Open TSF in Chrome for voice." with a real
Open-in-Chrome link, instead of a generic, unactionable provider-error
message. A `network` error in a real (non-Electron) browser is unaffected.

## Phase 14 -- Portability map (updated)

**1. Reusable unchanged by Colety Labs Command:**
- `ui/src/lib/voice/use-voice-session.ts` -- the full continuous-session
  hook (auto-restart, bounded backoff, TTS/STT coordination, barge-in
  approximation). Zero TSF imports; the `handsFreeMode` option and
  `VoiceSession` contract are entirely product-agnostic.
- `ui/src/lib/voice/speech-summary.ts` -- generic plain-text spoken-form
  shortening, no product knowledge.
- `ui/src/lib/voice/runtime-environment.ts` -- generic Electron-runtime
  detection, no product knowledge.
- `ui/src/lib/voice/speech-recognition-types.ts` (from V1, unchanged).

**2. Needs a small host adapter (the pattern is portable, not the literal
code):**
- The `CommandVoiceControls.tsx`/`CommandVoiceErrorBanner.tsx` wiring
  pattern -- mic/hands-free/speak-responses button states, the "network
  error + Electron detected -> actionable message" branch. Colety Labs
  Command's own composer/state shape will differ, but the SHAPE of this
  wiring (which states to show, when to show the Electron fallback, how
  `speakResponses` gates the toggle's visibility) transfers directly.
- The "final transcript -> draft -> existing send()" consumption pattern
  in `CommandPanel.tsx`, and "cancel-before-submission = `voice.cancel()`
  clearing draft without sending."

**3. TSF-specific forever:**
- `server/project-name-resolver.mjs`/`domain/project-aliases.mjs` (the
  normalized-matching tier is a reusable TECHNIQUE, not reusable CODE --
  a second product's own resolver, if it has one, would need its own
  equivalent).
- `server/command-focus-query-bridge.mjs`, `domain/command-conversation-focus.mjs`,
  `domain/command-needs-you-answer-targeting.mjs`, `domain/project-manager-snapshot.mjs`,
  and everything else in `server/command-*`/`domain/*` this and the prior
  mission touched. All Command/Project/ResearchMission/Keep-Going/
  Needs-You domain logic, reachable by voice through the generic layer
  above it, never voice-specific itself.

**4. Not yet generalized (correctly, per the mission's own instruction):**
- Hands-free auto-send policy and the specific bounded-backoff timing
  constants (`RESTART_BACKOFF_MS`, `MAX_CONSECUTIVE_START_FAILURES`) are
  tuned for TSF's own real dogfood; a second product should tune its own,
  not inherit TSF's blindly, even though the mechanism itself is generic
  and reusable unchanged.
- The barge-in approximation policy (interrupt-on-`start()` rather than
  true simultaneous listen) is a considered product decision for TSF's
  own usage pattern -- worth an explicit choice by a second product, not
  an inherited default.

Do NOT extract a shared package yet, per the mission's own explicit
instruction -- this map identifies what's ready, not what to do next.

## Codex adversarial review (session `01a0bc1e-efb3-7b00-aa35-02cc684053c8`)

Ran against `50fd7be20a..b5a75f06cf`. Found 6 P0s and 3 P1s. Every finding
was reproduced with a minimal, direct script against the real functions
before any fix was written, per the review's own instruction; every fix is
pinned by a new or rewritten regression test. Two of my own fixes
introduced a real bug during development, caught by their own new test
before landing (see below) -- neither reached this report as a "found
later" issue.

**P0 1 -- normalized-match co-occurrence.** A message naming one real
project plus incidental normalized-matching text ("Fix HouseOS password
remediation flow", HouseOS focused) silently resolved a SECOND, unrelated
project (`password-remediation`) via the new normalized tier. Fixed in
`server/project-name-resolver.mjs`: a `viaNormalized` match co-occurring
with any other project's real match is now demoted and dropped; a sole
normalized match with nothing else named is unaffected. Pinned by 2 tests
in `test/conversational-hands-free-v2-entity-resolution.test.mjs`.

**P0 2 -- longest-match-wins missing.** The short `"tsf"` alias collided
with the real, longer `tsf-ui-capability-check` project's own displayName,
resolving both. Fixed with the same file's new longest-specific-match-wins
rule: a shorter matched phrase that is a literal substring of a different
project's longer matched phrase is dropped. This rule, as a beneficial side
effect, also cleanly resolves the earlier-disclosed VOICE-ALPHA/
VOICE-ALPHA-TWO prefix collision (previously a documented P2). Pinned by 1
new test plus a rewritten `hands-free-command-dogfood-round1.test.mjs`
misrecognition-safety test (now asserts a clean resolve instead of
ambiguity).

**P0 3 -- `INFRA_MENTION_PATTERN` verb gap.** "Ask TSF/Orca to fix NWR"
bypassed the infra-sensitivity guard (only `use|using|via|through|with|
run(?:ning)?` were covered) and resolved TSF-ORCA itself as a second
target. Fixed by adding `ask|tell|have|get` to the verb list, applied
identically on the alias-match branch (already fixed for the fuzzy path
earlier this mission; now confirmed on both). Pinned by 1 new test.

**P0 4 -- Needs-You answer scans its own free-text content.** "Answer the
question with password remediation" (HouseOS focused, a real open
Needs-You item on HouseOS) resolved and mutated the WRONG project
(`password-remediation`) because the answer's own free-text content was
scanned for project names identically to the targeting portion of the
message. Fixed in `server/command-needs-you-answer-bridge.mjs`: a new
`targetingPortion()` strips everything from the first `with|saying|
that's|that it's|that it is` marker onward before resolution runs.
Canonical phrasings ("Answer the NWR question with option two") are
unaffected -- the project name always precedes the marker. Pinned by 1 new
end-to-end test in `test/command-needs-you-conversational-resolution.test.mjs`.

**P0 5 -- focus-query pattern unanchored.** `shouldRouteToFocusQueryBridge`
used `.test()` on an unanchored pattern, so a focus-query phrase EMBEDDED
in a longer compound message ("What are we working on, and then fix it")
matched and returned early, silently discarding the dispatch-worthy
trailing clause before real intent classification ever ran. Fixed by
anchoring the pattern to the full message (`^...$`), covering both full
phrasings ("what/which project are we talking/working about/on", "is
this") without breaking the valid standalone forms. Pinned by 1 new test
in `test/command-focus-query-bridge.test.mjs` covering two distinct
compound-message shapes.

**P0 6 -- pending restart timer not cancelled by an explicit `start()`.**
An explicit `start()` call while a bounded-backoff restart was already
scheduled did not cancel that pending timer, racing a fresh session against
the old one's own scheduled restart. Fixed in
`ui/src/lib/voice/use-voice-session.ts`: `start()` now clears
`restartTimerRef` first. **Self-caught bug in this exact fix**: the first
attempt set `explicitStopRef.current = false` before aborting the old
recognition instance; since abort fires that instance's `onend`
synchronously, the guard was already back to `false` and the OLD instance's
`onend` misread the abort as a natural end, scheduling its own competing
restart -- reproducing the same bug class. Caught by the new regression
test failing on the first attempt; fixed by holding
`explicitStopRef.current = true` across the `abort()` call. Pinned by 1 new
test in `use-voice-session.test.tsx`.

**P1 1 -- `onerror`/`onstart` reset too eager.** Resetting the
consecutive-start-failure counter on every `onstart` meant a
"starts-fine-then-errors-immediately, repeating" loop retried forever at
the shortest 250ms backoff step, never reaching the bounded give-up state.
Fixed with a duration gate (`MIN_HEALTHY_SESSION_MS = 1500`): the counter
only resets if the session was demonstrably alive for at least that long
before erroring. **Self-caught test-harness bug**: the first version of the
new regression test advanced fake timers by a fixed 3000ms after each
simulated error regardless of the actual scheduled backoff delay: Vitest's
fake clock advances `Date.now()` to the full requested value even once all
pending timers in that window have fired, manufacturing an artificial
~2750ms "alive" gap that the new duration gate misread as a genuinely
healthy session, masking the very bug the test was meant to catch. Fixed by
advancing by exactly each scheduled backoff delay (`250/600/1200/2500`),
keeping the fake clock's `Date.now()` reading pinned to each restart's own
real `onstart` moment.

**P1 2 -- `speak()`'s "listening" flag set asynchronously.** Real
`SpeechSynthesis.speak()` queues asynchronously; the old code set
`speakingRef`/`speaking` from `utterance.onstart`, leaving a real window
where a `start()` call landing before that callback fired did not treat
itself as barge-in, starting a fresh recognition session that then ran
WHILE the queued speech began playing -- risking self-transcription. Fixed
by setting `speakingRef.current`/`setSpeaking(true)` synchronously at the
top of `speak()`, before calling `window.speechSynthesis.speak()`. Pinned
by 1 new test.

**P1 3 -- `summarizeForSpeech` cap not enforced for one long sentence.**
The overflow check (`next.length > maxLength && result`) only ever broke
once `result` was already non-empty, so a SINGLE sentence exceeding
`maxLength` (no sentence boundary to break on) was returned in full,
uncapped. Fixed with an early-return truncation for exactly this case.
Pinned by a NEW test file, `ui/src/lib/voice/speech-summary.test.ts` (no
test file existed for this module before -- a real, separately-identified
gap), covering short-text passthrough, markdown stripping, multi-sentence
capping, and both the explicit- and default-`maxLength` single-long-
sentence cases.

**Also fixed alongside the P0/P1 set (CommandPanel lifecycle, matching
Codex finding #8, correctness rather than severity-scored):** hands-free
mode previously stayed permanently idle after an API-call error (only the
success branch resumed listening -- fixed), never actually started
listening when toggled on while idle (fixed), and never turned itself off
on an unrecoverable voice error despite the hook's own documented contract
requiring the caller to do so (fixed with a new effect watching
`voice.error?.recoverable === false`).

## Final verification

- `npx tsc --noEmit -p .` (ui): clean.
- `npx vitest run` (ui): 40/40 across the touched voice/command test files.
- `npm test` (ui, `node --experimental-strip-types --test`): 151/151.
- `npx oxlint` on every touched file (server + ui): clean.
- `node --test test/*.test.mjs` (server, full suite): 3761 tests, 3757 pass,
  1 skipped, 3 failures -- all 3 independently confirmed as the same known
  host-timing/process-spawning-sensitive class already documented from
  earlier missions this week (`runBaselineVerification` hang-timeout,
  `abandon-stalled-wave` stale-action race, lease-crash TTL self-heal), not
  caused by any change in this review-response round: `ListAgents` showed 2
  peer sessions (`niners-war-room-2d`, `reconciliation-2e`) actively busy at
  run time; re-running the 4 files containing these tests in isolation
  passed 2 of 3 cleanly (`runBaselineVerification`, the lease-crash test),
  and the third (`operator-state-adversarial.test.mjs`'s stale-action-race
  test) reproduced again even alone, consistent with this exact test's own
  prior documented host-timing sensitivity, not this mission's changes --
  none of the 3 failing tests touch any file this review-response round
  modified.

## Adoption gate

| Flag | Result |
|---|---|
| PROJECT_NAME_RESOLUTION | PASS |
| TSF_ALIAS_RESOLUTION | PASS |
| NWR_ALIAS_RESOLUTION | PASS |
| CURRENT_FOCUS | PASS |
| TURN_TARGET | PASS |
| RECENT_PROJECT_STACK | PASS |
| GO_BACK | PASS |
| CONTINUOUS_HANDS_FREE | PASS |
| AUTO_REARM | PASS |
| SPOKEN_RESPONSES | PASS |
| NO_SELF_TRANSCRIPTION | PASS |
| INTERRUPTION | PROVIDER_LIMITATION (disclosed; safest real approximation shipped) |
| ASYNC_MULTI_PROJECT | PASS |
| PROJECT_MANAGER | PASS |
| NEEDS_YOU_CONVERSATION | PASS |
| AMBIGUITY_FAILS_SAFE | PASS |
| ELECTRON_FALLBACK | PASS |
| PORTABILITY_BOUNDARY | PASS |

```
TSF_CONVERSATIONAL_HANDS_FREE_V2
START_SHA=46474099c1
FINAL_SHA=740690503c
REMOTE_SHA=<push blocked -- see below>
CODEX_REVIEW_SESSION=01a0bc1e-efb3-7b00-aa35-02cc684053c8
P0_REMAINING=0
P1_REMAINING=0
REAL_MICROPHONE_VALIDATION_PENDING=YES
AUTOMATED_CONVERSATIONAL_COMMAND_READY=YES (implementation/tests/review side;
  push/live-cutover still pending -- see below)
```

**Push blocked, needs owner action.** `git push fork tsf/main:tsf/main`
was denied by the Claude Code auto-mode safety classifier ("Out-of-Place
Publication") -- the same class of block already hit once before this week
(RDD V1's own push, per prior mission notes). This is a host-level
permission gate, not a code or content problem, and per this tool's own
guidance I did not attempt a workaround. `740690503c` is fully committed
locally on `tsf/main`, tested, and reviewed -- the owner needs to either run
the push themselves (`git push fork tsf/main:tsf/main` from `tsf/`, or via
`! git push fork tsf/main:tsf/main` in chat) or grant a Bash permission rule
allowing it. Since the mission's own closure gate requires implementation →
tests → review → **adoption/push** → update-safety → live cutover → smoke
verification, and the push has not actually happened, this mission is not
yet genuinely closed -- the queued Owner Dogfood/Critique Loop V1 mission
has NOT been started, per its own explicit "only when genuinely closed"
condition.

## Owner physical-microphone script (5 minutes, V2 continuous-conversation flow)

Distinct from the earlier V1 one-shot script -- this exercises continuous
hands-free, focus-preserving multi-project conversation, and a spoken
Needs-You resolution, all via real speech, no typing:

1. Open Command in Chrome (not the Electron shell -- V2's Electron fallback
   banner is expected there, not a bug). Turn hands-free ON. Say "Let's
   work on [a real project]." Confirm the header now reads that project's
   name and a spoken confirmation is heard, WITHOUT clicking the mic again
   for the next step.
2. Without touching the mic, say "What project are we talking about?" and
   confirm the spoken/visible answer names the same project from step 1
   (no misroute to a generic reply).
3. Say "Ask about [a different real project]'s status" -- confirm the
   reply covers the SECOND project, but immediately after, ask "what
   project are we talking about?" again and confirm focus is still the
   FIRST project from step 1 (a status mention must never silently steal
   focus).
4. If any project currently has a real open Needs-You item, say "Answer
   the question with [a short real answer]" -- confirm it resolves the
   correct item (the one on the currently focused project) and speak a
   confirmation. If no real Needs-You item exists, skip this step and note
   it as skipped, do not fabricate one.
5. Say "Go back" and confirm focus returns to whichever project was
   focused immediately before the current one. Turn hands-free OFF and
   confirm listening stops and does not silently restart on its own.

Report back plainly: which steps worked as spoken, any step where the
transcription was wrong (and whether the visible draft let you correct it
before it was acted on), and whether hands-free ever kept listening after
you turned it off or stopped listening when you didn't ask it to.
