// Planner Chat backend. Deterministic and project-state-grounded on purpose:
// no paid provider call is wired in without Tim's explicit authorization
// (money/paid API is a TIM_REQUIRED class per the decision model), so this
// answers from real recorded project state instead of inventing an LLM
// persona. The interface (classify + respond) is what a real PLANNER_DEEP
// route would sit behind later — the UI never hard-codes a vendor.
import { projectLiveWorkFeedState, describeLiveRunStatus } from '../domain/live-work-feed.mjs'
import { recentCheckpointTrail } from '../domain/keep-going.mjs'

// Command coverage check (spec Phase 12's explicit list: credentials, money,
// destructive actions, production, push/deploy/publication, consequential
// adoption): the delete-only pattern below was real-verified to be too
// narrow for "destructive actions" generally -- broadened to the same
// verb+target shape plus a couple of standalone destructive command forms,
// still gated by the exact same clause-level inquiry/prohibition logic
// below (so "don't force push" and "should I hard reset?" stay
// non-TIM_REQUIRED, same as "delete the repo" already was). "Source/data
// admission" and "major product direction" (also named in Phase 12) have no
// grounded, real vocabulary anywhere in this codebase to pattern-match
// safely (checked domain/onboarding.mjs directly) -- adding a speculative
// regex for either risks exactly the false-positive/false-negative problem
// this file's own header already warns against; left as a disclosed gap
// rather than a guessed pattern.
const TIM_REQUIRED_PATTERNS = [
  /\b(push|merge|deploy|publish|release to prod|production)\b/i,
  /\b(pay|payment|paid api|credit card|subscription|billing)\b/i,
  /\b(credential|secret|api key|password|token)\b/i,
  /\b(delete|drop|wipe|destroy) (the )?(repo|repository|branch|database|data|production)\b|\bforce[- ]push\b|\bhard reset\b|\brm -rf\b/i,
  /\b(adopt|approve).*(candidate|this)\b/i
]

// Real Planner Chat authority false positive (V1 stabilization finding): a
// bare keyword match against the WHOLE message forced TIM_REQUIRED even
// when Tim was asking ABOUT a consequential action (a read-only readiness
// question) or explicitly PROHIBITING it — not requesting it. Real
// reproduction: "...asked for an evidence-backed readiness assessment...
// even after the prompt explicitly prohibited: ... push/merge/deploy;
// credentials/money; destructive actions" was refused entirely, even
// though every consequential keyword in it was there to rule the action
// OUT, never to request it. Each match is now judged against its own
// clause: a clause that's a genuine inquiry (a question, or opens with an
// interrogative/hedging phrase) or an explicit prohibition (negated) does
// not, by itself, force TIM_REQUIRED — an unhedged, non-negated directive
// ("deploy it", "push this now") still does. "tell me whether to deploy"
// (inquiry) and "deploy it" (directive) must not classify identically.
// Split into two: BARE_OPENER alone is ambiguous -- a clause created purely
// by "and"-splitting a bare, no-punctuation directive ("...and will deploy
// after that", "...and should merge soon") also starts with an opener word,
// simply because that's how English states a future-tense action without a
// subject pronoun. It is gated on a real "?" existing somewhere in the
// clause's own sentence below (never on the clause alone -- a sibling
// clause's own directive must never borrow another clause's "?"). TELL_ME_
// WHETHER's "tell me/explain/assess ... whether" shape is unambiguously
// interrogative in structure regardless of punctuation, so it stays
// unconditional.
const BARE_OPENER = /^\s*(?:is|are|was|would|will|should|could|can|what|why|when|whether|how)\b/i
const TELL_ME_WHETHER =
  /\b(?:tell me|let me know|explain|assess|evaluate|prepare)\b[\s\S]*\bwhether\b/i
