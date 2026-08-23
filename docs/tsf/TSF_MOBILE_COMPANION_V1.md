# TSF Mobile Companion V1 -- Future Project Spec

Status: **PROPOSED, NOT STARTED.** Recorded per Tim's explicit instruction
in the TSF V1 Operator UX + Multi-Project Control pass ("Create a durable
future project/spec... Do not implement mobile during this pass... Do not
start implementation without Tim's future approval."). No code exists for
this yet. This document exists so the idea survives context compaction and
future sessions, not as authorization to build it.

## Goal

Monitor and control the desktop TSF fleet from a phone while execution
stays on Tim's computer. TSF's actual work -- Orca, worktrees, provider
CLIs, the live planner -- has no reason to run anywhere but the desktop;
a phone only needs a thin, read-mostly window onto real desktop state plus
a small number of genuinely mobile-appropriate actions.

## Relationship to the desktop Operator UX pass

This spec exists because the desktop pass (waves 23-25 of this program)
established the real data model and real endpoints a mobile companion
would consume unchanged: Portfolio/Work summaries, Capacity, Health
Repair, Fleet scheduling, Planner Chat, and the lifecycle/self-explaining
project-card fields. Mobile V1 should be a new, thin client over that
same API -- not a redesign of it, and not a second implementation of any
of it.

## Architecture direction

**Responsive/PWA companion first.** The existing TSF operator API
(`server/http-server.mjs` and its route modules) already speaks plain
JSON over HTTP; the existing UI is already a normal React/Vite app, not
an Electron-only surface. A phone-optimized responsive web view (or a
installable PWA wrapper around one) reaches a phone with the least new
surface area: no app-store review cycle, no native build pipeline, no
new deployment story. It requires the desktop TSF server to be reachable
from the phone's network -- likely via Orca's existing pairing/remote
mechanisms (the same ones this program's own AGENTS.md SSH/remote
guidance already assumes for every other TSF surface), not a new tunnel
TSF invents for itself.

**Native wrapper later only if real use justifies it.** Push
notifications reliable enough to matter (a candidate is ready, a run
needs Tim) are the one capability a plain PWA gets least reliably across
phone platforms today. If real day-to-day mobile use shows that gap
actually matters, a thin native wrapper (Capacitor-style, not a rewrite)
around the same PWA is the natural next step -- not before there is real
evidence it's needed.

## Candidate V1 scope

Read-first, act-narrow. Every item below reuses a real, already-adopted
desktop capability; none of them invent new TSF logic.

- **Home dashboard.** The same "what needs my attention" view as the
  desktop Home page (waves 23-25): Needs You / Working / Ready for
  Adoption counts, Project Health summary. Reuses `GET /api/portfolio`
  and `GET /api/work` unchanged.
- **Work/Fleet status.** A condensed version of the desktop Work page
  (Active/Blocked/Ready for Adoption/Recently Completed) and Fleet
  page's own scheduling explanation. Reuses the same endpoints.
- **Provider capacity.** The same real M5 signal the desktop Capacity
  indicator shows (`GET /api/capacity`) -- remaining %, reset timing, or
  an honest Unknown. No separate mobile capacity computation.
- **Planner Chat.** The existing per-project chat (`POST /api/chat`),
  the same wave-21-fixed transport, on a phone-sized single-column
  layout. This is likely the single highest-value mobile surface: asking
  "what's going on with this project" from a phone is a genuinely mobile
  use case in a way that reviewing a diff is not.
- **Needs You.** A focused feed of exactly the projects/decisions
  needing Tim (blocked reasons, candidates ready for adoption) -- the
  same data Home already computes, presented as the mobile-primary view
  rather than one section among several.
- **Project Health.** Read-only view of a project's Health findings and
  repair class (`GET /api/health-repair/scan`, per-project Health on
  `GET /api/projects/:id`). Health *repair actions* are explicitly out
  of V1 scope (see below) -- Health is something to review on a phone,
  not something to remediate from one.
- **Flight Recorder summaries.** The existing condensed Flight Recorder
  view (`GET /api/projects/:id/flight-recorder`), not the full desktop
  drill-down.
- **Start/Pause/Resume Keep Going where authority permits.** Reuses the
  existing `POST /api/keep-going/:id/{start,pause,resume}` routes and
  their existing gating unchanged -- a phone gets no authority a desktop
  session wouldn't also have for the same request. This is a genuinely
  mobile-appropriate action (pausing a run from a phone when something
  looks wrong is a real use case); *starting* a brand-new mission from a
  phone is lower-value and likely belongs later, if at all, given how
  much real context (goal, acceptance criteria) that needs.
- **Approve / reject / request revision.** Reuses the existing
  `POST /api/candidates/:id/decision` route unchanged -- the one action
  class a phone is plausibly *better* suited to than a desktop (a quick
  yes/no away from the keyboard), and already fully governed server-side.
- **Estimates/calendar.** Read-only view of `GET /api/projects/:id/estimate`
  and the client-facing estimate fields -- useful for a quick "when will
  this be done" check, not for regenerating an estimate.
- **Notifications.** Push (or, for the PWA-first cut, in-app polling) for
  the same real events Home already surfaces as "needs you" -- a new
  blocker, a candidate ready for adoption, a run stopping for a
  consequential decision. No new event source; this only need decide
  when to alert on facts the API already returns.

## Explicitly out of initial scope

- **Full coding terminal.** No xterm-on-a-phone. If a user needs a real
  terminal, they need a desktop (or SSH from a laptop) -- a phone-sized
  terminal emulator is a worse tool for that job, not a smaller one.
- **Direct local repo editing from phone.** No file browser, no diff
  editor, no commit-from-phone. Consistent with "act-narrow" above: a
  phone reviews and decides, it doesn't implement.
- **Duplicating Orca runtime on mobile.** No local execution, no local
  worktrees, no local provider CLI on the phone. The phone is a client
  of the desktop's real Orca runtime, never a second runtime.

## Explicit non-goals for V1, worth naming plainly

- Not a general-purpose remote-desktop app -- no screen mirroring, no
  input passthrough to the desktop.
- Not a notification firehose -- alerts should be as rare and as
  meaningful as the desktop's own "Needs You" bar, not a copy of every
  log line.
- Not a second product with its own roadmap -- this stays a thin client
  over the existing TSF operator API for as long as that's sufficient.

## Research recommendation for whoever picks this up

Before writing code: confirm exactly how a phone is meant to reach the
desktop TSF server on Tim's actual network (Orca's existing
pairing-code/remote-environment mechanism is the leading candidate --
verify it, don't assume it, and don't build a second one). Confirm
whether the existing `tsf/ui` React app's component tree can be
responsively adapted in place (a `sm:`/mobile-first pass over the same
components) versus needing a genuinely separate mobile entry point --
the existing Tailwind setup and shadcn-style primitives suggest the
former is realistic, but that's a real question to verify against the
actual component tree at build time, not an assumption to carry in from
this doc.

## Do not start implementation without Tim's future approval.
