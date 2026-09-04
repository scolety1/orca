# BUG-07 Orca-core follow-up: OS notifications never see `displayName`

Status: proposal, not implemented. Written for a future engineer (Claude, Codex,
or human) with this repo checked out but none of this session's context. Every
file:line citation below was re-verified directly against the Orca-core source
in this worktree at the time of writing (not copied from an earlier draft
without checking) — re-verify again before you rely on them, since Orca-core
moves independently of `tsf/`.

Scope note: this document only proposes changes to Orca-core (`src/main`,
`src/renderer`, `src/shared`). No file outside `tsf/` was modified to produce
it. TSF's own worktree (this one) must never write to Orca-core directly —
see `tsf/programs/tsf-operator-stabilization-v1/HQ.md`'s boundary rule.

## Problem statement — the operator's real complaint

From `tsf/programs/tsf-operator-stabilization-v1/bug-ledger.json`, `BUG-07`:

> "Orca/Windows notifications expose raw internal run IDs and are noisy"

Concretely: when TSF dispatches a worker via `orchestration task-create`, the
resulting OS notification's title and body fall back to generic, low-signal
text — a worktree/repo label, a static agent-type word ("Claude"/"Codex"), and
the *terminal pane's own* emitted title (idle/working status text, or the
bare agent-type/pane-key) — never the human-readable task label TSF supplies
on every dispatch. An operator juggling several concurrent worker panes gets
notifications that look identical or reduce to an opaque internal identifier,
and cannot tell which task just finished without switching to the app.

TSF has already fixed its own half of this (see the BUG-07 ledger entry):
`keep-going-dispatch-loop.mjs` now always passes a real, non-fabricated
`displayName` (`${projectId}: ${scope files}`) on every
`orchestration task-create` call. That fix is verified and landed. This
document is the residual Orca-core half.

## Task 1 finding (prerequisite for this document): no additional TSF-side lever exists

Before writing this proposal, this session re-investigated whether TSF (or
the Orca CLI it drives) has *any* real, already-working path by which a
dispatch's `displayName` reaches what notifications call `terminalTitle` —
e.g. via the `tabAutoGenerateTitle` setting, which genuinely does write
`displayName` into the terminal tab's own committed title.

**Finding: no, there is no such path.** Confirmed structurally, with
file:line citations, not empirically:

- `tabAutoGenerateTitle`'s effect (`src/renderer/src/store/slices/agent-status.ts:2337-2381`)
  writes into the **store's tab title** (`applyGeneratedTabTitleUpdate` →
  `terminals.ts`), which is a UI label shown in the tab strip and sidebar.
- The **notification** pipeline's `terminalTitle` field never reads that
  store tab title. It is populated entirely by
  `AgentCompletionCoordinator`'s own internally tracked title, which is one
  of exactly two things, neither of which is `displayName`-derived:
  - **Hook-driven completions** (what fires for TSF's dispatches, since TSF
    reports real hook state): `title = payload.agentType ?? options.paneKey`
    — a bare agent-type word or the raw pane key.
    (`src/renderer/src/components/terminal-pane/agent-completion-coordinator.ts:865`,
    also `:834,855`.)
  - **Title-driven completions**: `title` is the raw OSC/xterm title text the
    agent CLI itself emitted to the PTY (`decision.rawTitle`, passed via
    `onAgentBecameIdle`/`onTitleChange` in
    `src/renderer/src/components/terminal-pane/pty-connection.ts:2792-2854,3311-3350`
    into `agentCompletionCoordinator.observeTitle`/`observeClassifiedTitleCompletion`,
    `agent-completion-coordinator.ts:710-779`).
- Both title values flow **unmodified** into the notification dispatch call:
  `src/renderer/src/hooks/agent-hook-completion-notifications.ts:241-266`
  (`dispatchCompletion: (title, meta) => dispatchTerminalNotification(worktreeId, { ..., terminalTitle: title, ... })`)
  and the parked-pane equivalent
  (`src/renderer/src/components/terminal-pane/parked-terminal-byte-watcher.ts:166-173`,
  `src/renderer/src/components/terminal-pane/pty-connection.ts:3252-3259`).
