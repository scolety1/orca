// CASE-32: the generic (non-ADOPT) verb trigger-vocabulary registry --
// extracted from command-act-model.mjs purely to stay under this repo's
// max-lines budget (self-contained: no dependency on anything else in
// that file, and nothing else in that file's own top-level evaluation
// needs it before this module is loaded).
//
// TSF UI FINDINGS #2-#16, Finding #4: real, narrower phrasings of the exact
// same "another process/agent already owns this, don't touch it" intent
// never matched -- "put X on hold" (own directive, no external-agent claim
// at all) and "a separate process is working on it" (subject-first order,
// "separate" instead of "another"/"different") both fell through to
// ordinary conversation. `put\s+.+?\s+on\s+hold` mirrors ASSESS_SOURCE's own
// established `get\s+.+?\s+up` lazy-wildcard convention so a multi-word
// project name between the verb and its object still matches.
const KEEP_GOING_SOURCE = '(?:keep\\s+going|overnight)'
const ASSESS_SOURCE = '(?:needs?\\s+(?:serious\\s+)?work|get\\s+.+?\\s+up|upgrade|assess)'
const EXTERNAL_HOLD_SOURCE =
  '(?:put\\s+.+?\\s+on\\s+hold|(?:is\\s+)?being\\s+(?:handled|worked\\s+on)\\s+by\\s+(?:another|a\\s+different|a\\s+separate)\\s+(?:ai|agent|process)|(?:another|a\\s+different|a\\s+separate)\\s+(?:ai|agent|process)\\s+(?:is|are)\\s+(?:handling|working\\s+on)\\s+(?:it|that|this|\\S+)|leave\\s+(?:it|that|this|\\S+)\\s+alone|hold\\s+off(?:\\s+on)?)'
const STATUS_QUERY_SOURCE = "(?:status|what'?s\\s+(?:going\\s+on|happening)|how'?s\\s+it\\s+going)"

// Verbs with no existing multi-action execution intent yet (research/fix/
// cancel) still get full boundary/target-scoping protection (never bleed a
// neighboring verb's action onto their target, or vice versa) but map to
// GENERAL downstream -- a real, disclosed gap (server/command-multi-
// action-bridge.mjs's handleEntry safely no-ops/reports status for
// GENERAL), never a silently invented destructive intent.
// Pre-UI Productization V1, Priority 2: RELEASE_HOLD's "release hold" was
// recognized syntactically but wired to ZERO real execution anywhere in
// the codebase (existingMultiActionIntent was GENERAL, a real, confirmed
// gap). Broadened its source pattern to also match "release the hold"/
// "release that hold" (a bare, article-free "release hold" reads
// unnaturally to a real operator) and wired to a real, distinct intent,
// mirroring EXTERNAL_WORK_HOLD's own pattern exactly.
export const VERB_REGISTRY = [
  {
    id: 'EXTERNAL_WORK_HOLD',
    source: EXTERNAL_HOLD_SOURCE,
    existingMultiActionIntent: 'EXTERNAL_WORK_HOLD',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'KEEP_GOING',
    source: KEEP_GOING_SOURCE,
    existingMultiActionIntent: 'START_KEEP_GOING',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'ASSESS',
    source: ASSESS_SOURCE,
    existingMultiActionIntent: 'ASSESS_AND_UPGRADE',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'STATUS_QUERY',
    source: STATUS_QUERY_SOURCE,
    existingMultiActionIntent: 'STATUS_QUERY',
    negatedMultiActionIntent: 'STATUS_QUERY'
  },
  {
    id: 'PAUSE',
    source: 'pause\\w*',
    existingMultiActionIntent: 'PAUSE',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'RESUME',
    source: '(?:resume|continue)\\w*',
    existingMultiActionIntent: 'RESUME',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'RESEARCH',
    source: 'research\\w*',
    existingMultiActionIntent: 'GENERAL',
    negatedMultiActionIntent: 'GENERAL'
  },
  {
    id: 'FIX',
    source: 'fix\\w*',
    existingMultiActionIntent: 'GENERAL',
    negatedMultiActionIntent: 'GENERAL'
  },
  {
    id: 'CANCEL',
    source: '(?:cancel\\w*|reject(?:ed|ing|s)?)',
    existingMultiActionIntent: 'GENERAL',
    negatedMultiActionIntent: 'GENERAL'
  },
  {
    id: 'RELEASE_HOLD',
    source: 'release\\s+(?:the\\s+|that\\s+)?hold\\w*',
    existingMultiActionIntent: 'RELEASE_HOLD',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  }
]
