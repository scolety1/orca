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
  state: 'ACTIVE' | 'PAUSED'
  startedAt: string
  transcript: DogfoodTurn[]
}

export type DogfoodSessionsResponse = {
  sessions: DogfoodSession[]
}