- `dispatchTerminalNotification` passes it straight through to the main
  process: `src/renderer/src/components/terminal-pane/use-notification-dispatch.ts:226`
  (`terminalTitle: event.terminalTitle`).
- `AgentStatusEntry.terminalTitle` (a *different*, similarly-named field
  stamped via `setAgentStatus`'s `terminalTitle` argument,
  `src/shared/agent-status-types.ts:117`) is also always the raw PTY/process
  title, never the generated tab title — confirmed by tracing its callers
  in `src/renderer/src/components/terminal-pane/pty-connection.ts:2856-2882,3700-3704`.
  It is easy to confuse this field with the tab's generated title because
  they share a name; they are not the same value.
- The one place the store's generated `tab.title` is read anywhere near the
  notification code path is
  `src/renderer/src/components/terminal-pane/TerminalPane.tsx:571`
  (`terminalTitle: hasSingleKnownLeaf ? terminalTab?.title : null`) — but
  that value feeds `resolveNativeChatLeafTitleAgent`, which resolves which
  agent owns a title for GPU-rendering/display-decision purposes. It is
  never passed into `dispatchTerminalNotification`.

So enabling `tabAutoGenerateTitle` today changes the tab strip and sidebar
text, but has **zero** effect on OS notification content. There is no
setting, flag, or existing code path an operator or TSF can lean on. This
confirms the BUG-07 ledger's own prior conclusion and the residual gap is
real and Orca-core-only, which is why the rest of this document proposes an
Orca-core change rather than another TSF-side workaround.

## Root cause, re-verified

1. **The wire type has no field for it.** `NotificationDispatchRequest`
   (`src/shared/types.ts:3231-3251`) carries `worktreeLabel`, `repoLabel`,
   `terminalTitle`, and a flat `agent*` snapshot (`agentType`, `agentState`,
   `agentPrompt`, `agentToolName`, `agentToolInput`,
   `agentLastAssistantMessage`, `agentInterrupted`) — no `displayName`, no
   `taskTitle`, no `orchestration` object of any kind.

2. **The construction site drops orchestration context even though it has
   access to it.** `dispatchTerminalNotification`
   (`src/renderer/src/components/terminal-pane/use-notification-dispatch.ts:71-245`)
   reads `storedAgentStatus = state.agentStatusByPaneKey[event.paneKey]`
   (line 83-86) — this **is** the full `AgentStatusEntry`, which **does**
   carry `.orchestration` (`src/shared/agent-status-types.ts:138-140`,
   type `AgentStatusOrchestrationContext` at `:63-74` with `taskId`,
   `taskTitle`, `displayName`). But the `agentSnapshot` object actually sent
   over IPC (lines 194-204) is built by hand-picking seven flat fields off
   `agentStatus` and never includes `.orchestration`. `agentStatus` itself
   can also resolve to `eventAgentStatusSnapshot`
   (`event.agentStatusSnapshot`, typed `AgentCompletionStatusSnapshot` =
   `ParsedAgentStatusPayload & { stateStartedAt? }`,
   `src/renderer/src/components/terminal-pane/agent-completion-coordinator-types.ts:6`) —
   and `ParsedAgentStatusPayload`/`AgentStatusPayload`
   (`src/shared/agent-status-types.ts:170-196`) has **no** `orchestration`
   field at all. **This is the important nuance for the fix below: only
   `storedAgentStatus` (the full store entry), never `agentStatus`/
   `eventAgentStatusSnapshot`, can supply orchestration labels.**

3. **The rendering site never had a field to prefer.** `notification-options.ts`
   builds the title purely from `worktreeContext` + a static agent-type
   label (`src/main/ipc/notification-options.ts:67-70`,
   `buildAgentTaskCompleteNotificationOptions`) and the body fallback uses
   only `args.terminalTitle` (`:137-141`,
   `buildAgentTaskCompleteFallbackBody`).

