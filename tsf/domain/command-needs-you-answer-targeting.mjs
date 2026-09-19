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
// focusProjectId: the durable Command focus (domain/command-conversation-
//   focus.mjs), or null.
export function resolveNeedsYouAnswerTarget(
  message,
  { openItems = [], turnTargetProjectIds = [], focusProjectId = null } = {}
) {
  if (openItems.length === 0) {
    return { ok: false, reason: 'NONE_OPEN' }
  }

  const namedProjectId = turnTargetProjectIds.length === 1 ? turnTargetProjectIds[0] : null
  if (namedProjectId) {
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

  // No project named in the message -- fall back to the durable focus, the
  // same "narrower signal first, focus as fallback" pattern command-
  // responder.mjs's own lastReferencedProjectId now uses. Anything else
  // (no focus, or the focus project itself has more than one open item) is
  // genuinely ambiguous -- never guessed.
  if (focusProjectId) {
    const candidates = openItems.filter((item) => item.projectId === focusProjectId)
    if (candidates.length === 1) {
      return { ok: true, item: candidates[0] }
    }
  }
  return { ok: false, reason: 'AMBIGUOUS' }
}
