import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, useState, act } from 'react'
import { createRoot } from 'react-dom/client'

// React 19 requires this to be told explicitly it's running under a test
// harness driving `act()` manually, or it prints a benign-but-noisy
// "not configured to support act" warning on every act() call.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Real, measurable anti-pattern this test proves fixed: `draft` (composer
// text) and `messages` (transcript) used to live in the SAME component, so
// every keystroke re-rendered the whole transcript, re-invoking
// react-markdown's parser for every past assistant message. The fix
// extracts the transcript into `CommandTranscript`, wrapped in
// `React.memo`, so it only re-renders when messages/sending actually
// change -- never on unrelated composer-state churn.
//
// This deliberately does NOT import CommandPanel/@testing-library/react/
// react-router-dom: this worktree's tsf/ui has its own separate local
// react/react-dom install (matched pair, 19.2.8) distinct from the
// pnpm-hoisted root copy @testing-library/react/react-router-dom pull
// react-dom from, and mixing the two crashes with "Invalid hook call" (two
// react-dom instances, neither aware of the other's dispatcher) -- a real
// environment-install gap in this bounded worktree, not a defect in the
// fix. Driving `react-dom/client` directly keeps every import on the ONE
// matched local pair, and a minimal test-only harness reproduces the exact
// "sibling composer state" shape CommandPanel actually has, without
// needing react-router-dom at all.
const markdownRenderCount = vi.fn()
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    markdownRenderCount()
    return createElement('div', { 'data-testid': 'markdown-body' }, children)
  }
}))

const { CommandTranscript } = await import('./CommandPanel')

function Harness({ messages, sending }: { messages: Parameters<typeof CommandTranscript>[0]['messages']; sending: boolean }) {
  // Mirrors CommandPanel's own shape: composer `draft` state lives
  // alongside the transcript, in the same component.
  const [draft, setDraft] = useState('')
  return createElement(
    'div',
    null,
    createElement('input', {
      'data-testid': 'composer',
      value: draft,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value)
    }),
    createElement(CommandTranscript, { messages, sending })
  )
}

beforeEach(() => markdownRenderCount.mockClear())

describe('CommandTranscript memoization', () => {
  it('does not re-render (react-markdown does not re-parse) while sibling composer state changes', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const messages = [{ role: 'assistant' as const, content: 'Everything is green.', at: new Date().toISOString() }]

    act(() => {
      root.render(createElement(Harness, { messages, sending: false }))
    })
    const renderCountAfterMount = markdownRenderCount.mock.calls.length
    expect(renderCountAfterMount).toBeGreaterThan(0)
    expect(container.querySelector('[data-testid="markdown-body"]')?.textContent).toBe('Everything is green.')

    const composer = container.querySelector('[data-testid="composer"]') as HTMLInputElement
    // Plain `composer.value = x` doesn't trip React's own value tracker (a
    // known gotcha -- see testing-library/dom's fireEvent), so onChange
    // never fires and the test silently exercises nothing. Setting through
    // the native property descriptor's setter is what actually notifies
    // React the DOM value changed.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    for (const value of ['f', 'fo', 'foo', 'foo ', 'foo b']) {
      act(() => {
        nativeValueSetter.call(composer, value)
        composer.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(composer.value).toBe('foo b')

    // The real regression: each keystroke above used to re-render the
    // whole transcript (unmemoized), re-invoking react-markdown once per
    // keystroke per historical message. Memoized, `messages`/`sending`
    // never changed, so react-markdown must not have run again.
    expect(markdownRenderCount.mock.calls.length).toBe(renderCountAfterMount)

    act(() => root.unmount())
    container.remove()
  })
})
