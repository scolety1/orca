import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { Paperclip, SendHorizontal, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DecisionBadge } from '@/components/DecisionBadge'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { scrollTranscriptToBottom } from '@/lib/chat-transcript-scroll'
import { loadChatDraft, saveChatDraft } from '@/lib/chat-draft-storage'
import type { ChatMessage } from '@/lib/types'

type Attachment = {
  name: string
  size: number
  type: string
  dataUrl: string
}

// Hand-rolled on our own primitives rather than a pulled-in chat library.
// We evaluated @assistant-ui/react (MIT, active, shadcn-themeable) — it's a
// reasonable future upgrade if Planner Chat grows streaming/tool-call needs,
// but V1's surface (message list + composer + attachments) didn't need its
// weight, and hand-rolling keeps zero risk of an unverified API mismatch.
// The backend contract (POST /api/chat) is what keeps this vendor-neutral —
// swapping the responder for a real PLANNER_DEEP call changes no UI code.
export function PlannerChatPanel({
  projectId,
  projectName
}: {
  projectId: string | null
  projectName: string | null
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerLabel, setProviderLabel] = useState<string | null>(null)
  const [live, setLive] = useState<boolean | null>(null)
  // M3: opt-in worktree for a real chat-triggered dispatch -- empty by
  // default, so every existing conversational behavior is unchanged unless
  // Tim deliberately fills this in (chat-dispatch-bridge.mjs's own "no
  // silent default" invariant, now honored from the UI too).
  const [dispatchWorktree, setDispatchWorktree] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMessages([])
    setError(null)
    setProviderLabel(null)
    setLive(null)
    // A real, caught-before-commit gap: leaving a project's worktree in
    // this field would silently attach it to whatever project is selected
    // next -- a genuine cross-project dispatch leak, not just stale UI
    // state. Must clear on every project switch, same as the other fields
    // above.
    setDispatchWorktree('')
    // Real V1 gap: TSF backend recovery reloads/re-navigates the page,
    // which can throw away chat text Tim was halfway through typing.
    // Restore whatever was persisted for this project (empty if none) --
    // this also fixes a project switch previously carrying another
    // project's in-progress draft into the new composer.
    setDraft(projectId ? loadChatDraft(projectId) : '')
    if (!projectId) {
      return
    }
    api
      .chatHistory(projectId)
      .then(setMessages)
      .catch(() => undefined)
  }, [projectId])

  // Real V1 stabilization finding: scrollIntoView scrolls every scrollable
  // ancestor, not just this panel -- on a long Project Detail page it
  // jumped the whole page's scroll position on send/receive. Drive the
  // transcript viewport's own scrollTop instead so nothing outside this
  // panel ever moves.
  useEffect(() => {
    scrollTranscriptToBottom(viewportRef.current)
  }, [messages, sending])

  // Persists on every keystroke, not via a reactive effect keyed on
  // `draft`: an effect would also fire right after the project-switch
  // effect loads a *different* project's draft into state, momentarily
  // writing the old project's text under the new project's key.
  function updateDraft(text: string) {
    setDraft(text)
    if (projectId) {
      saveChatDraft(projectId, text)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || !projectId || sending) {
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
    updateDraft('')
    setAttachments([])
    const attachmentMeta = attachments.map((a) => ({ name: a.name, type: a.type || 'unknown' }))
    const worktree = dispatchWorktree.trim()
    try {
      const result = await api.chat(
        projectId,
        text + attachmentNote,
        attachmentMeta,
        worktree ? { worktree } : undefined
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
          intent: result.intent
        }
      ])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the planner right now.')
    } finally {
      setSending(false)
    }
  }

  function onFiles(fileList: FileList | null) {
    if (!fileList) {
      return
    }
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () =>
        setAttachments((prev) => [
          ...prev,
          { name: file.name, size: file.size, type: file.type, dataUrl: String(reader.result) }
        ])
      reader.readAsDataURL(file)
    })
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <div className="text-sm font-semibold">Planner Chat</div>
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
      <ScrollArea className="tsf-scrollbar flex-1 px-4 py-3" viewportRef={viewportRef}>
        {!projectId ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            Select a project to talk with its planner.
          </div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            Ask anything about <span className="text-foreground">{projectName}</span> — status,
            what&apos;s next, whether it&apos;s done, or leave feedback.
          </div>
        ) : (
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
                  {message.role === 'assistant' ? (
                    <Markdown>{message.content}</Markdown>
                  ) : (
                    message.content
                  )}
                </div>
                {message.decisionClass && <DecisionBadge decisionClass={message.decisionClass} />}
              </div>
            ))}
            {sending && (
              <div className="text-[11px] text-muted-foreground">Planner is thinking…</div>
            )}
          </div>
        )}
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
          <div className="mt-1 text-[10px] text-muted-foreground">
            Filenames are sent as context; contents aren&apos;t processed yet.
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5 border-t border-border p-3">
        {projectId && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="dispatch-worktree"
              className="text-[10px] whitespace-nowrap text-muted-foreground"
            >
              Worktree (optional — enables a real dispatch)
            </label>
            <input
              id="dispatch-worktree"
              type="text"
              value={dispatchWorktree}
              onChange={(e) => setDispatchWorktree(e.target.value)}
              placeholder="e.g. C:/path/to/worktree"
              className="w-full rounded-md border border-input bg-input px-2 py-1 text-[11px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
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
            disabled={!projectId}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a screenshot or file"
          >
            <Paperclip className="size-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={
              projectId ? "What's going on with this project?" : 'Select a project first'
            }
            disabled={!projectId}
            rows={1}
            className="min-h-9"
          />
          <Button
            size="icon-sm"
            disabled={!projectId || !draft.trim() || sending}
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
