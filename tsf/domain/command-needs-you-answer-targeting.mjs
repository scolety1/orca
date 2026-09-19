// Hands-Free Command + Project Manager V1: safely targets which single open
// Needs-You/approval item a conversational answer ("Answer the NWR question
// with option two.", "Yes, authorize it.") actually resolves. Pure, no I/O.
// Mirrors project-name-resolver.mjs's own exact-match-only safety
// discipline: never guesses between multiple real candidates, and never
// resolves when nothing genuinely open exists -- NO ACTION TAKEN, ask for
// clarification, is always a legitimate outcome, never a bug to work around.
//
// openItems: fleetNeedsYouStatus's own real output (domain/fleet-work-
//   status.mjs), already filtered to unresolved items -- never re-derived
//   or re-classified here.
// turnTargetProjectIds: EXACT (never fuzzy) project-name-resolver matches
//   for THIS message -- reused, never re-resolved.
// mentionedProjectIds: EVERY project-name-resolver match for THIS message,
//   exact or fuzzy -- used only to detect "a different real project was at
//   least fuzzily referenced," never to select a target itself.
// focusProjectId: the durable Command focus (domain/command-conversation-
//   focus.mjs), or null.
export function resolveNeedsYouAnswerTarget(
  message,
  {
    openItems = [],
    turnTargetProjectIds = [],
    mentionedProjectIds = [],
    focusProjectId = null
  } = {}
) {
  if (openItems.length === 0) {
    return { ok: false, reason: 'NONE_OPEN' }
  }

  if (turnTargetProjectIds.length === 1) {
    const namedProjectId = turnTargetProjectIds[0]
    const candidates = openItems.filter((item) => item.projectId === namedProjectId)
    if (candidates.length === 1) {
      return { ok: true, item: candidates[0] }
    }
    if (candidates.length === 0) {
      return { ok: false, reason: 'NO_MATCH' }
    }
    // More than one open item on the named project -- never guess which.
    return { ok: false, reason: 'AMBIGUOUS' }
  }

  // REAL DOGFOOD FINDING (round 1, P0, Codex-confirmed): TWO OR MORE exact
  // projects named in the same message is a STRONGER ambiguity signal than
  // none at all -- it must never fall through to the focus fallback below
  // (turnTargetProjectIds.length === 1 is the only "exactly one named"
  // case; 0 and 2+ used to collapse into the same branch here, silently
  // letting an explicitly-two-project message resolve against whichever
  // one happened to be focused).
  if (turnTargetProjectIds.length >= 2) {
    return { ok: false, reason: 'AMBIGUOUS' }
  }

  // No EXACT project named. REAL DOGFOOD FINDING (round 1, P0, Codex-
  // confirmed): a message that FUZZILY references a different real project
  // than the current focus (e.g. "answer the alpha two question..." when
  // only "VOICE-ALPHA-TWO" exactly matches, not the fuzzy "alpha two"
  // phrasing) must never be silently treated as if nothing were named --
  // that dropped fuzzy signal is real evidence the owner meant a DIFFERENT
  // project, so blindly falling back to focus risked resolving the wrong
  // project's item. Only the focus fallback is trusted, and only when
  // nothing else was even fuzzily mentioned (or the only mention IS the
  // focus project itself).
  const otherProjectMentioned = mentionedProjectIds.some((id) => id !== focusProjectId)
  if (focusProjectId && !otherProjectMentioned) {
    const candidates = openItems.filter((item) => item.projectId === focusProjectId)
    if (candidates.length === 1) {
      return { ok: true, item: candidates[0] }
    }
  }
  return { ok: false, reason: 'AMBIGUOUS' }
}
