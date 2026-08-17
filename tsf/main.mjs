const FOUNDATION = Object.freeze({
  foundation: 'ORCA',
  upstreamVersion: 'v1.4.184',
  upstreamCommit: '2307f2ebbe1c1e737c0b12d920bb0a208332db2c',
  product: 'Thousand Sunny Fleet — Orca Foundation',
  migrationWave: 4,
  realProjectWork: 'NOT_AUTHORIZED_FOR_THIS_RUNWAY',
  upstreamCoreFilesModified: 0
})

export default function activate(orca) {
  orca.commands.register('tsf-foundation-health', async () => ({ ...FOUNDATION }))
  orca.commands.register('tsf-status', async () => {
    const usage = await orca.host.call('storage.get', { key: 'usageMode' })
    const activeFleet = await orca.host.call('storage.get', { key: 'activeFleet' })
    const workSet = await orca.host.call('storage.get', { key: 'workSet' })
    return {
      ...FOUNDATION,
      usageMode: usage?.value ?? 'BALANCED',
      activeFleet: activeFleet?.value ?? [],
      workSet: workSet?.value ?? [],
      authority: 'STATUS_ONLY_NO_EXECUTION_AUTHORITY'
    }
  })
  orca.commands.register('tsf-set-usage-mode', async (args) => {
    const mode = args?.mode
    if (!['TEST_MINIMAL', 'ECONOMY', 'BALANCED', 'MAXIMUM'].includes(mode)) {
      throw new Error('mode must be TEST_MINIMAL, ECONOMY, BALANCED, or MAXIMUM')
    }
    await orca.host.call('storage.set', { key: 'usageMode', value: mode })
    return { ok: true, mode, authority: 'ROUTING_AND_BUDGET_ONLY' }
  })
  for (const event of ['worktree.created', 'worktree.removed', 'agent.status.changed']) {
    orca.events.on(event, (payload) => {
      orca.log(`TSF observed ${event}: ${JSON.stringify(payload).slice(0, 2048)}`)
    })
  }
}

export { FOUNDATION }
