// Cleanup V1 action taxonomy -- models each destructive action as its own
// class (never one "clean everything" verb), tagged with an authority tier.
// STANDARD classes have a real V0 executor (see server/cleanup-executor*.mjs).
// ELEVATED classes are classified/planned/blocked identically but have NO
// executor wired in V0 -- attempting to execute one always returns
// NOT_IMPLEMENTED_V0_CLASSIFICATION_ONLY (server/cleanup-executor.mjs),
// never falls through to a mutation. Both tiers sit behind the SAME unset
// owner-authorization gate for V0 (see cleanup-owner-authorization-gate.mjs)
// -- the distinction exists in the data model now so a future phase can gate
// ELEVATED behind a stronger/separate grant without a data-model migration.
export const CLEANUP_ACTION_TIERS = Object.freeze(['STANDARD', 'ELEVATED'])

export const CLEANUP_ACTION_CLASSES = Object.freeze({
  RETIRE_SESSION: {
    tier: 'STANDARD',
    reversible: false,
    quarantineFirst: false,
    description: 'Graceful, PID-targeted session/process retirement -- never kill-by-name.'
  },
  REMOVE_DISPOSABLE_WORKTREE: {
    tier: 'STANDARD',
    reversible: true,
    quarantineFirst: true,
    description: 'Removes a clean, unreferenced git worktree via git worktree remove, after quarantining a full copy.'
  },
  DELETE_LOCAL_MERGED_BRANCH: {
    tier: 'STANDARD',
    reversible: false,
    quarantineFirst: false,
    description: 'git branch -d (safe delete) -- git itself refuses a non-merged branch.'
  },
  CLEAR_SAFE_GENERATED_CACHE: {
    tier: 'STANDARD',
    reversible: false,
    quarantineFirst: false,
    description: 'Deletes an allowlisted, always-regenerable cache directory name under a protected-checked root.'
  },
  QUARANTINE_ARTIFACT: {
    tier: 'STANDARD',
    reversible: true,
    quarantineFirst: true,
    description: 'Moves an arbitrary artifact (file or directory) to the quarantine store, leaving a restorable manifest.'
  },
  RESTORE_QUARANTINE: {
    tier: 'STANDARD',
    reversible: true,
    quarantineFirst: false,
    description: 'Restores a previously quarantined artifact back to its original location.'
  },
  REMOVE_STALE_TEMPORARY_STATE: {
    tier: 'STANDARD',
    reversible: false,
    quarantineFirst: false,
    description: 'Deletes files/directories matching an allowlisted temp-state pattern, older than a threshold.'
  },
  // --- Higher-authority classes (V0: classification/planning only) ---
  DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS: {
    tier: 'ELEVATED',
    reversible: false,
    quarantineFirst: false,
    description: 'git branch -D against a branch carrying commits reachable from nowhere else. Real V0 executor (demonstrates the tier distinction is enforced, not just labeled).'
  },
  REMOVE_DIRTY_WORKTREE: {
    tier: 'ELEVATED',
    reversible: false,
    quarantineFirst: false,
    description: 'Worktree removal with uncommitted changes present. NOT_IMPLEMENTED_V0.'
  },
  GIT_PRUNE_GC: {
    tier: 'ELEVATED',
    reversible: false,
    quarantineFirst: false,
    description: 'git prune / git gc -- can make dangling-but-recoverable commits unreachable. NOT_IMPLEMENTED_V0.'
  },
  ARBITRARY_FILESYSTEM_DELETION: {
    tier: 'ELEVATED',
    reversible: false,
    quarantineFirst: false,
    description: 'Unbounded filesystem deletion outside the allowlisted cache/temp patterns. NOT_IMPLEMENTED_V0.'
  },
  PROCESS_TERMINATION: {
    tier: 'ELEVATED',
    reversible: false,
    quarantineFirst: false,
    description: 'Immediate forceful termination with no graceful attempt (distinct from RETIRE_SESSION). NOT_IMPLEMENTED_V0.'
  },
  REMOTE_BRANCH_DELETION: {
    tier: 'ELEVATED',
    reversible: false,
    quarantineFirst: false,
    description: 'git push --delete <remote> <branch> -- affects state outside this host. NOT_IMPLEMENTED_V0.'
  }
})

// Classes with a real V0 executor (server/cleanup-executor*.mjs). Anything
// else dispatched through runGovernedCleanupAction returns
// NOT_IMPLEMENTED_V0_CLASSIFICATION_ONLY -- fail closed, not a silent no-op
// mistaken for success.
export const V0_IMPLEMENTED_ACTION_CLASSES = Object.freeze([
  'RETIRE_SESSION',
  'REMOVE_DISPOSABLE_WORKTREE',
  'DELETE_LOCAL_MERGED_BRANCH',
  'CLEAR_SAFE_GENERATED_CACHE',
  'QUARANTINE_ARTIFACT',
  'RESTORE_QUARANTINE',
  'REMOVE_STALE_TEMPORARY_STATE',
  'DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS'
])

export function isKnownActionClass(actionClass) {
  return Object.hasOwn(CLEANUP_ACTION_CLASSES, actionClass)
}

export function actionClassTier(actionClass) {
  return CLEANUP_ACTION_CLASSES[actionClass]?.tier ?? null
}

export function isV0Implemented(actionClass) {
  return V0_IMPLEMENTED_ACTION_CLASSES.includes(actionClass)
}

export function requiresQuarantineFirst(actionClass) {
  return CLEANUP_ACTION_CLASSES[actionClass]?.quarantineFirst === true
}
