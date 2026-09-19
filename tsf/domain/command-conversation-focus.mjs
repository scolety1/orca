// TSF Hands-Free Command + Project Manager V1: durable Command conversation
// focus. Distinguishes CURRENT FOCUS (the project a Command conversation is
// currently centered on) from TURN TARGETS (projects explicitly referenced
// in one message, already recorded per-turn as `resolvedProjectIds` on the
// Command thread -- never duplicated here) and a RECENT PROJECT STACK for
// natural "go back" behavior. Pure, no I/O -- server/chat-http-routes.mjs
// persists whatever this returns.
//
// Never guesses a focus switch from ambiguity: multiple turn targets, zero
// turn targets, or a fuzzy-only match all leave focus unchanged. Only an
// EXACT turn-target match (never fuzzy) can move focus, mirroring
// project-name-resolver.mjs's own dispatch-safety discipline.
import { isoNow } from './canonical.mjs'

export const RECENT_PROJECT_STACK_CAP = 8

const EXPLICIT_SWITCH_PATTERN =
  /\b(?:switch(?:\s+(?:to|over to))?|let'?s work on|focus on|talk about)\b/i
const GO_BACK_PATTERN = /\bgo\s+back\b/i

// Real, narrow, conservative regex classifiers -- deliberately NOT reusing
// chat-responder.mjs's own intent array: a false positive here silently
// moves focus, so this stays a small, separate, easily-audited surface.
export function isExplicitSwitchMessage(message) {
  return EXPLICIT_SWITCH_PATTERN.test(message)
}

export function isGoBackMessage(message) {
  return GO_BACK_PATTERN.test(message)
}

function pushStack(stack, projectId) {
  if (!projectId) {
    return stack
  }
  return [projectId, ...stack.filter((id) => id !== projectId)].slice(0, RECENT_PROJECT_STACK_CAP)
}

function emptyFocus(clock) {
  return { focusProjectId: null, recentProjectStack: [], updatedAt: isoNow(clock) }
}

// currentFocus: TSF_COMMAND_FOCUS_V1 | null (server/data-store.mjs's
//   opState.commandFocus, as-is -- null before the very first Command turn).
// turnTargetProjectIds: string[] -- EXACT (never fuzzy) project-name-resolver
//   matches for THIS message only.
// decisionClass: 'AUTO_DECIDE' | 'RECOMMEND_AND_PROCEED' | 'TIM_REQUIRED'
//   (chat-responder.mjs's classifyDecision) -- AUTO_DECIDE means a
//   read-only status/question turn, which must never move focus on its own.
// isExplicitSwitch / isGoBack: booleans from the classifiers above, computed
//   by the caller against the SAME message.
export function nextCommandFocus(
  currentFocus,
  { turnTargetProjectIds = [], decisionClass, isExplicitSwitch = false, isGoBack = false },
  clock
) {
  const base = currentFocus ?? emptyFocus(clock)
  const exactTargets = [...new Set(turnTargetProjectIds)]
  const singleTarget = exactTargets.length === 1 ? exactTargets[0] : null

  if (isGoBack) {
    if (singleTarget) {
      // "go back to X" -- explicit target wins outright.
      const stack = pushStack(
        base.recentProjectStack.filter((id) => id !== singleTarget),
        base.focusProjectId
      )
      return { focusProjectId: singleTarget, recentProjectStack: stack, updatedAt: isoNow(clock) }
    }
    // "go back" (no target) -- pop the most recent stack entry, re-pushing
    // the old focus so a second "go back" can return to it.
    const [popped, ...rest] = base.recentProjectStack
    if (!popped) {
      // Nothing to go back to -- honest no-op, never fabricate a target.
      return { ...base, updatedAt: isoNow(clock) }
    }
    const stack = pushStack(rest, base.focusProjectId)
    return { focusProjectId: popped, recentProjectStack: stack, updatedAt: isoNow(clock) }
  }

  if (isExplicitSwitch && singleTarget) {
    if (singleTarget === base.focusProjectId) {
      return { ...base, updatedAt: isoNow(clock) }
    }
    const stack = pushStack(base.recentProjectStack, base.focusProjectId)
    return { focusProjectId: singleTarget, recentProjectStack: stack, updatedAt: isoNow(clock) }
  }

  // A dispatch-worthy or consequential turn (never a plain AUTO_DECIDE
  // status/question) naming exactly one project moves focus there --
  // "Research waiver mechanics..." naming NWR both targets AND focuses NWR.
  if (decisionClass !== 'AUTO_DECIDE' && singleTarget) {
    if (singleTarget === base.focusProjectId) {
      return { ...base, updatedAt: isoNow(clock) }
    }
    const stack = pushStack(base.recentProjectStack, base.focusProjectId)
    return { focusProjectId: singleTarget, recentProjectStack: stack, updatedAt: isoNow(clock) }
  }

  // AUTO_DECIDE (read-only status/question), no turn target, multiple turn
  // targets, or a fuzzy-only match (never reaches here as an exact target
  // at all) -- focus never moves out of ambiguity or a mere mention.
  return { ...base, updatedAt: isoNow(clock) }
}
