// TSF Owner Dogfood/Critique Loop V1, Chunk 4: shapes for the minimal
// owner-facing status read (GET /api/dogfood-session).
export type DogfoodTurn = {
  role: string
  content: string
  at: string
}

export type DogfoodSession = {
  id: string
  projectId: string | null
  route: string | null
  // ENDED only appears here when its synthesis is still RUNNING (crash
  // recovery in progress) or FAILED (retry budget not yet exhausted) --
  // see server/http-server.mjs's GET /api/dogfood-session for the filter.
  state: 'ACTIVE' | 'PAUSED' | 'ENDED'
  startedAt: string
  transcript: DogfoodTurn[]
  synthesisStatus: 'RUNNING' | 'DONE' | 'FAILED' | null
}

export type DogfoodSessionsResponse = {
  sessions: DogfoodSession[]
}
