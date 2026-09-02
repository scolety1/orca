// Durable project-name aliases: names an operator commonly uses that never
// literally appear in a project's own id/displayName, resolved to that
// project's real id by project-name-resolver.mjs.
//
// Real gap this closes (recorded operator history,
// tsf/server/.local-state/operator-state.json): "can you get nytheria ready
// for an overnight run" resolved to nothing and needed a manual follow-up
// ("Treat this as the canonical WorldForge/Nytheria project") to actually
// target worldforge-sablewake-live-runtime-repair-v3 -- there was no way for
// the resolver to connect "Nytheria" to that project id on its own.
//
// Defaults are the real, durable aliases known today. TSF_PROJECT_ALIASES_JSON
// lets an operator (or a test, against a disposable fixture project id)
// extend/override them without a code change -- same env-configuration
// convention as TSF_SELF_REPAIR_PROJECT_ID (domain/self-repair-authority.mjs).
const DEFAULT_PROJECT_ALIASES = {
  nytheria: 'worldforge-sablewake-live-runtime-repair-v3',
  worldforge: 'worldforge-sablewake-live-runtime-repair-v3',
  nwr: 'niners-war-room',
  'niners war room': 'niners-war-room'
}

export function loadProjectAliases(env = process.env) {
  const raw = env.TSF_PROJECT_ALIASES_JSON
  if (!raw) {
    return { ...DEFAULT_PROJECT_ALIASES }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed config never crashes resolution -- honest fallback to the
    // real defaults, matching this file's own "never fabricate, degrade
    // safely" convention (self-repair-authority.mjs's unset-env fallback).
    return { ...DEFAULT_PROJECT_ALIASES }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_PROJECT_ALIASES }
  }
  const normalized = {}
  for (const [alias, projectId] of Object.entries(parsed)) {
    if (typeof alias === 'string' && typeof projectId === 'string' && alias.trim()) {
      normalized[alias.toLowerCase()] = projectId
    }
  }
  return { ...DEFAULT_PROJECT_ALIASES, ...normalized }
}

export { DEFAULT_PROJECT_ALIASES }
