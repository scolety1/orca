import { memo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import { AlertTriangle, Paperclip, SendHorizontal, ShieldAlert, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DecisionBadge } from '@/components/DecisionBadge'
import { CommandVoiceControls } from '@/components/command/CommandVoiceControls'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { scrollTranscriptToBottom } from '@/lib/chat-transcript-scroll'
import { extractAttachmentContext } from '@/lib/migration-context-attachments'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { useCommandConversation, type CommandMessage } from '@/lib/command-conversation-context'
import { useVoiceSession } from '@/lib/voice/use-voice-session'
import { summarizeForSpeech } from '@/lib/voice/speech-summary'
import { CommandVoiceErrorBanner } from '@/components/command/CommandVoiceErrorBanner'
import { useApi } from '@/lib/use-api'
import { buildGlobalRunStatusItems, globalRunStatusLabel } from '@/lib/global-run-status'
import { isResearchMissionWorkItem, type WorkSummary } from '@/lib/types'

// Hands-Free Command + Project Manager V1: the focused project's own
// display name, resolved from whatever real WorkSummary data the
// background-work line below already fetches (never a second, dedicated
// fetch just for a label) -- falls back to the bare id (still real,
// informative) if the project isn't in any currently-fetched bucket
// (e.g. a fully DONE/quiet project with no active/waiting/needsYou entry).
function resolveFocusDisplayName(work: WorkSummary | null, focusProjectId: string): string {
  if (!work) {
    return focusProjectId
  }
  for (const bucket of [work.active, work.waiting, work.needsYou, work.verifying, work.queued]) {
    for (const item of bucket) {
      if (!isResearchMissionWorkItem(item) && item.id === focusProjectId) {
        return item.displayName
      }
    }
  }
  return focusProjectId
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
        Ask about your fleet, name a project to work on it, or name several to act on them together
        -- e.g. &quot;what&apos;s running right now?&quot; or &quot;get NWR and WorldForge ready for
        work.&quot;
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
            {message.role === 'assistant' ? (
              <Markdown>{message.content}</Markdown>
            ) : (
              message.content
            )}
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
// (held in CommandConversationProvider, not reloaded from a persisted
// thread on mount) -- a disclosed, intentional scope cut for this pass;
// each turn IS still durably recorded server-side per project (or under a
// shared command thread for fleet-wide turns), same as any other chat
// turn. Full Command Mode: the actual conversation state lives in
// useCommandConversation() (command-conversation-context.tsx), not local
// useState -- this component itself is mounted twice (the dock's floating
// panel, the full-page /command view), and both need to show the exact
// same in-progress conversation, draft, and attachments; only DOM refs
// below stay per-mount.
// routeContext (optional): the current page's project, if any (Global
// Command Dock V1) -- shown back as a "Context: X" chip so Tim knows what
// page he opened the dock from. Never forced into scope: it's threaded as
// `contextProjectId`, a bounded FALLBACK the server-side resolution only
// consults when the message itself resolves to no project and doesn't
// read as a fleet-wide query -- an explicit named entity in the message
// always wins (see http-server.mjs's chat route). No second Command
// engine, no duplicated resolution logic.
export function CommandPanel({
  onActivity,
  routeContext
}: {
  onActivity?: () => void
  routeContext?: { projectId: string; displayName: string } | null
} = {}) {
  const {
    messages,
    addMessage,
    draft,
    setDraft,
    attachments,
    setAttachments,
    sending,
    setSending,
    error,
    setError,
    providerLabel,
    setProviderLabel,
    live,
    setLive,
    selfRepair,
    setSelfRepair,
    focusProjectId,
    setFocusProjectId,
    setRecentProjectStack,
    handsFreeMode,
    setHandsFreeMode,
    speakResponses,
    setSpeakResponses
  } = useCommandConversation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  useAutosizeTextarea(composerRef, draft, { minPx: 36, maxPx: 200 })
  // Conversational Hands-Free V2: handsFreeMode is passed straight through
  // to the generic voice layer, which now self-manages the whole continuous
  // session (auto re-arm after a natural end, pause-while-speaking/resume-
  // after) -- CommandPanel only decides WHEN hands-free is on and WHAT to
  // do with a transcript, never HOW the mic session stays alive.
  const voice = useVoiceSession({ handsFreeMode })
  // Background-work compact status line ("NWR · Researching / TSF ·
  // Building") and the focused project's own display name both read this
  // SAME real fetch -- one poll, two uses, never a second dedicated
  // fetch just for a label. Reuses the exact projection
  // GlobalRunStatusIndicator.tsx already uses (api.work() +
  // buildGlobalRunStatusItems/globalRunStatusLabel) rather than a new one.
  const { data: work } = useApi(() => api.work(), [])
  const backgroundWorkItems = work ? buildGlobalRunStatusItems(work) : []

  useEffect(() => {
    scrollTranscriptToBottom(viewportRef.current)
  }, [messages, sending])

  // Hands-Free Command + Project Manager V1: a voice-produced FINAL
  // transcript only ever becomes `draft` text -- this hook has zero
  // knowledge of Command/projects/actions, and the effect below is the one
  // and only place its output is consumed, by writing into the exact same
  // `draft` state typed input already uses. In hands-free mode, that final
  // transcript also auto-sends (through the SAME unchanged `send()` below)
  // instead of waiting for a manual submit.
  useEffect(() => {
    if (!voice.transcript) {
      return
    }
    setDraft(voice.transcript)
    if (handsFreeMode) {
      // REAL DOGFOOD FINDING (round 1, P0, Codex-confirmed): calling
      // send() here with no argument read `draft` via this render's own
      // stale closure -- setDraft() above only SCHEDULES an update, it
      // doesn't mutate `draft` in place, so send() saw whatever `draft`
      // was BEFORE this transcript arrived (empty -> the voice turn was
      // silently dropped; non-empty leftover typed text -> that stale
      // text was sent instead of what was actually spoken). Passing the
      // transcript directly bypasses the stale read entirely.
      send(voice.transcript)
    }
    // Deliberately keyed on voice.transcript alone: this effect should only
    // ever react to a NEW final transcript landing, reading handsFreeMode/
    // send's current values at that moment (not re-running for unrelated
    // re-renders in between, which a full dependency list would cause
    // since `send` is a fresh closure every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [voice.transcript])

  async function send(overrideText?: string) {
    const text = (overrideText ?? draft).trim()
    if (!text || sending) {
      return
    }
    const attachmentNote = attachments.length
      ? `\n[Attached: ${attachments.map((a) => a.name).join(', ')}]`
      : ''
    setSending(true)
    setError(null)
    addMessage({ role: 'user', content: text + attachmentNote, at: new Date().toISOString() })
    setDraft('')
    setAttachments([])
    voice.cancel()
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
      // Hands-Free Command + Project Manager V1: mirrors the durable
      // CURRENT FOCUS / RECENT PROJECT STACK server/domain/command-
      // conversation-focus.mjs just computed -- a read-back, never
      // independently derived client-side. Always present on a real
      // Command-scope response (this call is always projectId: null).
      setFocusProjectId(result.focusProjectId ?? null)
      setRecentProjectStack(result.recentProjectStack ?? [])
      addMessage({
        role: 'assistant',
        content: result.text,
        at: new Date().toISOString(),
        decisionClass: result.decisionClass,
        intent: result.intent,
        resolvedProjectIds: result.resolvedProjectIds,
        scope: result.scope
      })
      onActivity?.()
      // Conversational Hands-Free V2: speak() now internally pauses/resumes
      // recognition around the utterance (see use-voice-session.ts) -- an
      // unconditional voice.start() here right after speak() would race
      // with, and incorrectly cancel, the speech that was just requested
      // (start() treats "called while speaking" as a deliberate barge-in).
      // Only the non-speaking path needs an explicit resume.
      if (handsFreeMode) {
        if (voice.speechSupported && speakResponses) {
          voice.speak(summarizeForSpeech(result.text))
        } else if (voice.supported) {
          voice.start()
        }
      }
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
      {/* Hands-Free Command + Project Manager V1: CURRENT FOCUS, per the
          mission spec's own Voice UX section -- one line, not a dashboard.
          Detailed worker/provider/worktree state stays Inspect/Advanced. */}
      {(focusProjectId || backgroundWorkItems.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          {focusProjectId && (
            <span>
              Talking about:{' '}
              <Link
                to={`/projects/${focusProjectId}`}
                className="font-medium text-foreground hover:underline"
              >
                {resolveFocusDisplayName(work, focusProjectId)}
              </Link>
            </span>
          )}
          {backgroundWorkItems.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              {backgroundWorkItems.slice(0, 4).map((item) => (
                <span key={item.id} className="rounded-full border border-border px-1.5 py-0.5">
                  {item.displayName} · {globalRunStatusLabel(item)}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      <ScrollArea className="tsf-scrollbar flex-1 px-4 py-3" viewportRef={viewportRef}>
        <CommandTranscript messages={messages} sending={sending} />
      </ScrollArea>
      {error && (
        <div className="border-t border-border px-4 py-2 text-[11px] text-destructive">{error}</div>
      )}
      {voice.error && voice.error.code !== 'no-speech' && (
        <div className="border-t border-border px-4 py-2 text-[11px] text-destructive">
          <CommandVoiceErrorBanner error={voice.error} />
        </div>
      )}
      {voice.listening && voice.interimTranscript && (
        <div className="border-t border-border px-4 py-2 text-[11px] italic text-muted-foreground">
          {voice.interimTranscript}
        </div>
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
          <CommandVoiceControls
            voice={voice}
            handsFreeMode={handsFreeMode}
            onToggleHandsFree={() => {
              const next = !handsFreeMode
              setHandsFreeMode(next)
              if (next) {
                // Mission default: hands-free speaks replies unless the
                // owner has already turned that off once this session.
                setSpeakResponses(true)
              } else {
                voice.cancel()
              }
            }}
            speakResponses={speakResponses}
            onToggleSpeakResponses={() => setSpeakResponses(!speakResponses)}
          />
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
            onClick={() => send()}
            aria-label="Send"
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
