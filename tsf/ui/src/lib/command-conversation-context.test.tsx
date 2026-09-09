import { describe, it, expect } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { CommandConversationProvider, useCommandConversation } from './command-conversation-context'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Full Command Mode's real, load-bearing property: the dock's floating
// CommandPanel and the full-page /command CommandPanel are two SEPARATE
// mounts of the same component -- this proves the conversation itself
// (messages/draft/attachments/etc) is genuinely shared between them via
// CommandConversationProvider, not silently reset per mount the way local
// useState was before this change. Deliberately avoids @testing-library/
// react (a real, disclosed react-dom-instance-mixing crash in this
// worktree -- see CommandPanel.test.tsx's own header) by driving
// react-dom/client directly, same as that existing test.
function Reader({ testId }: { testId: string }) {
  const { messages, draft } = useCommandConversation()
  return createElement(
    'div',
    { 'data-testid': testId },
    createElement('span', { 'data-testid': `${testId}-count` }, String(messages.length)),
    createElement('span', { 'data-testid': `${testId}-draft` }, draft)
  )
}

function Writer() {
  const { addMessage, setDraft } = useCommandConversation()
  return createElement('button', {
    'data-testid': 'writer',
    onClick: () => {
      addMessage({ role: 'user', content: 'hello', at: new Date().toISOString() })
      setDraft('in progress')
    }
  })
}

describe('CommandConversationProvider', () => {
  it('shares one conversation across two separately-mounted consumers, like the dock panel and the full page', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        createElement(
          CommandConversationProvider,
          null,
          createElement(Writer),
          createElement(Reader, { testId: 'dock' })
        )
      )
    })

    const writer = container.querySelector('[data-testid="writer"]') as HTMLButtonElement
    act(() => writer.click())

    expect(container.querySelector('[data-testid="dock-count"]')?.textContent).toBe('1')
    expect(container.querySelector('[data-testid="dock-draft"]')?.textContent).toBe('in progress')

    // Simulate "collapse the dock, open the full page": the dock's own
    // Reader unmounts, a brand-new Reader mounts under the SAME still-
    // mounted provider (exactly how CommandConversationProvider sits above
    // the router in App.tsx, so it never unmounts on navigation) -- the
    // fresh mount must see the SAME state, not a reset one.
    act(() => {
      root.render(createElement(CommandConversationProvider, null, createElement(Reader, { testId: 'full-page' })))
    })

    expect(container.querySelector('[data-testid="full-page-count"]')?.textContent).toBe('1')
    expect(container.querySelector('[data-testid="full-page-draft"]')?.textContent).toBe('in progress')

    act(() => root.unmount())
    container.remove()
  })

  it('throws a clear error when used outside the provider, never silently returning undefined state', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const originalConsoleError = console.error
    console.error = () => {}
    expect(() => {
      act(() => {
        root.render(createElement(Reader, { testId: 'unwrapped' }))
      })
    }).toThrow(/useCommandConversation must be used within/)
    console.error = originalConsoleError
    root.unmount()
    container.remove()
  })
})
