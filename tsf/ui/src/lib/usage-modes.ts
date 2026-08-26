// Single source of truth for the Usage Modes a real run may actually use --
// mirrors tsf/routing/usage-modes.v1.json's real config entries (validated
// server-side by tsf/domain/usage-mode-validation.mjs). Previously
// StartMissionDialog and StartOvernightFleetDialog each maintained their own
// USAGE_MODES array and had drifted: the overnight dialog listed
// HIGH_ASSURANCE as a live, selectable option even though it's a reserved
// mode with no config entry -- a real run started with it would now be
// rejected outright by the server. Both dialogs derive their options from
// this one list instead of hand-maintained duplicates.
export type UsageMode = 'TEST_MINIMAL' | 'ECONOMY' | 'BALANCED' | 'MAXIMUM'

export const USAGE_MODES: UsageMode[] = ['TEST_MINIMAL', 'ECONOMY', 'BALANCED', 'MAXIMUM']

// Start Overnight Fleet deliberately excludes TEST_MINIMAL (a bounded
// single-step mode makes little sense for unattended overnight work) -- a
// real, pre-existing distinction between the two dialogs, preserved here
// rather than silently unified away.
export const OVERNIGHT_USAGE_MODES: UsageMode[] = USAGE_MODES.filter((m) => m !== 'TEST_MINIMAL')
