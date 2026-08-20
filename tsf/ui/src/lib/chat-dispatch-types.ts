// M3: opt-in, explicit dispatch placement for a chat-triggered real Orca
// worker -- no silent default (matches chat-dispatch-bridge.mjs's own
// invariant); absent unless Tim fills it in, in which case every other
// message's existing conversational behavior is unchanged. Kept separate
// from lib/types.ts (already at its own line-count limit -- see
// keep-going-types.ts for the same precedent) rather than growing it.
export type ChatPlacement = {
  worktree: string
  agent?: string
}
