import { describe, it, expect } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { CommandVoiceControls } from './CommandVoiceControls'
import type { VoiceSession } from '@/lib/voice/use-voice-session'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Isolated from CommandPanel.test.tsx's own harness deliberately: this
// component has zero react-router-dom / context dependency, so it can be
// exercised directly (props only), unlike full CommandPanel -- see that
// file's own header for why a full-CommandPanel render is out of bounds in
// this worktree.
function fakeVoice(overrides: Partial<VoiceSession> = {}): VoiceSession {
  return {
    supported: true,
    listening: false,
    transcript: '',
    interimTranscript: '',
    error: null,
    start: () => {},
    stop: () => {},
    cancel: () => {},
    speechSupported: true,
    speak: () => {},
    cancelSpeech: () => {},
    ...overrides
  }
}

function render(voice: VoiceSession, handsFreeMode: boolean, onToggleHandsFree: () => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(CommandVoiceControls, { voice, handsFreeMode, onToggleHandsFree }))
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

describe('CommandVoiceControls', () => {
  it('disables both controls and shows the mic-off icon when speech recognition is unsupported', () => {
    const { container, cleanup } = render(fakeVoice({ supported: false }), false, () => {})
    const buttons = container.querySelectorAll('button')
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[1].disabled).toBe(true)
    expect(buttons[0].getAttribute('aria-label')).toMatch(/unsupported/i)
    cleanup()
  })

  it('shows a listening state distinct from the idle state when supported', () => {
    const idle = render(fakeVoice({ listening: false }), false, () => {})
    expect(idle.container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Start voice input'
    )
    idle.cleanup()

    const listening = render(fakeVoice({ listening: true }), false, () => {})
    expect(listening.container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Stop listening'
    )
    listening.cleanup()
  })

  it('calls onToggleHandsFree when the hands-free button is clicked', () => {
    let toggled = 0
    const { container, cleanup } = render(fakeVoice(), false, () => {
      toggled += 1
    })
    const handsFreeButton = container.querySelectorAll('button')[1] as HTMLButtonElement
    act(() => handsFreeButton.click())
    expect(toggled).toBe(1)
    cleanup()
  })
})