4. **The existing precedent for doing this correctly already exists** for
   the terminal tab title / sidebar row text:
   `src/renderer/src/lib/agent-row-primary-text.ts:48-66`
   (`getAgentRowPrimaryText`) reads
   `entry.orchestration?.displayName?.trim() || entry.orchestration?.taskTitle?.trim() || <prompt preview>`
   gated by `orchestrationLabelsMatchLiveDispatch` (same file, `:31-46`).
   The proposal below is: do the same read, behind the same gate, at the
   notification construction site.

## Proposed change

### 1. `src/shared/types.ts` — additive optional fields on `NotificationDispatchRequest`

```ts
export type NotificationDispatchRequest = {
  source: NotificationEventSource
  notificationId?: string
  requireDisplayConfirmation?: boolean
  worktreeId?: string
  paneKey?: string
  repoLabel?: string
  worktreeLabel?: string
  hasMultipleActiveRepos?: boolean
  terminalTitle?: string
  isActiveWorktree?: boolean
  agentType?: AgentType
  agentState?: AgentStatusState
  agentPrompt?: string
  agentToolName?: string
  agentToolInput?: string
  agentLastAssistantMessage?: string
  agentInterrupted?: boolean
  /** Orchestration dispatch label (e.g. TSF's task displayName), gated by
   *  orchestrationLabelsMatchLiveDispatch at the construction site so a
   *  stale/mismatched sticky label can never mislabel an unrelated
   *  notification. Prefer this over terminalTitle/agentType when present. */
  displayName?: string
  /** Fallback orchestration label when displayName is absent. Same gate. */
  taskTitle?: string
}
```

### 2. `src/renderer/src/components/terminal-pane/use-notification-dispatch.ts` — construction site

Import the existing gate and read it off `storedAgentStatus` (the full
entry — see root cause #2 above for why it must be this variable and not
`agentStatus`):

```ts
import { orchestrationLabelsMatchLiveDispatch } from '@/lib/agent-row-primary-text'

// ... inside dispatchTerminalNotification, after storedAgentStatus is defined (~line 86):
const orchestrationLabels =
  event.source === 'agent-task-complete' &&
  storedAgentStatus &&
  orchestrationLabelsMatchLiveDispatch(storedAgentStatus)
    ? {
        ...(storedAgentStatus.orchestration?.displayName?.trim()
          ? { displayName: storedAgentStatus.orchestration.displayName.trim() }
          : {}),
        ...(storedAgentStatus.orchestration?.taskTitle?.trim()
          ? { taskTitle: storedAgentStatus.orchestration.taskTitle.trim() }
          : {})
      }
    : {}
```

Then splice it into the existing `.dispatch({...})` call (~line 217-229),
alongside `...agentSnapshot`:

```ts
void window.api.notifications
  .dispatch({
    source: event.source,
    ...(notificationId ? { notificationId } : {}),
    worktreeId,
    paneKey: event.paneKey,
    repoLabel: repo?.displayName,
    worktreeLabel: worktree?.displayName || worktree?.branch || worktreeId,
    hasMultipleActiveRepos: countReposNeedingNotificationDisambiguation(state) > 1,
    terminalTitle: event.terminalTitle,
    isActiveWorktree: state.activeWorktreeId === worktreeId,
    ...agentSnapshot,
    ...orchestrationLabels
  })
```

Note: `orchestrationLabelsMatchLiveDispatch` requires `entry.prompt` — this
is a required `string` on `AgentStatusEntry`
(`src/shared/agent-status-types.ts:96`), so `storedAgentStatus` satisfies
the `Pick<AgentStatusEntry, 'orchestration' | 'prompt'>` parameter type
directly with no coercion needed.

The parked-pane path
(`src/renderer/src/components/terminal-pane/parked-terminal-byte-watcher.ts:166-173`)
dispatches through this same `dispatchTerminalNotification` function, so it
needs no separate change. The inline coordinator instance in
`pty-connection.ts` (`deps.dispatchNotification` at `:3252-3259`) also
routes through the same `useNotificationDispatch`/`dispatchTerminalNotification`
call — verify this is still true at implementation time in case the coordinator
wiring has been refactored since this document was written.

