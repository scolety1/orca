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

// Generic engine shared by every durable top-level record kind this module
// version-guards (currently: research mission, research library). Kept
// private -- callers only ever see the kind-specific exports below, so a
// future kind is a few lines, not a new mechanism.
function buildSchemaVersionGuard(kind, migrations) {
  const supportedVersions = Object.freeze([...migrations.keys()])
  const codeKind = kind.toUpperCase().replace(/\s+/g, '_')
  function assertSupported(record) {
    if (!record?.schemaVersion) {
      const error = new Error(`${kind} is missing schemaVersion -- cannot safely determine its shape`)
      error.code = `TSF_${codeKind}_SCHEMA_VERSION_MISSING`
      throw error
    }
    if (!migrations.has(record.schemaVersion)) {
      const error = new Error(
        `unsupported ${kind} schemaVersion: ${record.schemaVersion} (this code understands: ${supportedVersions.join(', ')}) -- refusing to operate on a shape this code was never verified against`
      )
      error.code = `TSF_UNSUPPORTED_${codeKind}_SCHEMA_VERSION`
      throw error
    }
  }
  function migrate(record) {
    assertSupported(record)
    return deepClone(migrations.get(record.schemaVersion)(record))
  }
  return { supportedVersions, assertSupported, migrate }
}

export const CURRENT_RESEARCH_MISSION_SCHEMA_VERSION = 'TSF_RESEARCH_MISSION_V1'

// Every schemaVersion this running code can safely operate on, mapped to
// an optional migrator that upgrades a record of that version to the
// current one. The current version's own migrator is the identity
// function. There is deliberately only one entry today -- this is the
// registration point for a real V2, not a preemptive V2 implementation.
const missionGuard = buildSchemaVersionGuard('research mission', new Map([[CURRENT_RESEARCH_MISSION_SCHEMA_VERSION, (mission) => mission]]))

export const SUPPORTED_RESEARCH_MISSION_SCHEMA_VERSIONS = missionGuard.supportedVersions

// Fail-closed: an unrecognized or missing schemaVersion throws rather than
// being silently treated as "close enough" to the current shape. Mirrors
// this codebase's existing fail-closed convention for unknown pricing
// (research-cost-governance.mjs) and unknown reconciliation decision types
// -- unknown must never be coerced into a safe-looking default.
export const assertSupportedResearchMissionSchemaVersion = missionGuard.assertSupported

// Upgrades `mission` to CURRENT_RESEARCH_MISSION_SCHEMA_VERSION via its
// registered migrator, or throws via assertSupportedResearchMissionSchemaVersion
// if the version is unrecognized. A no-op today (only one version exists),
// but every read boundary calling this instead of using the raw loaded
// record is what makes a real future migration a one-function change
// rather than an audit of every call site.
export const migrateResearchMissionSchema = missionGuard.migrate

// Same guard, for the OTHER durable top-level singleton this session
// introduced (research-library.mjs). Wired into research-library-store.mjs's
// readResearchLibrary/withResearchLibrary exactly like the mission guard is
// wired into research-mission-store.mjs.
export const CURRENT_RESEARCH_LIBRARY_SCHEMA_VERSION = 'TSF_RESEARCH_LIBRARY_V1'
const libraryGuard = buildSchemaVersionGuard('research library', new Map([[CURRENT_RESEARCH_LIBRARY_SCHEMA_VERSION, (library) => library]]))
export const SUPPORTED_RESEARCH_LIBRARY_SCHEMA_VERSIONS = libraryGuard.supportedVersions
export const assertSupportedResearchLibrarySchemaVersion = libraryGuard.assertSupported
export const migrateResearchLibrarySchema = libraryGuard.migrate

// Same guard, for the Platform Learning Ledger singleton (REQ-002, see
// platform-learning-ledger.mjs). Wired into platform-learning-ledger-store.mjs
// exactly like the mission/library guards are wired into their own stores.
export const CURRENT_PLATFORM_LEARNING_LEDGER_SCHEMA_VERSION = 'TSF_PLATFORM_LEARNING_LEDGER_V1'
const learningLedgerGuard = buildSchemaVersionGuard('platform learning ledger', new Map([[CURRENT_PLATFORM_LEARNING_LEDGER_SCHEMA_VERSION, (ledger) => ledger]]))
export const SUPPORTED_PLATFORM_LEARNING_LEDGER_SCHEMA_VERSIONS = learningLedgerGuard.supportedVersions
export const assertSupportedPlatformLearningLedgerSchemaVersion = learningLedgerGuard.assertSupported
export const migratePlatformLearningLedgerSchema = learningLedgerGuard.migrate
