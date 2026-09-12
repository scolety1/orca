// Real bug, reproduced twice live (Global Command and per-project Planner
// Chat): a long software/product-engineering mission that merely mentions
// "research"/"dataset" in passing was hijacked into creating a Dataset
// Research ResearchMission, because command-research-bridge.mjs's
// RESEARCH_CREATE_OR_CONTINUE pattern is a bare `/\bresearch\b/` match with
// no awareness of the rest of the message. THE PARENT MISSION INTENT MUST
// WIN -- a software mission may contain research/dataset/evidence/Codex/
// verification as CHILD concepts without becoming a Dataset Research parent.
//
// This module is deliberately narrow: it does not attempt to unify TSF's
// other, already-scattered intent vocabularies (GLOBAL_SCOPES in
// command-scope-classifier.mjs, INTENTS in chat-responder.mjs,
// MULTI_ACTION_INTENTS in command-multi-action-decomposition.mjs,
// RESEARCH_INTENT_PATTERNS in command-research-bridge.mjs -- see that
// file's own "INTENT MODEL RECONCILIATION" comment for why those stay
// separate, file-owned concerns). It exists to answer exactly one
// question -- "does this WHOLE message read as a software/product-
// engineering directive, such that an incidental 'research'/'dataset'
// mention must not promote it into Dataset Research?" -- and is consulted
// from exactly one place: shouldRouteToResearchBridge's
// RESEARCH_CREATE_OR_CONTINUE branch. It is a real, deterministic,
// zero-LLM-call function (this decision must never depend on a live
// planner call that can itself fail/degrade).
export const PARENT_MISSION_INTENTS = Object.freeze({
  SOFTWARE_PRODUCT_ENGINEERING: 'SOFTWARE_PRODUCT_ENGINEERING',
  DATASET_RESEARCH: 'DATASET_RESEARCH',
  PROJECT_CONTROL: 'PROJECT_CONTROL',
  MULTI_PROJECT_ORCHESTRATION: 'MULTI_PROJECT_ORCHESTRATION',
  STATUS_QUERY: 'STATUS_QUERY',
  OTHER: 'OTHER'
})

// TSF Reconcile & Upgrade Protocol V1, Lane 2: recognizes the mission
// brief's own natural-language trigger phrases ("Research this area and
// upgrade it.", "Dogfood this.", "Make this production-ready.", "Figure
// out what we already have and finish it.", "Find what's weak here.",
// "Audit this workflow.", "Compare this part against the best systems
// and improve it.", "Fix anything objectively wrong here."). Lives here
// (not in a separate file that would need to import this one back) so
// shouldSuppressResearchCreation can consult it directly with no
// circular dependency -- domain/reconcile-upgrade-classification.mjs is
// a one-directional, thin wrapper that imports FROM this file, never the
// reverse.
//
// A real, reproduced routing risk this exists to close: several of these
// phrases (most notably "Research this area and upgrade it.") contain
// the bare word "research" with NO nearby software-signal vocabulary --
// left unhandled, classifyParentMissionIntent's own bare `/\bresearch\b/i`
// fallback below would misclassify them as DATASET_RESEARCH, reproducing
// the exact bug this whole module exists to prevent. Checked at the
// HIGHEST priority in shouldSuppressResearchCreation -- even ahead of the
// dataset-construction-shape check -- since an explicit reconcile/audit/
// upgrade directive is a more specific, more intentional signal than a
// generic "does this look like it's building a dataset" heuristic.
const RECONCILE_UPGRADE_TRIGGER_PATTERNS = [
  /\bresearch\b(?:\s+\S+){0,6}?\s+\b(?:and|then)\s+(?:upgrade|improve|fix|finish|productioniz|harden)/i,
  /\bdogfood\s+(?:this|it|that)\b/i,
  /\bmake\s+(?:this|it|that)\s+production[- ]ready\b/i,
  /\bfigure\s+out\s+what\s+we\s+already\s+have\b/i,
  /\bfind\s+what'?s\s+weak\s+here\b/i,
  /\baudit\s+(?:this|the|that)\s+\w+/i,
  /\bcompare\s+this\s+(?:part|area|piece)\s+against\s+the\s+best\s+systems\b/i,
  /\bfix\s+anything\s+objectively\s+wrong\b/i,
  /\bupgrade\s+(?:this|it|that)\s+(?:capability|area|workflow|feature)\b/i,
  /\breconcile\s+(?:and|&)\s+upgrade\b/i
]

export function hasReconcileUpgradeTriggerSignal(message) {
  if (typeof message !== 'string' || !message.trim()) {return false}
  return RECONCILE_UPGRADE_TRIGGER_PATTERNS.some((re) => re.test(message))
}