### 3. `src/main/ipc/notification-options.ts` — rendering site

Prefer the new fields in the title, and in the fallback body, preserving
today's exact output whenever they're absent (pure additive branch):

```ts
function buildAgentTaskCompleteNotificationOptions(
  args: NotificationDispatchRequest
): { title: string; body: string } | null {
  if (!hasAgentNotificationSnapshot(args)) {
    return null
  }

  const agentLabel = formatNotificationAgentLabel(args.agentType)
  const orchestrationLabel = normalizeNotificationText(
    args.displayName ?? args.taskTitle,
    NOTIFICATION_TITLE_CONTEXT_MAX_LENGTH
  )
  const worktreeContext = formatNotificationWorktreeContext(args)
  const statusText =
    args.agentState === 'blocked' || args.agentState === 'waiting'
      ? 'needs input'
      : args.agentState === 'done' && args.agentInterrupted
        ? 'stopped'
        : 'finished'

  return {
    title: orchestrationLabel
      ? `${orchestrationLabel} - ${statusText}`
      : `${worktreeContext} - ${agentLabel} ${statusText}`,
    body: buildAgentTaskCompleteRichBody(args) ?? `${agentLabel} ${statusText}.`
  }
}
```

`buildAgentTaskCompleteRichBody` already prefers a real assistant-message
preview over everything else, so it does not need to change — the
`displayName`/`taskTitle` win is entirely in the title (today's biggest
"which pane was this?" complaint) and in the fallback body when there is no
rich snapshot:

```ts
function buildAgentTaskCompleteFallbackBody(args: NotificationDispatchRequest): string {
  const label =
    normalizeNotificationText(args.displayName ?? args.taskTitle, NOTIFICATION_TITLE_CONTEXT_MAX_LENGTH) ||
    args.terminalTitle
  return args.repoLabel
    ? `${args.repoLabel}${label ? ` · ${label}` : ''}`
    : (label ?? 'A coding agent finished working.')
}
```

Decide the exact copy/format (`"<label> - finished"` vs. something else) with
product/UX sign-off before implementing — see migration risk below.

## Gating logic that must be reused (non-negotiable)

`orchestrationLabelsMatchLiveDispatch`
(`src/renderer/src/lib/agent-row-primary-text.ts:31-46`) is the single
existing function that decides whether an `AgentStatusEntry.orchestration`
context still describes the *live* dispatch turn, vs. sticky metadata left
over from an earlier turn on a reused pane (orchestration context is
intentionally sticky for ~30 minutes per the comment at
`src/renderer/src/store/slices/agent-status.ts:2339`). It is already reused
verbatim by `src/renderer/src/lib/activity-thread-display.ts:74` for exactly
this kind of "is this label still valid for the current turn" decision. The
new notification code path must call this exact function (imported, not
reimplemented) before ever reading `.orchestration.displayName`/`.taskTitle`
— skipping it is precisely how a stale/mismatched orchestration label could
mislabel an unrelated notification (e.g. after a pane is reused for a new,
different dispatch before the sticky window expires).

## Test plan

**`notification-options.ts` currently has no dedicated test file at all** —
confirmed by search; `src/main/ipc/notifications.test.ts` exists but does not
exercise `buildNotificationOptions`/`buildAgentTaskCompleteNotificationOptions`.
This change should add `src/main/ipc/notification-options.test.ts` (new
file), a plain vitest unit-test file matching the style of sibling files in
`src/main/ipc/*.test.ts` (e.g. `src/main/ipc/notifications.test.ts` for
import/describe conventions) since these are pure functions needing no
Electron mocking. Cases:

- `displayName` present → title is `"<displayName> - <statusText>"`, not the
  worktree/agent-label title.
- `displayName` absent, `taskTitle` present → title uses `taskTitle`.
- Both absent → **byte-identical** title/body to today's output (the
  regression guard that proves this change is additive).
