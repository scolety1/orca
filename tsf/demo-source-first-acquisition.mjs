// ONE real, safe network call demonstrating source-first bulk acquisition
// against a genuinely license-clear, scraping-permitted source (Wikipedia's
// REST API -- CC-BY-SA content, documented for programmatic use).
// pro-football-reference.com was checked first and its Terms of Service
// explicitly prohibit automated/bot access without written permission
// (confirmed via web search + a blocked robots.txt fetch) -- that source
// is correctly NOT bulk-scraped directly; it remains reachable only
// through the licensed Parallel/Exa research intermediaries already used
// in the bake-off.
import { readFileSync, writeFileSync } from 'node:fs'
import { fetchSourceSnapshot } from './adapters/http-source-adapter.mjs'
import { admitSourceSnapshot } from './domain/research-source-admission.mjs'

const clock = () => new Date()
let mission = JSON.parse(readFileSync('fixtures/captured-bakeoff-results/mission.json', 'utf8'))

const urlByNode = {
  'node:tom-brady': 'https://en.wikipedia.org/api/rest_v1/page/summary/Tom_Brady',
  'node:kurt-warner': 'https://en.wikipedia.org/api/rest_v1/page/summary/Kurt_Warner',
  'node:jim-miller': 'https://en.wikipedia.org/api/rest_v1/page/summary/Jim_Miller_(American_football)'
}

const init = { headers: { 'User-Agent': 'TSF-DatasetResearchEngine-V0/1.0 (bounded research pilot; contact: smcolety@gmail.com)' } }

for (const [nodeId, url] of Object.entries(urlByNode)) {
  let fetched = await fetchSourceSnapshot({ url, init, clock })
  if (!fetched.ok && fetched.httpStatus === 429) {
    await new Promise((r) => setTimeout(r, 3000))
    fetched = await fetchSourceSnapshot({ url, init, clock })
  }
  if (!fetched.ok) {
    console.log(`FETCH FAILED for ${nodeId}: ${fetched.reason} ${fetched.detail}`)
    continue
  }
  const parsed = JSON.parse(fetched.snapshot.rawContent)
  console.log(`${nodeId}: fetched "${parsed.title}" -- ${parsed.description}`)
  mission = admitSourceSnapshot(mission, nodeId, fetched.snapshot, clock, mission.revision)
  // Duplicate-fetch prevention proof: refetch the SAME url immediately and
  // confirm admission is a true no-op (content-hash dedup).
  const refetched = await fetchSourceSnapshot({ url, init, clock })
  const before = mission.revision
  mission = admitSourceSnapshot(mission, nodeId, refetched.snapshot, clock, mission.revision)
  console.log(`  duplicate-fetch admission revision unchanged: ${mission.revision === before}`)
}

writeFileSync('fixtures/captured-bakeoff-results/mission-with-sources.json', JSON.stringify(mission, null, 2))
console.log('Source snapshots per node:', mission.nodes.map((n) => ({ id: n.id, sourceSnapshots: n.sourceSnapshots.length })))
