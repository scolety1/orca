// A small, machine-readable descriptor of what the PUBLIC web-acquisition
// entrypoint (public-web-source-acquisition.mjs) guarantees about its
// transport. Not a capability registry -- Main TSF may register this
// centrally later; this module only defines the fixed, honest content of
// the descriptor, owned by this worktree.
//
// This describes NETWORK safety only. Passing network preflight never
// implies rights authorization -- see rightsAuthorizationStillRequired.

export const WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1 = Object.freeze({
  schemaVersion: 'WEB_PUBLIC_ACQUISITION_TRANSPORT_CAPABILITY_V1',
  liveRobotsPreflightSupported: true,
  robotsFailureBehavior: 'FAIL_CLOSED_TO_UNKNOWN',
  dnsPinningSupported: true,
  dnsPinningRequiredByPublicEntrypoint: true,
  ordinaryFetchFallbackProhibited: true,
  redirectsRevalidatedAndRepinned: true,
  arbitraryPublicUrlNetworkPreflightStatus: 'NETWORK_SAFE_PREFLIGHT_ONLY',
  rightsAuthorizationStillRequired: true,
  rawHtmlDurableRetentionProhibitedByDefault: true,
  nestedTableWarningAvailable: true
})
