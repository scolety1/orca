// Real bulk pause/resume ("pause everything except X") -- split out of
// command-responder.mjs to keep that file under the repo's max-lines lint
// cap (mirrors keep-going-http-routes.mjs's own stated reason for
// existing as a separate file). Reuses respondMultiActionCommand's own
// real per-project execution/aggregation, never a second bulk loop.
export async function respondQuantifiedRunAction({
  message,
  runActionVerb,
  allProjects,
  opState,
  clock,
  deps,
  intent,
  decisionClass,
  respondMultiActionCommand
}) {
  if (allProjects.length === 0) {
    return {
      intent,
      decisionClass,
      text: 'Every project is excluded -- nothing left to act on.',
      plannerRole: 'PLANNER_DEEP',
      providerLabel: `PLANNER_DEEP · ${runActionVerb.toLowerCase()} withheld -- exclusions covered the catalog`,
      live: false,
      resolvedProjectIds: [],
      scope: 'FLEET'
    }
  }
  const entries = allProjects.map((p) => ({
    target: p.id,
    intent: runActionVerb,
    rawClause: message
  }))
  return respondMultiActionCommand({
    message,
    projects: allProjects,
    opState,
    clock,
    deps,
    entries
  })
}
