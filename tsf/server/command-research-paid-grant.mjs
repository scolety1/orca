// Extracted from command-research-bridge.mjs purely to stay under this
// repo's max-lines budget (self-contained: parsePaidGrant and its
// supporting patterns have no dependency on anything else in that file).
// See that file's own header for the AUTHORITY BOUNDARY this function
// enforces: this is the ONE real path a chat message can grant real
// paid-research-spend authority through.
import { EXA_PROVIDER_ID } from '../adapters/exa-research-worker.mjs'
import { PARALLEL_PROVIDER_ID } from '../adapters/parallel-research-worker.mjs'
import {
  DELIBERATIVE_STATEMENT_OPENER,
  isGenuineDirective,
  RETRACTION_MARKER_PATTERN
} from './chat-responder.mjs'

const PROVIDER_NAME_TO_ID = Object.freeze({ exa: EXA_PROVIDER_ID, parallel: PARALLEL_PROVIDER_ID })

// REAL DOGFOOD FINDING (post-mission, P0): this previously required only a
// provider name AND a dollar figure to appear ANYWHERE in the message --
// no authorizing verb at all. "Why did Exa charge us $50 last week?", "Exa's
// pricing page says $50", and even "Don't authorize more than $50 for Exa"
// (an explicit PROHIBITION) all classified as RESEARCH_PAID_GRANT and would
// have granted real paid-spend authority via the SAME unconditional
// grantResearchPaidApprovalDurable call this module's own header says must
// only ever follow "the owner's own chat message explicitly naming a
// provider and a spend ceiling" -- a casual mention was never that. Every
// real/tested trigger phrase already uses "use" ("use Exa up to $50", "Use
// Exa for this research up to $50"), so requiring an authorizing verb (and
// refusing outright on an explicit negation) matches the only intended
// shape while closing the false-positive gap.
const GRANT_AUTHORIZATION_VERB_PATTERN = /\b(?:use|grant|approve|authorize|allow)\b/i
const GRANT_NEGATION_GUARD_PATTERN =
  /\b(?:do not|don'?t|never|shouldn'?t|should not|won'?t|refuse|decline|deny)\b/i

// DIRECTIVE SEMANTICS CLOSURE V1 round 2 (P0, real Codex adversarial-
// review finding): the round-1 fix (DELIBERATIVE_STATEMENT_OPENER at
// message start) was still insufficient -- a real question or reported-
// speech sentence mentioning a provider and a dollar amount still
// classified as RESEARCH_PAID_GRANT: "Would Exa use a $50 budget
// efficiently", "The plan recommends we use Parallel for the $50 trial",
// "Please explain whether to use Exa at $50", "Do you recommend I use
// Parallel for $50", "Can Exa use a $50 budget for this". There is no
// later directive check once this classification fires -- it proceeds
// straight to grantResearchPaidApprovalDurable.
//
// Fixed by requiring isGenuineDirective(message, message) === true as an
// ADDITIONAL condition -- the one shared canonical judgment (now handling
// TELL_ME_WHETHER/POLITE_REQUEST_MARKER/REPORTED_SPEECH_MARKER/
// COPULA_QUESTION_OPENER/SUBJECT_INVERSION_QUESTION_OPENER/"?" all in one
// call) rather than re-deriving each of those checks independently here,
// per this closure mission's own "consolidate into the existing shared
// primitive" instruction. Verified this alone closes 3 of the 7 review
// cases (reported speech, "explain whether", "do you recommend") without
// affecting the real trigger phrasings ("Use Exa up to $20").
//
// isGenuineDirective's own punctuation-independent question patterns
// require a PRONOUN subject (deliberately, to avoid reintroducing the
// BUG-08 "...and will deploy after that" danger case in the CLAUSE-
// fragment contexts those patterns were designed for) -- so a message
// with a NAMED subject instead of a pronoun ("Would Exa use...", "Should
// our team use...", "Can Exa use...") still passed. This file never
// splits a message into fragments (parsePaidGrant always sees the WHOLE,
// original message), so that danger case cannot occur here -- a modal
// literally at the very start of the whole message is unambiguously a
// question in English regardless of what subject follows (a declarative
// statement never opens with a bare modal: "Would Exa..." cannot be
// rephrased as a command without reordering to "Exa, ..."). Checked
// locally, not added to the shared, widely-reused
// SUBJECT_INVERSION_QUESTION_OPENER, to avoid changing behavior for its
// other callers (command-run-action-bridge.mjs's clause-fragment context,
// where the pronoun requirement IS load-bearing).
// Excludes an immediately-following "you" (negative lookahead): "Can you
// use Exa up to $20" is a real, legitimate polite-request grant phrasing
// -- isGenuineDirective already correctly returns true for it via
// POLITE_REQUEST_MARKER, and this check must never override that with a
// false "it's a question" verdict.
//
// DIRECTIVE SEMANTICS CLOSURE V1 round 3 (P0, real Codex adversarial-
// review finding): the "you"-only exclusion above was too narrow -- a
// real, legitimate grant request with a non-"you" subject ("Could the
// team please use Exa up to $50", "Would our research agent please use
// Parallel up to $25") was wrongly refused as a question. The
// distinguishing signal between these and a genuine information question
// ("Would Exa use a $50 budget efficiently", "Should our team use Exa if
// it costs $50", "Can Exa use a $50 budget for this" -- none of which
// contain "please") is exactly "please": English marks a polite request
// to ACT with "please" regardless of subject, while an information
// question about the action's behavior/cost never does. A second
// negative lookahead excludes the WHOLE modal-question reading whenever
// "please" appears anywhere later in the message, letting it fall
// through to the real grant path instead.
const MESSAGE_START_MODAL_QUESTION =
  /^\s*(?:would|should|could|can|will|might|may|do|does|did|is|are|was|were|has|have|had)\b(?!\s+you\b)(?![\s\S]*?\bplease\b)/i
// "We may"/"I may" is not in the shared DELIBERATIVE_STATEMENT_OPENER
// vocabulary (i wonder if/i'm not sure if/i am not sure if/i don't know
// if/i guess/i think/maybe/perhaps/possibly) -- "We may use Exa but what
// does the $50 price include" needs this file's own narrow supplement
// rather than broadening that shared, widely-reused constant for every
// other caller.
const MAY_DISCUSSION_OPENER = /^\s*(?:we|i)\s+may\b/i

// DIRECTIVE SEMANTICS CLOSURE V1 round 3 (P0, real Codex adversarial-
// review finding): a real, legitimate grant retracted in the same
// message ("Use Exa up to $50, scratch that.") still granted -- no
// retraction check existed here at all. RETRACTION_MARKER_PATTERN is the
// same shared vocabulary command-run-action-bridge.mjs/command-
// conversation-focus.mjs/command-needs-you-answer-bridge.mjs already use.
export function parsePaidGrant(message) {
  const trimmed = message.trim()
  if (
    !GRANT_AUTHORIZATION_VERB_PATTERN.test(message) ||
    GRANT_NEGATION_GUARD_PATTERN.test(message) ||
    RETRACTION_MARKER_PATTERN.test(message) ||
    DELIBERATIVE_STATEMENT_OPENER.test(trimmed) ||
    MESSAGE_START_MODAL_QUESTION.test(trimmed) ||
    MAY_DISCUSSION_OPENER.test(trimmed) ||
    !isGenuineDirective(message, message)
  ) {
    return null
  }
  const providerMatch = message.match(/\b(exa|parallel)\b/i)
  const amountMatch = message.match(/\$\s?([\d,]+(?:\.\d+)?)/)
  if (!providerMatch || !amountMatch) {
    return null
  }
  const maxSpendUsd = Number(amountMatch[1].replace(/,/g, ''))
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) {
    return null
  }
  return { providerId: PROVIDER_NAME_TO_ID[providerMatch[1].toLowerCase()], maxSpendUsd }
}
