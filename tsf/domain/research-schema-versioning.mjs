// Trust + Scale Hardening Phase 14: schema versioning. Every durable
// research record already self-labels its shape via a literal
// `schemaVersion` field (TSF_RESEARCH_MISSION_V1, TSF_VERIFICATION_V1,
// TSF_CONFLICT_V1, ...) -- that convention already existed. What was
// MISSING: nothing ever checked a loaded mission's own top-level
// schemaVersion against what the running code actually understands before
// operating on it. A future schema change (a renamed/removed field, a
// changed invariant) loaded by code that still assumes the old shape would
// silently misinterpret it instead of failing loudly.
//
// This module is deliberately narrow: it does NOT invent a migration
// engine for versions that don't exist yet (that would be exactly the
// "half-implement speculative architecture" this mission's own
// instructions warn against). It gives ONE real, testable seam --
// assertSupportedResearchMissionSchemaVersion, called at every read
// boundary (research-mission-store.mjs) -- that fails closed on an
// unrecognized version today, and is where a real migration function gets
// registered the day a V2 actually ships.
import { deepClone } from './canonical.mjs'

export const CURRENT_RESEARCH_MISSION_SCHEMA_VERSION = 'TSF_RESEARCH_MISSION_V1'

// Every schemaVersion this running code can safely operate on, mapped to
// an optional migrator that upgrades a record of that version to the
// current one. The current version's own migrator is the identity
// function. There is deliberately only one entry today -- this is the
// registration point for a real V2, not a preemptive V2 implementation.
const SCHEMA_MIGRATIONS = new Map([[CURRENT_RESEARCH_MISSION_SCHEMA_VERSION, (mission) => mission]])

export const SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS = Object.freeze([...SCHEMA_MIGRATIONS.keys()])

// Fail-closed: an unrecognized or missing schemaVersion throws rather than
// being silently treated as "close enough" to the current shape. Mirrors
// this codebase's existing fail-closed convention for unknown pricing
// (research-cost-governance.mjs) and unknown reconciliation decision types
// -- unknown must never be coerced into a safe-looking default.
export function assertSupportedResearchMissionSchemaVersion(mission) {
  if (!mission?.schemaVersion) {
    const error = new Error('research mission is missing schemaVersion -- cannot safely determine its shape')
    error.code = 'TSF_RESEARCH_MISSION_SCHEMA_VERSION_MISSING'
    throw error
  }
  if (!SCHEMA_MIGRATIONS.has(mission.schemaVersion)) {
    const error = new Error(
      `unsupported research mission schemaVersion: ${mission.schemaVersion} (this code understands: ${SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS.join(', ')}) -- refusing to operate on a mission shape this code was never verified against`
    )
    error.code = 'TSF_UNSUPPORTED_RESEARCH_MISSION_SCHEMA_VERSION'
    throw error
  }
}

// Upgrades `mission` to CURRENT_RESEARCH_MISSION_SCHEMA_VERSION via its
// registered migrator, or throws via assertSupportedResearchMissionSchemaVersion
// if the version is unrecognized. A no-op today (only one version exists),
// but every read boundary calling this instead of using the raw loaded
// record is what makes a real future migration a one-function change
// rather than an audit of every call site.
export function migrateResearchMissionSchema(mission) {
  assertSupportedResearchMissionSchemaVersion(mission)
  const migrate = SCHEMA_MIGRATIONS.get(mission.schemaVersion)
  return deepClone(migrate(mission))
}