// "do not/don't/never/no ... research/dataset/ResearchMission", in either
// word order ("research is out of scope"), plus the exact literal the
// mission spec calls out. Unconditional: a negated research-creation
// request must NEVER positively trigger one, regardless of how many
// software signals are also present.
// Adversarial-review finding: the original list only recognized
// do-not/don't/never/no/not as the negating token. "isn't needed", "avoid
// starting X", and "skip the research" are all common, real operator
// phrasings for the exact same negation and were falling straight through
// unrecognized, reproducing the original bug for that phrasing.
const NEGATES_RESEARCH_CREATION_PATTERNS = [
  /\b(?:do not|don'?t|never|no|not)\b(?:\s+\S+){0,6}?\s*\bresearch(?:mission)?\b/i,
  /\b(?:do not|don'?t|never|no|not)\b(?:\s+\S+){0,6}?\s*\bdataset\b/i,
  /\bresearch(?:mission)?\b(?:\s+\S+){0,4}?\s*\b(?:is\s+)?out of scope\b/i,
  /\bdo not ask me for an entity universe\b/i,
  /\bresearch\s+isn'?t\s+needed\b/i,
  /\bno\s+need\s+for\s+(?:a\s+|any\s+)?research\b/i,
  /\bavoid\s+(?:starting\s+)?research\b/i,
  /\bskip\s+the\s+research\b/i
]

export function negatesResearchCreation(message) {
  if (typeof message !== 'string' || !message.trim()) {return false}
  return NEGATES_RESEARCH_CREATION_PATTERNS.some((re) => re.test(message))
}

// Genuine dataset-research CONSTRUCTION shape -- an enumerated entity
// universe and/or fields-to-collect, not just the bare word "research".
// Wins over incidental software words (e.g. "Build a dataset of X" --
// "build" alone is a common, ambiguous software verb, but this phrase is
// the canonical, already-supported dataset-research request shape).
const RESEARCH_CONSTRUCTION_PATTERNS = [
  /\bbuild (?:me )?(?:a )?dataset\s+(?:of|for)\b/i,
  /\bdataset\s+(?:of|for)\b/i,
  /\bresearch\s+(?:every|all|each)\b/i,
  /\bevery\s+\d{4}\b/i, // "every 2008 NFL player"
  /\b\d[\d,]*\s+(?:entities|players|teams|companies|items|records|people|rows|entries|organizations|athletes|ceos)\b/i,
  /\bentity universe\b/i,
  /\bfields? to collect\b/i,
  /\brequested fields?\b/i,
  /\bresearch specification\b/i,
  /\bcollect\b.{0,60}\b(?:source|field|position|team)\b/i
]

export function hasResearchConstructionSignal(message) {
  if (typeof message !== 'string' || !message.trim()) {return false}
  return RESEARCH_CONSTRUCTION_PATTERNS.some((re) => re.test(message))
}

// Strong (2pt) -- unambiguous, TSF/software-specific vocabulary no genuine
// dataset-research request would plausibly use.
const STRONG_SOFTWARE_SIGNAL_PATTERNS = [
  /\bcodex(?:\s+worker)?\b/i,
  /\bverifier\b/i,
  /\bkeep going\b/i,
  /\bworktree(?:s)?\b/i,
  /\bdevops\b/i,
  /\bpull request\b|\bPR\b/,
  /\bREADY_FOR_ADOPTION\b/i,
  /\bmerge --ff-only\b|\bfast-forward\b/i
]

// Weak (1pt) -- ordinary software-engineering vocabulary that is common
// enough on its own to appear incidentally (matches the existing test
// corpus, e.g. "...for the bridge synthesis test" must NOT alone flip a
// message to SOFTWARE_PRODUCT_ENGINEERING).
const WEAK_SOFTWARE_SIGNAL_PATTERNS = [
  /\bfix(?:ing|ed)?\b/i,
  /\brepair(?:ing|ed)?\b/i,
  /\bimplement(?:ing|ed|ation)?\b/i,
  /\bbuild(?:ing)?\b/i,
  /\brepo(?:sitory)?\b/i,
  /\bbranch(?:es)?\b/i,
  /\btests?\b/i,
  /\bUI\b/,
  /\bproduct\b/i,
  /\bengine\b/i,
  /\bservice\b/i,
  /\bcomponent\b/i,
  /\bmigration\b/i,
  /\bsoftware\b/i,
  /\bcode\b/i,
  /\bbug\b/i,
  /\bfeature\b/i,
  /\bendpoint\b/i,
  /\bAPI\b/,
  /\bdatabase\b/i,
  /\bapplication\b|\bapp\b/i,
  /\bdeploy(?:ment)?\b/i,
  /\bfrontend\b|\bbackend\b/i,
  /\bschema\b/i,
  /\brelease\b/i,
  // Adversarial-review finding: "debug"/"resolve"/"ship"/"hotfix"/"get X
  // working|passing" are everyday engineering vocabulary that reproduced
  // the original bug (real messages using them, e.g. "resolve the login
  // bug and research why sessions expire early", scored 0-1 and were not
  // recognized as software-dominant at all).
  /\bdebug(?:ging|ged)?\b/i,
  /\bresolve[ds]?\b/i,
  /\bship(?:ping|ped)?\b/i,
  /\bhotfix(?:es|ed)?\b/i,
  /\bget\s+(?:the\s+|\S+\s+){0,3}(?:working|passing|green)\b/i
]

// Sentence-initial software imperative ("Build feature X.", "Fix the
// engine.") is a strong (2pt) signal even in an otherwise terse message --
// this is what makes short imperative test phrasings like "Build feature
// X. As part of it, research Y." classify correctly without inflating the
// generic weak-word list.
const IMPERATIVE_START_PATTERN = /^\s*(?:fix|repair|implement|build|patch|refactor|deploy|migrate|debug|resolve|ship|hotfix)\b/i

function softwareSignalScore(message) {
  let score = 0
  if (IMPERATIVE_START_PATTERN.test(message)) {score += 2}
  for (const re of STRONG_SOFTWARE_SIGNAL_PATTERNS) {
    if (re.test(message)) {score += 2}
  }
  for (const re of WEAK_SOFTWARE_SIGNAL_PATTERNS) {
    if (re.test(message)) {score += 1}
  }
  return score
}

const SOFTWARE_DOMINANCE_THRESHOLD = 2

// The one real question this module answers for
// command-research-bridge.mjs: should a message that otherwise matched
// RESEARCH_CREATE_OR_CONTINUE's bare research/dataset trigger be refused
// anyway, because the WHOLE message reads as a software mission?
//
// Priority: (0) TSF Reconcile & Upgrade Protocol V1 -- an explicit
// reconcile/audit/upgrade directive (domain/reconcile-upgrade-
// classification.mjs's own trigger phrases, e.g. "Research this area and
// upgrade it.") wins over EVERYTHING below, including the dataset-
// construction check -- this is the most specific, most intentional
// signal a message can carry, and several of its own real example
// phrases contain the bare word "research" with no nearby software
// vocabulary, which would otherwise fall through to this function's own
// bare-`research` default and reproduce the exact bug this whole module
// exists to prevent. (1) a genuine dataset-construction shape (enumerated
// universe/fields-to-collect/explicit "build a dataset of X") always
// wins next, even over an unrelated negation clause elsewhere in the same
// message -- adversarial-review finding: negation used to be checked
// unconditionally first, so a message combining a real, well-formed
// dataset-research request with an unrelated negated clause ("do not
// start a research mission for the software work. Separately: research
// every 2008 NFL player and collect exact routes run, source, team and
// position.") was wrongly refused. (2) otherwise, explicit negation of
// research-creation wins; (3) otherwise, a message needs a software-signal
// score >= SOFTWARE_DOMINANCE_THRESHOLD to be treated as software-
// dominant; (4) the default (a bare, low-signal "research X" message,
// matching every pre-existing supported research phrasing) stays
// eligible for Dataset Research, unchanged from before this fix. Kept in
// sync with classifyParentMissionIntent's own, equivalent ordering below
// -- the two must never disagree on this precedence.
export function shouldSuppressResearchCreation(message) {
  if (typeof message !== 'string' || !message.trim()) {return false}
  if (hasReconcileUpgradeTriggerSignal(message)) {return true}
  if (hasResearchConstructionSignal(message)) {return false}
  if (negatesResearchCreation(message)) {return true}
  return softwareSignalScore(message) >= SOFTWARE_DOMINANCE_THRESHOLD
}

const STATUS_QUERY_PATTERN = /\b(what'?s|what is|how'?s|how is)\s+(running|going|the status|happening)\b|\bstatus\b/i
const MULTI_PROJECT_HINT_PATTERN = /\b(and|then|,)\b.*\b(and|then|,)\b/i // crude: at least two conjunctions/clauses

// Best-effort, advisory-only full classification (not consulted by the
// routing gate above, which only needs shouldSuppressResearchCreation) --
// provided because the mission spec asks for one reconciled parent-intent
// vocabulary. Intentionally simple: this does not attempt to replace or
// out-rank command-scope-classifier.mjs's live-LLM-backed GLOBAL_SCOPES
// classification, which remains the real, authoritative classifier for
// Global Command's own status/advisory/project-required branches.
export function classifyParentMissionIntent(message) {
  if (typeof message !== 'string' || !message.trim()) {return PARENT_MISSION_INTENTS.OTHER}
  // Same precedence as shouldSuppressResearchCreation above: a Reconcile
  // & Upgrade trigger wins first, then construction signal, then
  // negation -- the two functions can never disagree.
  if (hasReconcileUpgradeTriggerSignal(message)) {
    return PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING
  }
  if (hasResearchConstructionSignal(message)) {
    return PARENT_MISSION_INTENTS.DATASET_RESEARCH
  }
  if (negatesResearchCreation(message)) {
    return softwareSignalScore(message) > 0 ? PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING : PARENT_MISSION_INTENTS.OTHER
  }
  if (softwareSignalScore(message) >= SOFTWARE_DOMINANCE_THRESHOLD) {
    return PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING
  }
  if (/\bresearch\b/i.test(message)) {
    return PARENT_MISSION_INTENTS.DATASET_RESEARCH
  }
  if (STATUS_QUERY_PATTERN.test(message)) {
    return PARENT_MISSION_INTENTS.STATUS_QUERY
  }
  if (MULTI_PROJECT_HINT_PATTERN.test(message)) {
    return PARENT_MISSION_INTENTS.MULTI_PROJECT_ORCHESTRATION
  }
  return PARENT_MISSION_INTENTS.OTHER
}
