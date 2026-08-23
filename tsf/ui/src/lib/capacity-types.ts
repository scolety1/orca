// Mirrors server/capacity-http-routes.mjs's real response shape --
// GET /api/capacity, reshaping the real, unchanged M5 signal. A missing
// reading is always null, never a fabricated remaining/reset figure.
export type CapacityWindow = {
  usedPercent: number
  remainingPercent: number
  resetsAt: number | null
  resetDescription: string | null
}

export type CapacityAction = {
  action: 'PROCEED' | 'DOWNGRADE_WORKER' | 'REDUCE_CONCURRENCY' | 'PAUSE_AND_CHECKPOINT'
  assurance: 'OBSERVED' | 'UNKNOWN'
  reason: string
}

export type ProviderCapacity = {
  id: 'claude' | 'codex'
  available: boolean
  primaryRole: string
  status?: string
  remainingPercent?: number | null
  session?: CapacityWindow | null
  weekly?: CapacityWindow | null
  capacityAction?: CapacityAction | null
}

export type CapacitySnapshot =
  | {
      ok: true
      available: true
      claude: ProviderCapacity
      codex: ProviderCapacity
      observedAt: string
    }
  | { ok: true; available: false; reason?: string; detail?: string; observedAt: string }
