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
//
// Despite the filename, this has become the shared home for every durable
// top-level TSF record's schema-version guard (research library, Platform
// Learning Ledger, planner-mission checkpoint, Keep Going run) via the ONE
// generic engine below -- not a second mechanism per record kind. A future
// rename to something like durable-schema-versioning.mjs is a pure move,
// not attempted here to keep Finding F4's diff scoped to the actual gap.
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

// Same guard, for the planner-mission checkpoint (PLANNER_CONTEXT_LIFECYCLE_V0
// 2C, see planner-mission-checkpoint.mjs) -- Finding F4 (Autonomous
// Reliability Hardening Overnight V1, Phase 1): this durable record had no
// schema-version guard at all, unlike every other top-level singleton this
// module already covers. Wired into planner-mission-store.mjs's
// readPlannerMissionRecord/readAllPlannerMissionRecords/withPlannerMissionRecord.
// The lease half of a planner-mission record carries no schemaVersion of its
// own (it's a small TTL/holder tuple, not an independently-versioned shape --
// see planner-mission-lease.mjs) so only the checkpoint is guarded here.
export const CURRENT_PLANNER_MISSION_CHECKPOINT_SCHEMA_VERSION = 'TSF_PLANNER_MISSION_CHECKPOINT_V1'
const plannerMissionCheckpointGuard = buildSchemaVersionGuard(
  'planner mission checkpoint',
  new Map([[CURRENT_PLANNER_MISSION_CHECKPOINT_SCHEMA_VERSION, (checkpoint) => checkpoint]])
)
export const SUPPORTED_PLANNER_MISSION_CHECKPOINT_SCHEMA_VERSIONS = plannerMissionCheckpointGuard.supportedVersions
export const assertSupportedPlannerMissionCheckpointSchemaVersion = plannerMissionCheckpointGuard.assertSupported
export const migratePlannerMissionCheckpointSchema = plannerMissionCheckpointGuard.migrate

// Same guard, for the Keep Going overnight run record (see keep-going.mjs's
// createOvernightRun, schemaVersion 'TSF_OVERNIGHT_RUN_V1'). Wired into
// keep-going-run-store.mjs's readKeepGoingRun/withKeepGoingRun -- Finding F4,
// same gap as the planner-mission checkpoint above.
export const CURRENT_KEEP_GOING_RUN_SCHEMA_VERSION = 'TSF_OVERNIGHT_RUN_V1'
const keepGoingRunGuard = buildSchemaVersionGuard('Keep Going run', new Map([[CURRENT_KEEP_GOING_RUN_SCHEMA_VERSION, (run) => run]]))
export const SUPPORTED_KEEP_GOING_RUN_SCHEMA_VERSIONS = keepGoingRunGuard.supportedVersions
export const assertSupportedKeepGoingRunSchemaVersion = keepGoingRunGuard.assertSupported
export const migrateKeepGoingRunSchema = keepGoingRunGuard.migrate

// Same guard, for the Native Self-Improvement Loop V1 generic finding record
// (see self-improvement-finding.mjs's createFinding, schemaVersion
// 'TSF_SELF_IMPROVEMENT_FINDING_V1'). Wired into
// self-improvement-finding-store.mjs's readFinding/readAllFindings/
// withFinding -- same F4 gap-avoidance as every guard above.
export const CURRENT_SELF_IMPROVEMENT_FINDING_SCHEMA_VERSION = 'TSF_SELF_IMPROVEMENT_FINDING_V1'
const selfImprovementFindingGuard = buildSchemaVersionGuard(
  'self-improvement finding',
  new Map([[CURRENT_SELF_IMPROVEMENT_FINDING_SCHEMA_VERSION, (finding) => finding]])
)
export const SUPPORTED_SELF_IMPROVEMENT_FINDING_SCHEMA_VERSIONS = selfImprovementFindingGuard.supportedVersions
export const assertSupportedSelfImprovementFindingSchemaVersion = selfImprovementFindingGuard.assertSupported
export const migrateSelfImprovementFindingSchema = selfImprovementFindingGuard.migrate

// Same guard, for Operator Attention V1's durable notification event record
// (see attention-notification-event.mjs's createAttentionNotificationEvent,
// schemaVersion 'TSF_ATTENTION_NOTIFICATION_EVENT_V1'). Wired into
// attention-notification-event-store.mjs's listAttentionNotificationEvents/
// withAttentionNotificationEvent -- same fail-closed discipline as every
// guard above. Literal string re-declared here (not imported) to match this
// module's own established convention for every guard above it.
export const CURRENT_ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION = 'TSF_ATTENTION_NOTIFICATION_EVENT_V1'
const attentionNotificationEventGuard = buildSchemaVersionGuard(
  'attention notification event',
  new Map([[CURRENT_ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION, (event) => event]])
)
export const SUPPORTED_ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSIONS = attentionNotificationEventGuard.supportedVersions
export const assertSupportedAttentionNotificationEventSchemaVersion = attentionNotificationEventGuard.assertSupported
export const migrateAttentionNotificationEventSchema = attentionNotificationEventGuard.migrate
