// Phase 1 (UI_DOGFOOD_AGENT_V0): the concrete surface-enumeration strategy
// for dogfooding Orca's OWN UI -- the golden target. Reuses the real
// settings-pane navigation idiom the app itself uses in tests/e2e specs
// (`window.__store.getState().openSettingsTarget({pane, repoId})` +
// `.openSettingsPage()`, see tests/e2e/settings-search-responsiveness.spec.ts
// and friends) rather than inventing a second navigation mechanism.
//
// Pane ids are sourced from the real, canonical list in
// src/renderer/src/lib/settings-navigation-types.ts (SETTINGS_NAV_TARGETS)
// -- kept as a plain copy here since that file is React/TS-typed and this
// adapter is plain Node ESM driving a Playwright Page, not a renderer
// import. DEFAULT_ORCA_SETTINGS_PANES is a bounded subset (panes that need
// no extra context like a repoId/hostId) so a V0 dogfood pass completes in
// a reasonable time; ALL_ORCA_SETTINGS_PANES is here for a fuller run.
export const ALL_ORCA_SETTINGS_PANES = Object.freeze([
  'general',
  'integrations',
  'accounts',
  'browser',
  'git',
  'tasks',
  'appearance',
  'input',
  'floating-workspace',
  'terminal',
  'quick-commands',
  'notifications',
  'computer-use',
  'developer-permissions',
  'privacy',
  'advanced',
  'dev',
  'voice',
  'shortcuts',
  'stats',
  'ssh',
  'experimental',
  'plugins',
  'agents',
  'orchestration',
  'artifacts',
  'automations',
  'orca-account',
  'linear',
  'setup-guide',
  'servers',
  'mobile',
  'mobile-emulator'
  // 'repo' deliberately excluded from the pane-id list: it requires a real
  // repoId, so it is offered as its own always-available surface below.
])

export const DEFAULT_ORCA_SETTINGS_PANES = Object.freeze([
  'general',
  'appearance',
  'terminal',
  'notifications',
  'shortcuts',
  'advanced'
])

async function openSettingsPane(page, pane) {
  await page.evaluate((paneId) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available -- is the app built with --mode e2e?')
    }
    store.getState().openSettingsTarget({ pane: paneId, repoId: null })
    store.getState().openSettingsPage()
  }, pane)
  // Why: settings sections render lazily behind the search filter; give the
  // real pane content a moment to mount before the caller starts detecting.
  await page.waitForTimeout(200)
}

function settingsSurface(pane) {
  return {
    id: `settings-${pane}`,
    title: `Settings → ${pane}`,
    description: `The real ${pane} settings pane.`,
    coreFlow: pane === 'general',
    open: (page) => openSettingsPane(page, pane)
  }
}

// Main workspace shell -- the default view before/after any settings
// navigation. coreFlow: true because everything else hangs off it.
const MAIN_SHELL_SURFACE = {
  id: 'main-shell',
  title: 'Main workspace shell',
  description: 'The default terminal/tab workspace, no settings open.',
  coreFlow: true,
  open: async (page) => {
    await page.evaluate(() => window.__store?.getState().closeSettingsPage?.())
    await page.waitForTimeout(100)
  }
}

// Strategy function usable directly as a ui-dogfood-contract.mjs
// surfaceStrategy: `(context) => Surface[]`. `paneIds` bounds which
// settings panes are visited -- defaults to DEFAULT_ORCA_SETTINGS_PANES.
export function buildOrcaSurfaceStrategy({ paneIds = DEFAULT_ORCA_SETTINGS_PANES } = {}) {
  return () => [MAIN_SHELL_SURFACE, ...paneIds.map(settingsSurface)]
}

// A real, generic detector (usable as ui-dogfood-contract.mjs's
// detectSurfaceFindings): after navigating to a settings-* surface, at
// least one real `[data-settings-section]` element must actually render --
// every settings section in the app carries this marker (see e.g.
// GeneralWorkspaceSettingsSection.tsx). No section rendering within a
// short, real wait is a genuine BROKEN_INTERACTION: the navigation call
// succeeded but nothing usable showed up.
export async function detectOrcaSettingsRenderFindings(page, surface) {
  if (!surface.id.startsWith('settings-')) {
    return []
  }
  try {
    await page.waitForSelector('[data-settings-section]', { timeout: 3000, state: 'visible' })
    return []
  } catch {
    return [
      {
        category: 'BROKEN_INTERACTION',
        description: `Navigating to ${surface.title} did not render any real settings section`,
        blocksCoreFlow: surface.coreFlow === true
      }
    ]
  }
}
