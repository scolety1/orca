import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import { AlertTriangle, Paperclip, SendHorizontal, ShieldAlert, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DecisionBadge } from '@/components/DecisionBadge'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { scrollTranscriptToBottom } from '@/lib/chat-transcript-scroll'
import { extractAttachmentContext } from '@/lib/migration-context-attachments'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import type { ChatMessage, ChatResponse } from '@/lib/types'

type Attachment = {
  name: string
  size: number
  type: string
  extractedText: string | null
}

type CommandMessage = ChatMessage & {
  resolvedProjectIds?: string[]
  scope?: ChatResponse['scope']
}

// Memoized so typing in the composer (draft/attachments/selfRepair state,
// all local to CommandPanel) never re-renders the transcript -- without
// this, every keystroke re-ran react-markdown's parse over EVERY past
// assistant message, real, measurable lag that grows with the
// conversation's length. Props only change when messages/sending actually
// do (a new send, a response landing), never on composer input.
export const CommandTranscript = memo(function CommandTranscript({
  messages,
  sending
}: {
  messages: CommandMessage[]
  sending: boolean
}) {
  if (messages.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-muted-foreground">
        Ask about your fleet, name a project to work on it, or name several to act on them
        together -- e.g. &quot;what&apos;s running right now?&quot; or &quot;get NWR and WorldForge
        ready for work.&quot;
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {messages.map((message, i) => (
        <div
          key={i}
          className={cn(
            'flex flex-col gap-1',
            message.role === 'user' ? 'items-end' : 'items-start'
          )}
        >
          <div
            className={cn(
              'max-w-[85%] overflow-hidden rounded-lg px-3 py-2 text-[13px] leading-relaxed [&_p]:m-0 [&_p+p]:mt-2',
              message.role === 'user'
                ? 'whitespace-pre-wrap bg-primary/15 text-foreground'
                : 'bg-muted text-foreground'
            )}
          >
            {message.role === 'assistant' ? <Markdown>{message.content}</Markdown> : message.content}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {message.decisionClass && <DecisionBadge decisionClass={message.decisionClass} />}
            {message.role === 'assistant' &&
              message.resolvedProjectIds &&
              message.resolvedProjectIds.length > 0 && (
                <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  Targeting:
                  {message.resolvedProjectIds.map((id) => (
                    <Link
                      key={id}
                      to={`/projects/${id}`}
                      className="rounded-full border border-border px-1.5 py-0.5 hover:border-primary/50 hover:text-foreground"
                    >
                      {id}
                    </Link>
                  ))}
                </span>
              )}
            {message.role === 'assistant' &&
              message.scope === 'FLEET' &&
              (!message.resolvedProjectIds || message.resolvedProjectIds.length === 0) && (
                <span className="text-[10px] text-muted-foreground">No specific project</span>
              )}
          </div>
        </div>
      ))}
      {sending && <div className="text-[11px] text-muted-foreground">Command is thinking…</div>}
    </div>
  )
})

