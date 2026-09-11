import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChatMessage, ChatResponse } from '@/lib/types'
import { api } from '@/lib/api'

// Command architecture, Command history rehydration: the durable
// server-side thread (chatThreads.__command__, server/chat-http-routes.mjs)
// already exists and already survives a restart -- the ONE thing missing
// was the visible transcript actually reading it back on mount. Reuses the
// SAME real endpoint/client method PlannerChatPanel.tsx already calls for
// its own (different) thread, GET /api/chat/:projectId with the durable
// Command thread's own real key -- no new endpoint, no second frontend
// chat database. Fetched exactly once, at the provider's own single real
// mount (it sits above the router in App.tsx and never unmounts on
// navigation -- see this file's own header), so dock <-> full-page
// switching never re-fetches or re-triggers this.
const COMMAND_THREAD_ID = '__command__'

// Full Command Mode: the ONE real conversation Command's dock and its
// full-page /command view both show -- lifted out of CommandPanel's own
// former local useState (each mounted instance used to have its own,
// empty state, so navigating dock -> full page -> dock silently dropped
// the whole conversation) into this context, provided once at the app
// root alongside command-dock-context.tsx (open/closed UI chrome stays
// there; the actual conversation DATA lives here -- two focused contexts,
// not one grab-bag). Both CommandPanel instances (dock + full page) read/
// write the SAME state now, so collapsing back to the dock loses nothing:
// history, the in-progress draft, pending attachments, and the last
// resolved provider/live status. No second Command engine, no duplicated
// dispatch path -- this only holds what the existing api.chat() call
// already produces and consumes.
export type CommandAttachment = {
  name: string
  size: number
  type: string
  extractedText: string | null
}

export type CommandMessage = ChatMessage & {
  resolvedProjectIds?: string[]
  scope?: ChatResponse['scope']
}

type CommandConversationContextValue = {
  messages: CommandMessage[]
  addMessage: (message: CommandMessage) => void
  draft: string
  setDraft: (draft: string) => void
  attachments: CommandAttachment[]
  setAttachments: React.Dispatch<React.SetStateAction<CommandAttachment[]>>
  sending: boolean
  setSending: (sending: boolean) => void
  error: string | null
  setError: (error: string | null) => void
  providerLabel: string | null
  setProviderLabel: (label: string | null) => void
  live: boolean | null
  setLive: (live: boolean | null) => void
  selfRepair: boolean
  setSelfRepair: (selfRepair: boolean) => void
}

const CommandConversationContext = createContext<CommandConversationContextValue | null>(null)

export function CommandConversationProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<CommandMessage[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<CommandAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerLabel, setProviderLabel] = useState<string | null>(null)
  const [live, setLive] = useState<boolean | null>(null)
  const [selfRepair, setSelfRepair] = useState(false)
  // Real, honest degrade on failure (e.g. backend not yet reachable at
  // first paint): logs and leaves the transcript empty, never crashes the
  // app or fabricates history. A fresh reload naturally retries via the
  // same effect. `cancelled` guards against setting state after a fast
  // unmount (StrictMode's double-invoke in dev, or a genuinely fast route
  // change before this resolves).
  useEffect(() => {
    let cancelled = false
    api
      .chatHistory(COMMAND_THREAD_ID)
      .then((history) => {
        if (cancelled || history.length === 0) {
          return
        }
        // Only apply the durable history if nothing local has been added
        // in the meantime (a real, if unlikely, race: the user sends a
        // message before this in-flight fetch resolves) -- never clobber
        // a message the operator can already see on screen.
        setMessages((prev) => (prev.length === 0 ? history : prev))
      })
      .catch((err) => {
        console.error('Failed to rehydrate Command history:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const addMessage = useCallback((message: CommandMessage) => {
    setMessages((prev) => [...prev, message])
  }, [])
  const value = useMemo(
    () => ({
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
      setSelfRepair
    }),
    [messages, addMessage, draft, attachments, sending, error, providerLabel, live, selfRepair]
  )
  return (
    <CommandConversationContext.Provider value={value}>{children}</CommandConversationContext.Provider>
  )
}

export function useCommandConversation() {
  const ctx = useContext(CommandConversationContext)
  if (!ctx) {
    throw new Error('useCommandConversation must be used within a CommandConversationProvider')
  }
  return ctx
}
