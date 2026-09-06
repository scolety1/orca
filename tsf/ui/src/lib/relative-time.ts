// Small, dependency-free "18s ago" / "4m ago" formatter for activity
// timestamps (HQ's Active Research, Work's per-item rows). `now` is
// injectable so tests are deterministic -- never Date.now() baked in.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return 'unknown'
  }
  const deltaMs = now.getTime() - then
  if (deltaMs < 0) {
    return 'just now'
  }
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
