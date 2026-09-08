# Orca-core Notification Bridge — Requirement Packet (bounded, not implemented here)

Produced by TSF's Operator Polish + Tech Debt Closeout V1, Phase 3. This
is a requirement/mission packet for future Orca-core product work, not a
spec TSF is implementing. TSF's own worktree must never write to
Orca-core directly (`src/` outside `tsf/`) — this doc stays entirely
inside TSF's boundary (`tsf/docs/tsf/`).

## Why this exists

The Operator Attention V1 program (prior mission) classified true
proactive delivery while Orca is closed/backgrounded as
`DELIVERY_CHANNEL_EXTERNAL_GATE`. Before accepting that permanently, this
phase ran a fresh, read-only, exhaustive investigation of Orca-core's
existing notification/delivery primitives (`src/main/`, `src/renderer/`,
`src/preload/`) across 9 categories. Full findings live in the dispatch
transcript for this phase; verdicts only, below.

## Verdicts (read-only investigation, this mission)

| Area | Verdict |
|---|---|
| Desktop/OS notifications (`notifications:dispatch`) | `PARTIAL_PRIMITIVE_EXISTS` |
| System tray (`setTrayAttention`) | `PARTIAL_PRIMITIVE_EXISTS` |
| In-app notification list/center | `ORCA_CORE_GAP` |
| Task/mission completion notifications (`AgentCompletionCoordinator`) | `PARTIAL_PRIMITIVE_EXISTS` |
| Background mission notifications (distinct from above) | `ORCA_CORE_GAP` |
| "Remote Control" notifications | `NOT_APPLICABLE_FOR_TSF` (no feature under that name; real mechanism is mobile pairing/relay, assessed next row) |
| Mobile/push hooks (`dispatchMobileNotification`) | `PARTIAL_PRIMITIVE_EXISTS` |
| Webhook/generic event delivery | `ORCA_CORE_GAP` |
| **TSF server process ↔ Orca-core bridge** (the load-bearing question) | `ORCA_CORE_GAP` |

## The load-bearing finding

Every real, well-built delivery primitive that exists
(`notifications:dispatch`, `setTrayAttention`,
`OrcaRuntimeService.dispatchMobileNotification`) is either a **renderer-
only IPC call** (reachable only via `window.api.notifications.dispatch`
from JS running inside Orca's own renderer process) or a **plain
main-process method** with no network/IPC surface an external process can
reach. TSF's server (`tsf/server/http-server.mjs`) runs as a separate OS
process, launched independently of Electron — it has no `ipcRenderer`/
`ipcMain` in scope.

The one HTTP server in Orca-core actually reachable from another OS
process, `AgentHookServer` (`src/main/agent-hooks/server.ts`), is
deliberately narrow: per-launch random-token auth, and its only accepted
payload shape is a real agent-CLI hook event (`hookEventName`, `paneKey`,
...) for a PTY pane Orca itself spawned, run through a state machine
(`orchestrationLabelsMatchLiveDispatch` and friends) specifically built to
reject unattributed/spoofed evidence. TSF using this endpoint to fake a
"notify me" call would mean spoofing an internal protocol against
machinery designed to catch exactly that — not reuse of a public
primitive, and against the spirit of TSF's own "never write to Orca-core"
boundary even where not against its letter.

**Conclusion: no safe integration point exists today.** This is
genuinely new Orca-core product work, not something TSF can adapt around
from its own side. Per this mission's own instruction, TSF will not build
a parallel notification system to work around this gap.

## Bounded ask, for Orca-core's own product owner to scope (not TSF's to build)

1. **A new, narrow, authenticated local endpoint in `src/main`** —
   separate from `AgentHookServer`, its own token/scope, NOT reusing the
   hook-payload protocol. Minimal accepted payload: `{ title, body,
   worktreeId?, taskIdentifier?, clickTarget? }`. Internally calls the
   EXISTING `buildNotificationOptions`/`Notification`/`setTrayAttention`/
   `dispatchMobileNotification` machinery already in `notifications.ts` —
   no new delivery mechanism, just a new authorized entry point into the
   one that already exists.
2. **An identity/authorization decision** for what a background
   subsystem like TSF presents to that endpoint — e.g. a static
   per-install token discoverable the same way
   `agent-hooks/endpoint.env` already is, or something else Orca-core-
   issued specifically for this purpose. This is a real security decision
   Orca-core's own owner should make, not TSF.
3. **Orthogonal, already independently scoped**: the pre-existing,
   disclosed `displayName`/`taskTitle` wire-field gap
   (`tsf/docs/reference/bug-07-orca-core-notification-followup.md`,
   status "proposal, not implemented") — once a bridge like (1) exists,
   this is what lets the notification it produces carry a real human-
   readable mission label instead of a raw pane id.

None of (1)-(3) is safe or appropriate for TSF to build unilaterally — a
new authenticated entry point into Electron's main process is Orca-core
surface area by definition. This packet documents the bounded ask; actual
scoping, security review, and implementation are Orca-core's own future
work, not this mission's.

## What TSF already owns and is not blocked

Per the Operator Attention V1 program's own `EVENT_GENERATION_GREEN`
verdict: durable, deduped, restart-safe notification-event generation,
plus two real delivery mechanisms TSF owns end-to-end today (chat-
attached notice on Tim's next message; the in-app polling-driven global
indicator). Neither requires this bridge. Only true OS-level push while
Orca is closed/backgrounded remains gated on the above.
