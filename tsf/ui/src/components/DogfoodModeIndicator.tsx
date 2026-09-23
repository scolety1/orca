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
import { useForegroundPolling } from '@/lib/use-foreground-polling'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import type { DogfoodSession } from '@/lib/dogfood-session-types'

export function DogfoodModeIndicator() {
  const location = useLocation()
  const { data, reload } = useApi(() => api.dogfoodSessions(), [location.pathname])
  // Safety review finding (real): this only refetched on mount/route
  // change, so starting/pausing/ending a session through Command's own
  // chat on the SAME page never updated the badge until the owner
  // navigated -- it could show stale "capturing" after END, or fail to
  // appear at all right after START. Short-interval foreground polling
  // (same primitive HQ's own live-work staleness fix uses) closes this
  // generically without wiring a refresh into every chat call site.
  useForegroundPolling(reload, 4000)
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
  // Owner-trial-prep finding: an ENDED session only ever appears here when
  // its synthesis is stuck (RUNNING past its own end, or FAILED) -- makes
  // that state visible instead of the owner having no idea their rant is
  // still being worked on, or needs a retry.
  const stuckSynthesis = primary.state === 'ENDED'
  const badgeVariant = stuckSynthesis
    ? primary.synthesisStatus === 'FAILED'
      ? 'blocked'
      : 'degraded'
    : primary.state === 'PAUSED'
      ? 'unknown'
      : 'degraded'
  const badgeText = stuckSynthesis
    ? primary.synthesisStatus === 'FAILED'
      ? 'Synthesis retrying'
      : 'Synthesizing...'
    : primary.state === 'PAUSED'
      ? 'Paused'
      : `${primary.transcript.length} captured`
  const titleText = stuckSynthesis
    ? 'Synthesizing your last dogfood session -- nothing to do, this recovers automatically'
    : `${primary.transcript.length} thing(s) captured -- say "end dogfood mode" to finish`
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground"
      title={titleText}
    >
      <Radio className="size-3 animate-pulse text-amber-500" />
      {sessions.length > 1 ? `${sessions.length} dogfood sessions active` : label}
      <Badge variant={badgeVariant} className="ml-auto">
        {badgeText}
      </Badge>
    </div>
  )
}