// Generalized from PlannerChatPanel.tsx: same message/attachment/sending
// state shape, but no projectId prop at all -- target project(s) are
// resolved server-side per message (project-name-resolver.mjs) and shown
// back here as a "Targeting" chip row. No manual worktree field: Command
// never asks for a filesystem path (chat-dispatch-bridge.mjs's
// ensureWorktreeForDispatch auto-provisions one). History is session-local
// here (not reloaded from a persisted thread on mount) -- a disclosed,
// intentional scope cut for this pass; each turn IS still durably recorded
// server-side per project (or under a shared command thread for fleet-wide
// turns), same as any other chat turn.
// routeContext (optional): the current page's project, if any (Global
// Command Dock V1) -- shown back as a "Context: X" chip so Tim knows what
// page he opened the dock from. Never forced into scope: it's threaded as
// `contextProjectId`, a bounded FALLBACK the server-side resolution only
// consults when the message itself resolves to no project and doesn't
// read as a fleet-wide query -- an explicit named entity in the message
// always wins (see http-server.mjs's chat route). No second Command
// engine, no duplicated resolution logic.
export function CommandPanel({ onActivity, routeContext }: { onActivity?: () => void; routeContext?: { projectId: string; displayName: string } | null } = {}) {
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerLabel, setProviderLabel] = useState<string | null>(null)
  const [live, setLive] = useState<boolean | null>(null)
  // Off by default, per operator decision: TSF self-repair is authorized
  // ONLY by this explicit toggle plus an exact project name match -- never
  // inferred from message prose (domain/self-repair-authority.mjs).
  const [selfRepair, setSelfRepair] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  useAutosizeTextarea(composerRef, draft, { minPx: 36, maxPx: 200 })

  useEffect(() => {
    scrollTranscriptToBottom(viewportRef.current)
  }, [messages, sending])

  async function send() {
    const text = draft.trim()
    if (!text || sending) {
      return
    }
    const attachmentNote = attachments.length
      ? `\n[Attached: ${attachments.map((a) => a.name).join(', ')}]`
      : ''
    setSending(true)
    setError(null)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text + attachmentNote, at: new Date().toISOString() }
    ])
    setDraft('')
    setAttachments([])
    const attachmentMeta = attachments.map((a) => ({
      name: a.name,
      type: a.type || 'unknown',
      extractedText: a.extractedText
    }))
    try {
      const result = await api.chat(
        null,
        text + attachmentNote,
        attachmentMeta,
        undefined,
        selfRepair,
        routeContext?.projectId
      )
      setProviderLabel(result.providerLabel)
      setLive(result.live ?? false)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.text,
          at: new Date().toISOString(),
          decisionClass: result.decisionClass,
          intent: result.intent,
          resolvedProjectIds: result.resolvedProjectIds,
          scope: result.scope
        }
      ])
      onActivity?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Command right now.')
    } finally {
      setSending(false)
    }
  }

  function onFiles(fileList: FileList | null) {
    if (!fileList) {
      return
    }
    Array.from(fileList).forEach((file) => {
      extractAttachmentContext(file).then((extracted) =>
        setAttachments((prev) => [
          ...prev,
          {
            name: extracted.name,
            size: extracted.size,
            type: extracted.type,
            extractedText: extracted.extractedText
          }
        ])
      )
    })
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <div className="text-sm font-semibold">Command</div>
        </div>
        <div
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
          title={providerLabel ?? undefined}
        >
          {live !== null && (
            <span
              className={cn('size-1.5 rounded-full', live ? 'bg-emerald-500' : 'bg-amber-500')}
              aria-hidden
            />
          )}
          <span>{providerLabel ? `Planner: ${providerLabel}` : 'Planner: PLANNER_DEEP'}</span>
        </div>
      </div>
      {routeContext && (
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-0.5">
            Context: {routeContext.displayName}
          </span>
          <span>-- only used if your message doesn&apos;t name a project itself</span>
        </div>
      )}
      <ScrollArea className="tsf-scrollbar flex-1 px-4 py-3" viewportRef={viewportRef}>
        <CommandTranscript messages={messages} sending={sending} />
      </ScrollArea>
      {error && (
        <div className="border-t border-border px-4 py-2 text-[11px] text-destructive">{error}</div>
      )}
      {attachments.length > 0 && (
        <div className="border-t border-border px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground"
              >
                {a.name}
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={`Remove ${a.name}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5 border-t border-border p-3">
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={selfRepair}
            onChange={(e) => setSelfRepair(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          <ShieldAlert className="size-3.5" />
          TSF self-repair mode -- only applies when you name TSF&apos;s own project exactly; every
          other message is unaffected
        </label>
        {selfRepair && (
          <div className="flex items-center gap-1.5 rounded-md border border-status-degraded/40 bg-status-degraded/10 px-2 py-1 text-[10px] text-status-degraded">
            <AlertTriangle className="size-3 shrink-0" />
            Self-repair armed: a real dispatch on TSF&apos;s own project will branch from accepted
            main and stop at Ready for Adoption -- never auto-adopted.
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.txt,.md,.json,.log"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a screenshot or file"
          >
            <Paperclip className="size-4" />
          </Button>
          <Textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="What's running right now? Name a project to work on it..."
            rows={1}
            className="tsf-scrollbar max-h-[200px] min-h-9"
          />
          <Button
            size="icon-sm"
            disabled={!draft.trim() || sending}
            onClick={send}
            aria-label="Send"
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
