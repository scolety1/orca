// Single source of truth for which Usage Mode values a real run may
// actually use. HIGH_ASSURANCE is a named, reserved mode (see
// tsf/routing/usage-modes.v1.json -- it has no config entry) -- both the
// global POST /api/usage-mode route and startKeepGoingRun call this same
// function so a per-project Keep Going run can never silently accept
// HIGH_ASSURANCE (or any other unrecognized string) even though the
// platform calls it reserved everywhere else.
import usageModes from '../routing/usage-modes.v1.json' with { type: 'json' }

export function assertUsageModeAllowed(mode) {
  const validModes = Object.keys(usageModes.modes)
  if (!validModes.includes(mode)) {
    const error = new Error(
      `usageMode must be one of ${validModes.join(', ')} (HIGH_ASSURANCE is reserved, not yet available)`
    )
    error.code = 'TSF_USAGE_MODE_RESERVED'
    throw error
  }
}
