import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { ChatMessage, ChatResponse } from '@/lib/types'

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
