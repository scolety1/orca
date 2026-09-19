import { describe, it, expect, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { CommandVoiceErrorBanner } from './CommandVoiceErrorBanner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render(error: { code: string; message: string; recoverable: boolean }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(CommandVoiceErrorBanner, { error }))
  })
  return {
    text: container.textContent ?? '',
    hasLink: !!container.querySelector('a[href]'),
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

describe('CommandVoiceErrorBanner', () => {
  const originalUserAgent = navigator.userAgent

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true
    })
  })

  it('shows the real provider error message in a real browser', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Chrome/130.0.0.0',
      configurable: true
    })
    const { text, hasLink, cleanup } = render({
      code: 'not-allowed',
      message: 'permission denied',
      recoverable: false
    })
    expect(text).toContain('permission denied')
    expect(hasLink).toBe(false)
    cleanup()
  })

  it('shows the real, actionable Electron-shell message and an Open-in-Chrome link for a network error inside Electron', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Orca/1.0.0 Electron/33.0.0 Chrome/130.0.0.0',
      configurable: true
    })
    const { text, hasLink, cleanup } = render({
      code: 'network',
      message: 'network error',
      recoverable: true
    })
    expect(text).toMatch(/isn.t supported in this desktop shell/i)
    expect(hasLink).toBe(true)
    cleanup()
  })

  it('a network error in a real (non-Electron) browser still shows the plain provider message', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Chrome/130.0.0.0',
      configurable: true
    })
    const { text, hasLink, cleanup } = render({
      code: 'network',
      message: 'a real transient network error',
      recoverable: true
    })
    expect(text).toContain('a real transient network error')
    expect(hasLink).toBe(false)
    cleanup()
  })
})
