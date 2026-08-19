import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'

export function RefreshProjectButton({ projectId, onRefreshed }: { projectId: string; onRefreshed: () => void }) {
  const [refreshing, setRefreshing] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setRefreshing(true)
    setError(null)
    setSummary(null)
    try {
      const result = await api.refreshOnboardedProject(projectId)
      const changed = Object.entries(result.changes)
        .filter(([, v]) => v)
        .map(([k]) => k)
      setSummary(changed.length ? `Updated: ${changed.join(', ')}.` : 'No changes since last analysis.')
      onRefreshed()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refresh project state.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
        {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        Refresh Project State
      </Button>
      {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
