// Conversational Command + Continuous Hands-Free V2, Phase 9: a real
// dogfood gap -- "What project are we talking about?" named no project and
// classified as neither GLOBAL_STATUS nor GLOBAL_ADVISORY
// (command-scope-classifier.mjs's own GLOBAL_SCOPES), so it fell all the
// way through to respondNoProjectResolved's generic "I couldn't tell which
// project this is about" -- even though the durable CURRENT FOCUS
// (domain/command-conversation-focus.mjs) was right there in
// opState.commandFocus the whole time. This is a genuinely distinct
// question from either fleet status or advisory guidance: the owner is
// asking about the CONVERSATION's own state, not the fleet's. A small,
// narrow, separate, easily-audited pattern (same discipline as
// command-conversation-focus.mjs's own EXPLICIT_SWITCH_PATTERN), checked
// early alongside this codebase's other command-*-bridge.mjs modules --
// never guesses when there's genuinely no focus yet.
const FOCUS_QUERY_PATTERN =
  /\bwhat\s+project\s+(?:are\s+we|is\s+this)\b|\bwhich\s+project\s+(?:are\s+we|is\s+this)\b|\bwhat\s+are\s+we\s+(?:talking|working)\s+(?:about|on)\b/i

export function shouldRouteToFocusQueryBridge(message) {
  return FOCUS_QUERY_PATTERN.test(message)
}

// focusProjectId: opState.commandFocus?.focusProjectId ?? null -- the
// caller's own already-loaded durable focus, never re-derived here.
export function respondFocusQueryCommand({ focusProjectId, projects }) {
  if (!focusProjectId) {
    return {
      intent: 'FOCUS_QUERY',
      decisionClass: 'AUTO_DECIDE',
      text: 'We haven\'t focused on a specific project yet -- name one to get started (e.g. "let\'s work on NWR").',
      plannerRole: 'PLANNER_DEEP',
      providerLabel: 'PLANNER_DEEP · conversation-focus query, no live call needed',
      live: false,
      resolvedProjectIds: [],
      scope: 'FLEET'
    }
  }
  const project = projects.find((p) => p.id === focusProjectId)
  const label = project?.displayName ?? focusProjectId
  return {
    intent: 'FOCUS_QUERY',
    decisionClass: 'AUTO_DECIDE',
    text: `We're currently talking about **${label}**.`,
    plannerRole: 'PLANNER_DEEP',
    providerLabel: 'PLANNER_DEEP · conversation-focus query, no live call needed',
    live: false,
    resolvedProjectIds: [focusProjectId],
    scope: 'PROJECT'
  }
}