- `displayName`/`taskTitle` present but overlong/whitespace-heavy → confirm
  `normalizeNotificationText` truncation/normalization still applies (same
  as `worktreeLabel`/`repoLabel` today).
- Fallback body (`hasAgentNotificationSnapshot` false) prefers
  `displayName`/`taskTitle` over `terminalTitle` when present.

Extend the existing
`src/renderer/src/components/terminal-pane/use-notification-dispatch.test.ts`
(uses `vi.mock('@/store', ...)` + a `mockState`/`makeAgentStatus` harness
already wired for `agentStatusByPaneKey` — reuse it, don't build a new
harness) with:

- A live dispatch whose stored `AgentStatusEntry.orchestration` matches the
  live prompt (`orchestrationLabelsMatchLiveDispatch` true) → the constructed
  `NotificationDispatchRequest` (inspect via the existing
  `getLastNotificationDispatchArg()` helper, `:89-` in that file) carries
  `displayName`.
- A **stale** orchestration context (`taskId` present but mismatched against
  a live dispatch prompt naming a different task id) → `displayName`/
  `taskTitle` must be **absent** from the dispatched request — this is the
  regression test that proves the gate is actually wired in, not just
  imported.
- No `orchestration` on the stored entry at all (e.g. a non-orchestrated,
  directly-launched agent) → request is unchanged from today (no new keys
  present), matching current behavior for the common case.

`orchestrationLabelsMatchLiveDispatch` itself is unchanged by this proposal
and already has coverage in
`src/renderer/src/lib/agent-row-primary-text.test.ts` — no new tests needed
there, just confirm (at implementation time) that the existing suite still
covers the taskId-mismatch case this proposal now also depends on
transitively.

## Migration risk: LOW

- `NotificationDispatchRequest` is used in exactly five files (verified by
  repo-wide search at the time of writing): `src/shared/types.ts` (the type
  itself), `src/main/ipc/notifications.ts` and
  `src/main/ipc/notification-options.ts` (consumers), `src/preload/api-types.ts`
  (the `window.api.notifications.dispatch` bridge signature), and
  `src/renderer/src/components/settings/NotificationsPane.test.tsx`. All of
  these are **local Electron `ipcMain.handle('notifications:dispatch', ...)`
  main↔renderer IPC** (`src/main/ipc/notifications.ts:390-391`) within a
  single desktop process/build — not part of the remote client↔host RPC
  protocol (`runtime-rpc.ts`/`terminal-stream-protocol.ts`) that
  `docs/reference/remote-wire-compatibility.md` governs. Main and renderer
  always ship from the same Electron build, so there is no actual
  version-skew scenario for this type the way there is for the remote
  runtime protocol — but even under that document's own Rule 1 ("a new
  optional JSON field on an existing frame is safe"), this change is exactly
  the safe case: two brand-new optional fields that every existing reader
  simply does not look at.
- The change is purely additive on both ends: nothing is removed, renamed,
  or made required, and the fallback path (fields absent) is required by
  the test plan above to be byte-identical to today's output.
- The only real risk is **product/copy bikeshedding** — the exact notification
  title format (`"<label> - finished"` vs. alternatives) is a UX decision
  that should get sign-off before landing, not an engineering compatibility
  risk.

## Why TSF-side remediation alone cannot close this

Per Task 1 above: TSF has already supplied a real, correct, non-fabricated
`displayName` on every dispatch it makes (`keep-going-dispatch-loop.mjs`,
already landed and verified in the BUG-07 ledger entry), and there is no
existing Orca-core setting, flag, or code path — gated or otherwise — that
ever reads it into the OS-notification pipeline. The receiving type
(`NotificationDispatchRequest`) structurally has no field to carry the value
through, and the construction site that has access to the right data
(`storedAgentStatus.orchestration`) currently discards it when building the
IPC payload. Only an Orca-core change to the type contract and its two
construction/rendering sites (above) can close this gap; no amount of
further TSF-side dispatch-argument tuning changes what Orca-core's
notification pipeline reads.
