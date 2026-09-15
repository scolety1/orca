// TSF UI FINDINGS #2-#16, Finding #4: real synonyms of PAUSE/dispatch verbs
// this codebase's own action classifiers (classifyRunActionVerb,
// VERB_REGISTRY in domain/command-act-model.mjs) do not recognize --
// "stop NWR"/"kill that run"/"abort it" read as an unmistakable attempted
// directive to a human, but previously fell through every real classifier
// and landed on command-responder.mjs's own final, ordinary-looking
// status/advisory fallback with zero indication nothing was actually
// stopped. Deliberately bounded to real stop/halt synonyms only, never a
// broad catch-all -- an ordinary question ("is it stopped?") or hedge
// ("don't stop it") is excluded by messageContainsGenuineDirectiveFor's own
// reused genuine-directive check (chat-responder.mjs), never a second parser.
import { messageContainsGenuineDirectiveFor } from './chat-responder.mjs'

const UNRECOGNIZED_ACTION_VERBS = [/\b(stop|halt|kill|abort|terminate|quit)\w*\b/i]

function isAmbiguousActionShapedRequest(message) {
  return messageContainsGenuineDirectiveFor(message, UNRECOGNIZED_ACTION_VERBS)
}

// Returns the full command-responder.mjs response shape, or null when this
// message isn't action-shaped at all -- called only once every real action
// classifier has already declined the message (see command-responder.mjs's
// own call site), so a non-null result here means nothing else recognized
// it either.
export function buildActionAmbiguityFallback(
  message,
  intent,
  decisionClass,
  resolvedProjectIds,
  scope
) {
  if (!isAmbiguousActionShapedRequest(message)) {
    return null
  }
  return {
    intent,
    decisionClass,
    text: '**NO ACTION WAS TAKEN.** I\'m not confident I understood what you want done here -- tell me explicitly which project and which action (e.g. "pause NWR", "put NWR on hold"), and I\'ll act on it.',
    plannerRole: 'PLANNER_DEEP',
    providerLabel:
      'PLANNER_DEEP · action-shaped request not confidently understood, nothing executed',
    live: false,
    resolvedProjectIds,
    scope
  }
}
