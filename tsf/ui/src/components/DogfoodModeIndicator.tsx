// TSF Owner Dogfood/Critique Loop V1, Chunk 4: the minimal owner-facing
// UI surface. Renders NOTHING when no session is open (the common case)
// -- shows a small persistent badge only while a session is ACTIVE/PAUSED,
// so the owner never has to scroll back through chat to remember whether
// they're still recording. Starting/pausing/resuming/ending a session
// all stay conversational through Command's own chat, matching how
// pause/resume/hold/adopt already work in this codebase -- this
// component adds visibility only, never a second control surface for the
// same action. Mounted once in AppShell.tsx, same convention as
// GlobalRunStatusIndicator/SystemStatusIndicator.
import { useLocation } from 'react-router-dom'
import { Radio } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import type { DogfoodSession } from '@/lib/dogfood-session-types'

export function DogfoodModeIndicator() {
  const location = useLocation()
  const { data } = useApi(() => api.dogfoodSessions(), [location.pathname])
  const sessions = (data?.sessions ?? []) as DogfoodSession[]
  if (sessions.length === 0) {
    return null
  }
  // Multiple simultaneous sessions (a global one plus a project-scoped
  // one) are structurally possible -- shows the total count and the most
  // relevant single session's own detail rather than a list, matching
  // "keep it minimal" over a full multi-session picker.
  const primary = sessions[0]
  const label = primary.projectId ? `Dogfood: ${primary.projectId}` : 'Dogfood Mode'
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground"
      title={`${primary.transcript.length} thing(s) captured -- say "end dogfood mode" to finish`}
    >
      <Radio className="size-3 animate-pulse text-amber-500" />
      {sessions.length > 1 ? `${sessions.length} dogfood sessions active` : label}
      <Badge variant={primary.state === 'PAUSED' ? 'unknown' : 'degraded'} className="ml-auto">
        {primary.state === 'PAUSED' ? 'Paused' : `${primary.transcript.length} captured`}
      </Badge>
    </div>
  )
}