const PROHIBITION_MARKERS =
  /\b(?:no|not|never|don['’]t|do not|won['’]t|without|isn['’]t|aren['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t|can['’]t|cannot|none of)\b/i
// Second-independent-verification-pass finding (real, reproduced, pre-
// existing -- surfaced while re-checking the "and" clause-split fix,
// unrelated to it): PROHIBITION_MARKERS matches a bare "not"/"no" anywhere
// in a clause with no idiom awareness -- "whether ... or not" and "no
// matter" are standard English idioms that mean "regardless," never a
// negation of the directive they attach to, but the same clause's own
// "not"/"no" wrongly suppressed a genuine, unhedged directive: "deploy it
// whether tim likes it or not" / "push this to production whether you
// approve or not" / "deploy this no matter what" all classified AUTO_DECIDE
// instead of TIM_REQUIRED. Stripped before the prohibition test, not added
// as a separate branch, so a clause whose ONLY negation-looking text is one
// of these idioms correctly falls through to the real directive check.
const IDIOMATIC_NON_NEGATION = /\bor not\b|\bno matter\b/gi
// "Can/could/would/will YOU ...?" is English's own standard polite-request
// form ("can you push this to production?" means "please push this"), not
// a genuine inquiry about the action's safety/advisability — independent-
// review-equivalent regression found: it must stay a directive even though
// it's phrased as a question and opens with a modal verb otherwise treated
// as an inquiry opener. Checked first so it always wins over the "?"/
// opener rules below.
const POLITE_REQUEST_MARKER = /\b(?:can|could|would|will)\s+you\b/i

// Independent-review finding (dangerous-direction regression, caught before
// adoption): splitting only on `.!?;\n` let an inquiry/prohibition earlier
// in a comma- or "but"/em-dash-joined RUN-ON sentence exempt a genuine,
// unrelated directive later in the SAME loose clause — e.g. "how do I check
// status, and go ahead and delete the repo" wrongly waved a real destructive
// delete through as AUTO_DECIDE, because the leading "how" opener covered
// the whole sentence. Normalizing these coordinating joins into hard clause
// boundaries first (so each independent thought is judged on its own) closes
// that gap: "no rush, but please merge this to main" now correctly separates
// the hedge from the actual directive instead of letting "no" (30+ characters
// away) suppress it.
function splitIntoSentences(message) {
  return message.split(/(?<=[.!?;\n])/)
}

// Comma/"but"/em-dash/"and" normalization happens WITHIN a sentence, one
// level below the sentence split — kept separate so the polite-request
// check below can look at the whole sentence a clause came from, not just
// the clause fragment itself.
//
// BUG-08 (bug-ledger.json): real, reproduced gap -- "and" was not a clause
// boundary here, so a negation and a genuine, separate directive joined by
// a bare "and" (no comma) stayed one clause, and PROHIBITION_MARKERS
// matching anywhere in that whole clause silently suppressed the real
// directive too: "do not deploy this and push it now" classified
// AUTO_DECIDE; "please do not deploy and go ahead and merge this"
// classified RECOMMEND_AND_PROCEED. Same class of dangerous-direction
// regression as the comma/"but"/em-dash fix above, just not extended to
// "and" — closing it the same way, by the same reasoning.
function splitIntoClauses(sentence) {
  return sentence.replace(/,|--|—|\bbut\b|\band\b/gi, '.').split(/(?<=[.!?;\n])/)
}

// Independent-review finding (dangerous-direction regression, caught before
// adoption, 2nd pass): checking POLITE_REQUEST_MARKER against the clause
// alone let a mid-sentence interjection ("Can you, if you have a moment,
// push this to production?") split the "can you" clause away from the
// verb+keyword clause, so the verb clause was judged on its own trailing
// "?" and misread as a bare inquiry. The marker is judged against the
// whole SENTENCE the clause came from instead — "can/could/would/will you"
// anywhere in the same sentence still means the same request, however many
// commas interrupt it — while sentence-level (not whole-message) scope
// keeps an unrelated later sentence's own prohibition ("Also, don't push to
// production.") from being swept up by an earlier sentence's polite marker.
function isGenuineDirective(clause, sentence) {
  if (POLITE_REQUEST_MARKER.test(sentence)) {
    return true
  }
  if (/\?/.test(clause)) {
    return false
  }
  if (TELL_ME_WHETHER.test(clause)) {
    return false
  }
  // BUG-08 independent-verification finding (real, reproduced): a bare
  // opener word alone must additionally require the clause's own sentence
  // to actually contain a "?" -- without this, "and"-splitting a message
  // like "run the tests and will deploy after that" isolates "will deploy
  // after that" as its own clause, which starts with "will" and was being
  // misread as a genuine inquiry even though nothing here is a question at
  // all, silently waving a real deploy directive through as AUTO_DECIDE.
  if (BARE_OPENER.test(clause.trimStart()) && /\?/.test(sentence)) {
    return false
  }
  if (PROHIBITION_MARKERS.test(clause.replace(IDIOMATIC_NON_NEGATION, ''))) {
    return false
  }
  return true
}

function isConsequentialDirective(message) {
  for (const sentence of splitIntoSentences(message)) {
    for (const clause of splitIntoClauses(sentence)) {
      if (
        TIM_REQUIRED_PATTERNS.some((pattern) => pattern.test(clause)) &&
        isGenuineDirective(clause, sentence)
      ) {
        return true
      }
    }
  }
  return false
}

const INTENTS = [
  {
    id: 'STATUS',
    // "what is it doing?" is Tim's own exact north-star follow-up phrasing
    // (M3 requirements) -- must be recognized, not fall through to GENERAL.
    // "what's running (right now)?" is Command's own exact phrasing (spec
    // Phase 7) -- a real gap found live: it did not match any pattern here
    // and fell through to a "couldn't tell which project" reply even for a
    // deliberately project-less, fleet-wide question.
    pattern:
      /\b(what'?s going on|status|where are we|update me|catch me up|what (is|'s) it doing|what'?s running)\b/i
  },
  { id: 'FINISHED', pattern: /\b(is (this|it) (actually )?(done|finished|ready)|are we done)\b/i },
  // M3: the affirmative "go do real work" phrasings Tim's own north star
  // names ("go ahead," "build that," "do the recommended next step") --
  // deliberately a SEPARATE intent from FIX_REQUEST (which stays scoped to
  // "something is wrong, correct it") rather than folded into it, since the
  // two read differently even though both currently route to the same
  // RECOMMEND_AND_PROCEED dispatch path below. Checked BEFORE NEXT_ACTION:
  // "do the recommended next step" is an imperative dispatch request, not
  // the question "what's the next step?" that NEXT_ACTION's own pattern
  // means to catch -- ordering (first match wins) is what keeps these two
  // correctly distinguished rather than the "next step" substring colliding.
  {
    id: 'DISPATCH_REQUEST',
    // Command Authority repair: "proceed with (it|that|this)" only matched a
    // pronoun -- an explicit, named-project confirmation ("yes, proceed with
    // niners-war-room"), which is exactly the phrasing the TIM_REQUIRED
    // refusal itself asks for ("name exactly which project(s)"), fell
    // through to GENERAL and never dispatched, forcing a repeated ask
    // instead of consuming the explicit authorization once. Broadened to
    // any following word/id-shaped token, not just the three pronouns.
    //
    // Command final hands-on hardening: bare imperatives ("Run Nytheria",
    // "Start WorldForge", "Run Nytheria overnight") are Command's own stated
    // main-surface vocabulary but were not recognized at all -- disclosed as
    // a usability gap, not a regression, but a real one for the surface
    // meant to be the primary conversational control plane. BARE_IMPERATIVE
    // is deliberately ANCHORED to the start of its own clause (after
    // matchesAsGenuineDirective's own per-clause split), not a bare \brun\b/
    // \bstart\b anywhere -- a clause has to actually OPEN with the verb to
    // count. That alone is what keeps every non-dispatch "run"/"start"
    // sentence in ordinary use out of this pattern without needing a second
    // negation/question check: "what's running right now?" (already its own
    // earlier-checked STATUS intent), "is the test still running?", "how do
    // I run the migration?", and "the CI run failed" all have "run" only as
    // a noun/gerund or mid-sentence, never as the clause's own opening verb,
    // so the anchor alone excludes them -- reusing isGenuineDirective (via
    // directiveOnly below) is what then separately rejects a genuine
    // question ("Run Nytheria?") or negated form ("Don't run Nytheria" does
    // not even reach isGenuineDirective -- "don't" is the clause's own first
    // word, so the anchor itself never matches). "run into" (a common
    // encounter-idiom, "ran into an issue") is the one disclosed, explicitly
    // reproduced false-positive shape and is excluded here directly; "start
    // over" (restart-from-scratch idiom) is a narrower, disclosed residual
    // gap left unhandled rather than guessed at, matching this file's own
    // stated convention (see PROHIBITION_MARKERS's own header) -- extend
    // this exclusion, not the anchor shape, if another such idiom is found.
    pattern:
      /\b(go ahead|go for it|please proceed|proceed with [\w-]+|build (that|this|it)|do (the recommended( next)? step|it|that)|sounds good,? (go ahead|do it))\b|^\s*(?:please\s+)?(?:run(?!\s*into\b)|start)\b/i,
    // Adversarial-review finding (2nd pass): a first fix here only guarded
    // the "proceed" alternative, only against negation words immediately
    // adjacent, and against the WHOLE message rather than per-clause --
    // "don't go ahead with tsf-orca" (a different alternative), "please do
    // not just proceed" (word inserted), and "don't proceed with X. go
    // ahead and proceed with Y instead." (an unrelated LATER genuine
    // request wrongly suppressed by an EARLIER negation) all still slipped
    // through or wrongly withheld the wrong one. Replaced with
    // `directiveOnly`, reusing this file's own proven, adversarial-review-
    // hardened clause/negation judgment (isGenuineDirective) instead of a
    // second, narrower, ad hoc regex.
    directiveOnly: true
  },
  { id: 'NEXT_ACTION', pattern: /\b(what should we do next|next step|what'?s next|what now)\b/i },
  { id: 'RATIONALE', pattern: /\b(why (did you|was)|what'?s the reasoning|why choose)\b/i },
  {
    id: 'CRITIQUE',
    pattern: /\b(looks like (shit|garbage|crap)|don'?t like|ugly|ugh|ew|hate this|sucks)\b/i
  },
  {
    id: 'FIX_REQUEST',
    pattern: /\b(fix (this|it)|change (this|it)|redo|make it)\b/i,
    // Adversarial-review finding (2nd pass): FIX_REQUEST is dispatch-worthy
    // (command-responder.mjs's DISPATCH_WORTHY_INTENTS) exactly like
    // DISPATCH_REQUEST, but had no negation awareness of its own -- "don't
    // fix this" reached the same real dispatch path as an affirmative fix
    // request. Same `directiveOnly` gate as DISPATCH_REQUEST.
    directiveOnly: true
  },
  { id: 'RESEARCH', pattern: /\b(research|look into|compare|investigate|explore options)\b/i },
  { id: 'HEALTH', pattern: /\b(health|is it healthy|any (issues|problems|blockers))\b/i },
  { id: 'ADOPTION', pattern: /\b(adopt|ready for adoption|candidate)\b/i }
]

// Command Authority repair: a dispatch-worthy intent (DISPATCH_REQUEST,
// FIX_REQUEST) must only be recognized from a clause that is a genuine,
// non-negated, non-inquiry directive -- reuses isGenuineDirective/
// splitIntoSentences/splitIntoClauses directly rather than a second,
// independently-maintained negation check, so a fix to the shared
// vocabulary/rules here (already adversarial-review-hardened for
// TIM_REQUIRED) applies to both without having to be re-applied by hand.
function matchesAsGenuineDirective(message, pattern) {
  for (const sentence of splitIntoSentences(message)) {
    for (const clause of splitIntoClauses(sentence)) {
      if (pattern.test(clause) && isGenuineDirective(clause, sentence)) {
        return true
      }
    }
  }
  return false
}

export function classifyIntent(message) {
  for (const { id, pattern, directiveOnly } of INTENTS) {
    if (directiveOnly) {
      if (matchesAsGenuineDirective(message, pattern)) {
        return id
      }
      continue
    }
    if (pattern.test(message)) {
      return id
    }
  }
  return 'GENERAL'
}

export function classifyDecision(message, intent) {
  if (isConsequentialDirective(message)) {
    return 'TIM_REQUIRED'
  }
  if (['FIX_REQUEST', 'DISPATCH_REQUEST', 'RESEARCH', 'CRITIQUE'].includes(intent)) {
    return 'RECOMMEND_AND_PROCEED'
  }
  return 'AUTO_DECIDE'
}

function fmtTests(testsRun) {
  if (!testsRun?.length) {
    return 'no recorded test run'
  }
  return testsRun
    .map((t) =>
      t.command
        ? `${t.command}: ${t.passed ?? '?'}/${(t.passed ?? 0) + (t.failed ?? 0)}`
        : JSON.stringify(t)
    )
    .join('; ')
}

// M3: "what is it doing?" (STATUS/NEXT_ACTION) must answer from the real,
// live Keep Going run once one exists for this project -- the old mission/
// candidate/release model below predates M2 entirely and has no
// relationship to a project's actual dispatch state. `gap` is optional
// (compareStateToGoal's own output, or null) -- see
// projectLiveWorkFeedState's own honesty guarantee for what happens
// without it.
// Only STATUS/NEXT_ACTION/FINISHED are ever answered from the live run,
// and only while it is genuinely still the primary story -- a
// COMPLETE/BLOCKED run stays that way forever with nothing to clear it
// (an independent review finding: an earlier version let ANY run --
// including one long finished and since forgotten -- permanently shadow
// every future question about this project, even when the old, richer
// mission/candidate/release model held separately-relevant, more current
// information). Exported so http-server.mjs can decide whether to skip
// the live conversational planner call using the exact same rule
// respond() itself applies, rather than two independently-drifting checks.
const LIVE_RUN_INTENTS = new Set(['STATUS', 'NEXT_ACTION', 'FINISHED'])
const LIVE_RUN_TERMINAL_STATES = new Set(['COMPLETE', 'BLOCKED'])
export function isLiveRunRelevantFor(intent, run) {
  return !!run && LIVE_RUN_INTENTS.has(intent) && !LIVE_RUN_TERMINAL_STATES.has(run.state)
}

function recentHistoryLine(run) {
  const phases = recentCheckpointTrail(run).map((c) => c.phase)
  return `Recent history: ${phases.join(' -> ')}.`
}

function respondStatusOrNextActionFromRun(intent, project, run, gap) {
  const feed = projectLiveWorkFeedState(run, gap)
  const base = `**${project.displayName}** — Keep Going run \`${run.id}\` is **${feed.state}**: ${feed.reason}.`
  if (intent === 'FINISHED') {
    return `No, not yet — ${base}`
  }
  if (intent === 'STATUS') {
    // M4: "recovery summary after restart" -- 'catch me up' already routes
    // here (STATUS's own pattern includes it). Appending a short,
    // chronological read of the durable checkpoint trail is what actually
    // answers "what happened while this was down/paused?" -- grounded in
    // the exact same persisted state a fresh, restarted process reads,
    // never a separate in-memory "since you last looked" tracker. Skipped
    // when there is nothing yet to recap (a run that just started has
    // only its own RUN_STARTED checkpoint).
    return run.checkpoints.length > 1 ? `${base} ${recentHistoryLine(run)}` : base
  }
  // NEXT_ACTION: point at the real, existing affordance for each state --
  // never a fictional one (an independent review finding elsewhere in M3
  // caught exactly this failure mode in a different message).
  if (feed.state === 'NEEDS_YOU') {
    const openQuestion = run.needsYou.find((entry) => !entry.resolvedAt)
    return openQuestion
      ? `${base} Open question: ${openQuestion.question}`
      : `${base} Check the Keep Going panel for the open question.`
  }
  if (feed.state === 'STALLED') {
    return `${base} Use the "Abandon stalled wave" action to recover it.`
  }
  if (feed.state === 'PAUSED' || feed.state === 'WAITING') {
    return `${base} Click Resume to continue it.`
  }
  if (feed.state === 'READY_FOR_ADOPTION') {
    return `${base} Review it on the Adoption surface and decide Adopt / Request Revision / Reject.`
  }
  return `${base} No action needed from you right now.`
}

function respondStatus(project) {
  const m = project.mission
  const r = project.release
  const reason = m.blockedReason?.replace(/\.+$/, '')
  return `**${project.displayName}** — mission \`${m.id ?? 'none'}\` is **${m.state}**. Health: **${project.health.status}**${reason ? ` — ${reason}.` : '.'} Stable at \`${(r.stable.head ?? 'unknown').slice(0, 10)}\`, Testing: ${r.testing}, Adoption: ${r.adoption}.`
}

function respondFinished(project) {
  const adopted = project.release.adoption?.startsWith('ADOPTED')
  if (adopted) {
    return `Yes — this candidate is **ADOPTED**. Verifier verdict GREEN, tests: ${fmtTests(project.candidate?.testsRun)}. Stable is at \`${(project.release.stable.head ?? '').slice(0, 10)}\`.`
  }
  if (
    project.mission.state === 'BLOCKED' ||
    project.mission.state === 'BLOCKED_ARCHITECTURAL_CONFLICT'
  ) {
    return `No — it's **blocked**: ${project.mission.blockedReason ?? project.health.findings?.[0]?.summary ?? 'see Health for details'}. Not safe to resume without a decision from you.`
  }
  if (project.candidate?.state === 'READY_FOR_ADOPTION') {
    return `The candidate is verifier-GREEN and **ready for your adoption decision** — it isn't adopted yet.`
  }
  return `Not yet — current mission state is **${project.mission.state}**.`
}

function respondNextAction(project) {
  switch (project.mission.state) {
    case 'BLOCKED':
    case 'BLOCKED_ARCHITECTURAL_CONFLICT':
      return `This needs a decision from you: ${project.mission.blockedReason ?? 'an architectural conflict is blocking safe progress'}. I won't guess past that boundary.`
    case 'ADOPTED':
      return `Nothing pending — Stable is settled at the adopted candidate. Next mission would need a new objective from you or the planner.`
    default:
      if (project.candidate?.state === 'READY_FOR_ADOPTION') {
        return `Review the candidate on the Adoption surface and decide Adopt / Request Revision / Reject.`
      }
      return `No active work item recorded for this project right now.`
  }
}

function respondRationale(project) {
  const sm = project.evidence?.selectedMission
  if (sm?.rationale) {
    return `**${sm.title ?? 'Selected mission'}** — ${sm.rationale}`
  }
  const summary = project.evidence?.resultCapsules?.at(-1)?.implementationSummary
  if (summary) {
    return summary
  }
  return `No recorded rationale for this project yet.`
}

function respondCritiqueOrFix(project, intent) {
  const verb = intent === 'CRITIQUE' ? 'Noted' : 'Got it'
  return `${verb}. I can't dispatch a live Orca worker from this chat yet — that path (Wave 5 Run/task/dispatch integration) is still pending. I've logged this as feedback on **${project.displayName}**; the concrete next step is to turn it into a bounded mission the planner can hand to a worker. Want me to draft that mission?`
}

function respondResearch(project) {
  return `Research routing isn't wired into chat yet — today this only reads recorded project state. For real research, route through the planner's normal research/mission flow outside this UI for now. I can still summarize what's already known about **${project.displayName}** if that helps.`
}

function respondHealth(project) {
  if (!project.health.findings?.length) {
    return `**${project.displayName}** is healthy — no findings.`
  }
  const findings = project.health.findings.map((f) => `${f.code}: ${f.summary}`).join(' ')
  return `**${project.displayName}** health: ${project.health.status}. ${findings}`
}

function respondAdoption(project) {
  if (!project.candidate) {
    return `No candidate recorded for ${project.displayName}.`
  }
  return `Candidate \`${(project.candidate.head ?? '').slice(0, 10)}\` is **${project.candidate.state}**. ${project.candidate.implementationSummary ?? ''}`.trim()
}

function respondGeneral(project) {
  return `I have recorded state for **${project.displayName}** (mission ${project.mission.state}, health ${project.health.status}) but that phrasing didn't match a specific question I can ground an answer in. Try asking about status, whether it's finished, what's next, why a choice was made, or its health.`
}

// M3's real dispatch bridge (chat-dispatch-bridge.mjs, still being built)
// intercepts DISPATCH_REQUEST before it ever reaches this fallback --
// this stays as the honest degraded answer for when that bridge itself is
// unavailable or hasn't decided to act, matching respondCritiqueOrFix's own
// "not wired yet" honesty rather than fabricating a dispatch that didn't
// happen.
function respondDispatchRequest(project) {
  return `Got it — I can't dispatch a live Orca worker from this reply path yet (the chat-dispatch bridge is still being built). I've logged this as a request on **${project.displayName}**; once wired, this exact phrasing will be enough to create a bounded plan and a real dispatch without you opening a terminal.`
}

const RESPONDERS = {
  STATUS: respondStatus,
  FINISHED: respondFinished,
  NEXT_ACTION: respondNextAction,
  RATIONALE: respondRationale,
  CRITIQUE: (p) => respondCritiqueOrFix(p, 'CRITIQUE'),
  FIX_REQUEST: (p) => respondCritiqueOrFix(p, 'FIX_REQUEST'),
  DISPATCH_REQUEST: respondDispatchRequest,
  RESEARCH: respondResearch,
  HEALTH: respondHealth,
  ADOPTION: respondAdoption,
  GENERAL: respondGeneral
}

// BUG-08 (bug-ledger.json) real, reproduced honesty gap: this previously
// said "tell me explicitly to proceed and I'll surface exactly what would
// change ... before anything happens" -- a preview/reconfirm flow that
// does not exist anywhere in this codebase (checked: no approval-tracking
// state, no such route). Restating the request just re-triggers this exact
// same refusal every time (isConsequentialDirective has no notion of a
// prior turn), so the old wording promised an escape hatch that could
// never actually open -- a real dead-end loop, not merely unbuilt UI.
// Chat itself is structurally incapable of this class of action regardless
// of any confirmation: live-planner.mjs's own system prompt runs it
// zero-tool (--tools ""), and chat-dispatch-bridge.mjs's generated plans
// are hard-forbidden from including push/merge/deploy/publish/credentials/
// money/adoption. So the honest, correct answer is not "tell me again" --
// it's naming the real surface where that decision is actually made.
function respondTimRequired(project) {
  return `That's a **consequential decision** (money, credentials, push/merge/deploy/publish, or adoption authority) — chat has no tools and can't act on it, no matter how you phrase it. Make that call on the real surface for it instead: the Adoption tab for an adopt/reject decision on **${project?.displayName ?? 'this project'}**, or your own terminal/CLI for push/merge/deploy.`
}

// BUG-13 (bug-ledger.json): only STATUS/NEXT_ACTION/FINISHED ever grounded
// an answer in the live run (respondStatusOrNextActionFromRun above) --
// every other intent (HEALTH/ADOPTION/RATIONALE/GENERAL/CRITIQUE/
// FIX_REQUEST/RESEARCH/DISPATCH_REQUEST) answered purely from the old
// mission/candidate/release model, blind to a real Keep Going run even
// while it was actively running/stalled/needing a decision. Appended,
// never replacing those responders' own text, and only while the run is
// still the live story (same LIVE_RUN_TERMINAL_STATES rule
// isLiveRunRelevantFor already applies, so a long-finished run doesn't
// permanently shadow every future answer).
function liveRunFooter(run, gap) {
  if (!run || LIVE_RUN_TERMINAL_STATES.has(run.state)) {
    return ''
  }
  return ` (${describeLiveRunStatus(run, gap)})`
}

// `run` (a real Keep Going domain run, or null) and `gap` (compareStateToGoal's
// output, or null) are both optional -- callers with no live run for this
// project (or that haven't wired the lookup) get the exact prior
// behavior, unchanged.
export function respond(project, message, run = null, gap = null) {
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  const text = !project
    ? `No project selected — pick one first.`
    : decisionClass === 'TIM_REQUIRED'
      ? respondTimRequired(project)
      : isLiveRunRelevantFor(intent, run)
        ? respondStatusOrNextActionFromRun(intent, project, run, gap)
        : RESPONDERS[intent](project) + liveRunFooter(run, gap)
  return {
    intent,
    decisionClass,
    text,
    plannerRole: 'PLANNER_DEEP',
    providerLabel:
      'No live provider configured — rule-based fallback grounded in recorded project state'
  }
}
