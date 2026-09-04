// Re-snapshots the real pilot's output files from current durable state
// after the source-independence backfill (backfill-nfl-2001-source-
// independence.mjs) -- no new dispatch, no new spend. Leaves
// spend-ledger.json/cache-outcomes.json untouched (real-money records,
// already complete and correct; this backfill added no new dispatches).
import { writeFileSync } from 'node:fs'
import path from 'node:path'

async function main() {
  process.env.TSF_UI_STATE_FILE = path.join(import.meta.dirname, 'server', '.local-state', 'operator-state.nfl-2001-real-pilot.json')
  const { readResearchMissionArtifacts, readResearchMissionCompleteness, readResearchMissionProviderUsage, readResearchMissionReviewItems, readResearchMissionStatus } = await import('./server/research-mission-driver.mjs')
  const { readResearchMission } = await import('./server/research-mission-store.mjs')

  const MISSION_ID = 'mission:nfl-2001-real-pilot'
  const clock = () => new Date()
  const OUT_DIR = path.join(import.meta.dirname, 'fixtures', 'nfl-2001-real-pilot-results')

  const finalMission = readResearchMission(MISSION_ID)
  const status = readResearchMissionStatus(MISSION_ID)
  const completeness = readResearchMissionCompleteness(MISSION_ID, clock)
  const reviewItems = readResearchMissionReviewItems(MISSION_ID)
  const artifacts = readResearchMissionArtifacts(MISSION_ID, clock)
  const usage = readResearchMissionProviderUsage(MISSION_ID)

  writeFileSync(path.join(OUT_DIR, 'mission.json'), JSON.stringify(finalMission, null, 2))
  writeFileSync(path.join(OUT_DIR, 'status.json'), JSON.stringify(status, null, 2))
  writeFileSync(path.join(OUT_DIR, 'completeness.json'), JSON.stringify(completeness, null, 2))
  writeFileSync(path.join(OUT_DIR, 'review-items.json'), JSON.stringify(reviewItems, null, 2))
  writeFileSync(path.join(OUT_DIR, 'provenance-package.json'), JSON.stringify(artifacts, null, 2))
  writeFileSync(path.join(OUT_DIR, 'provider-usage.json'), JSON.stringify(usage, null, 2))

  console.log('Re-snapshot complete. Completeness:', JSON.stringify(completeness, null, 2))
}

main().catch((error) => {
  console.error('RE-SNAPSHOT FAILED:', error)
  process.exit(1)
})
