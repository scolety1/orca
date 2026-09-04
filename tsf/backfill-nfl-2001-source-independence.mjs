// Bounded-defect correction (real-pilot independent-verification finding):
// the pilot's source-independence classification loop matched only the
// literal publisher string 'Wikipedia' (what the synthetic deterministic-
// acquisition worker sets), missing the two REAL Parallel-dispatched
// sources (Brady, Favre) whose citation extraction returns the page title
// instead (e.g. "Tom Brady - Wikipedia"). Both are genuinely the same
// source type (en.wikipedia.org). This performs zero new network calls and
// zero new spend -- it only backfills durable metadata on the ALREADY-
// completed real pilot mission, using the same URL-domain match now fixed
// in run-nfl-2001-real-pilot.mjs itself (for any future re-run).
import path from 'node:path'

async function main() {
  process.env.TSF_UI_STATE_FILE = path.join(import.meta.dirname, 'server', '.local-state', 'operator-state.nfl-2001-real-pilot.json')
  const { readResearchMission, withResearchMission } = await import('./server/research-mission-store.mjs')
  const { recordSourceIndependenceMetadata } = await import('./domain/research-source-independence.mjs')

  const MISSION_ID = 'mission:nfl-2001-real-pilot'
  const isWikipediaSource = (src) => /(^|\.)wikipedia\.org(\/|$)/i.test(src.url ?? '')

  let mission = readResearchMission(MISSION_ID)
  if (!mission) throw new Error(`mission not found: ${MISSION_ID}`)

  let classified = 0
  let alreadyClassified = 0
  for (const node of mission.nodes) {
    for (const src of node.sourceReferences ?? []) {
      if (!isWikipediaSource(src)) continue
      if (src.sourceQualityClass) { alreadyClassified += 1; continue }
      mission = await withResearchMission(MISSION_ID, (m) => recordSourceIndependenceMetadata(m, node.id, src.id, { sourceQualityClass: 'AGGREGATOR', independenceState: 'UNKNOWN' }, () => new Date(), m.revision))
      classified += 1
      console.log(`classified ${node.id} / ${src.id} (${src.publisher}) as AGGREGATOR/UNKNOWN`)
    }
  }
  console.log(`Backfill complete: ${classified} newly classified, ${alreadyClassified} already classified.`)

  const stillUnset = mission.nodes.flatMap((n) => (n.sourceReferences ?? []).filter((s) => !s.sourceQualityClass))
  console.log(`Sources with no sourceQualityClass remaining: ${stillUnset.length}`, stillUnset.map((s) => s.publisher))
}

main().catch((error) => {
  console.error('BACKFILL FAILED:', error)
  process.exit(1)
})
