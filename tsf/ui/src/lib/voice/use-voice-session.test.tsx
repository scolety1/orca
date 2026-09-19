import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { useVoiceSession, type VoiceSession } from './use-voice-session'
import type {
  SpeechRecognitionConstructor,
  SpeechRecognitionWindow
} from './speech-recognition-types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A minimal, real-shaped fake SpeechRecognition -- deliberately implements
// only what use-voice-session.ts actually touches (continuous/
// interimResults/lang, start/stop/abort, on{result,error,end,start}), so a
// test can drive the exact same event callbacks a real browser engine
// would call, without a real microphone or network. Matches
// CommandPanel.test.tsx/command-conversation-context.test.tsx's own
// established "drive react-dom/client directly, no @testing-library/react"
// convention for this worktree. Tracks the most recently constructed
// instance via a static hook rather than aliasing `this` in the
// constructor (this repo's own no-this-alias lint rule).
class FakeSpeechRecognition extends EventTarget {
  static onCreate: ((instance: FakeSpeechRecognition) => void) | null = null

  continuous = false
  interimResults = false
  lang = ''
  onresult: ((event: { resultIndex: number; results: unknown[] }) => void) | null = null
  onerror: ((event: { error: string; message: string }) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  started = false
  aborted = false

  constructor() {
    super()
    FakeSpeechRecognition.onCreate?.(this)
  }

  start() {
    this.started = true
    this.onstart?.()
  }
  stop() {
    this.onend?.()
  }
  abort() {
    this.aborted = true
    this.onend?.()
  }

  emitResult(results: { transcript: string; isFinal: boolean }[], resultIndex = 0) {
    this.onresult?.({
      resultIndex,
      results: results.map((r) =>
        Object.assign([{ transcript: r.transcript, confidence: 1 }], { isFinal: r.isFinal })
      )
    })
  }
}

function makeHarness() {
  let latest: VoiceSession | null = null
  function Probe() {
    latest = useVoiceSession()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(Probe))
  })
  return {
    get session() {
      return latest as VoiceSession
    },
    rerender: () => act(() => root.render(createElement(Probe))),
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

function speechWindow(): SpeechRecognitionWindow {
  return window as unknown as SpeechRecognitionWindow
}

describe('useVoiceSession', () => {
  let originalCtor: SpeechRecognitionConstructor | undefined
  let lastInstance: FakeSpeechRecognition | null

  beforeEach(() => {
    originalCtor = speechWindow().SpeechRecognition
    lastInstance = null
    FakeSpeechRecognition.onCreate = (instance) => {
      lastInstance = instance
    }
    speechWindow().SpeechRecognition =
      FakeSpeechRecognition as unknown as SpeechRecognitionConstructor
  })

  afterEach(() => {
    speechWindow().SpeechRecognition = originalCtor
    FakeSpeechRecognition.onCreate = null
  })

  it('reports supported: true when a real SpeechRecognition constructor exists', () => {
    const h = makeHarness()
    expect(h.session.supported).toBe(true)
    h.cleanup()
  })

  it('reports supported: false, never throws, when no SpeechRecognition constructor exists at all -- the required clear microphone-off state', () => {
    delete speechWindow().SpeechRecognition
    delete speechWindow().webkitSpeechRecognition
    const h = makeHarness()
    expect(h.session.supported).toBe(false)
    h.cleanup()
  })

  it('start() transitions listening to true once the engine reports onstart', () => {
    const h = makeHarness()
    act(() => h.session.start())
    h.rerender()
    expect(h.session.listening).toBe(true)
    expect(lastInstance?.started).toBe(true)
    h.cleanup()
  })

  it('onresult separates interim from final transcript correctly', () => {
    const h = makeHarness()
    act(() => h.session.start())
    act(() => {
      lastInstance!.emitResult([{ transcript: 'hello wor', isFinal: false }])
    })
    h.rerender()
    expect(h.session.interimTranscript).toBe('hello wor')
    expect(h.session.transcript).toBe('')

    act(() => {
      lastInstance!.emitResult([{ transcript: 'hello world', isFinal: true }])
    })
    h.rerender()
    expect(h.session.transcript).toBe('hello world')
    expect(h.session.interimTranscript).toBe('')
    h.cleanup()
  })

  it('stop() ends the session but keeps whatever transcript was already recognized', () => {
    const h = makeHarness()
    act(() => h.session.start())
    act(() => lastInstance!.emitResult([{ transcript: 'keep this', isFinal: true }]))
    act(() => h.session.stop())
    h.rerender()
    expect(h.session.listening).toBe(false)
    expect(h.session.transcript).toBe('keep this')
    h.cleanup()
  })

  it('cancel() aborts and discards everything -- true cancel-before-submission', () => {
    const h = makeHarness()
    act(() => h.session.start())
    act(() => lastInstance!.emitResult([{ transcript: 'discard this', isFinal: true }]))
    act(() => h.session.cancel())
    h.rerender()
    expect(h.session.listening).toBe(false)
    expect(h.session.transcript).toBe('')
    expect(lastInstance?.aborted).toBe(true)
    h.cleanup()
  })

  it('onerror surfaces a real error without throwing', () => {
    const h = makeHarness()
    act(() => h.session.start())
    act(() => {
      lastInstance!.onerror?.({ error: 'no-speech', message: 'no speech detected' })
    })
    h.rerender()
    expect(h.session.error?.code).toBe('no-speech')
    h.cleanup()
  })

  it('a fresh start() clears any leftover transcript from a prior session', () => {
    const h = makeHarness()
    act(() => h.session.start())
    act(() => lastInstance!.emitResult([{ transcript: 'first session', isFinal: true }]))
    act(() => h.session.stop())
    act(() => h.session.start())
    h.rerender()
    expect(h.session.transcript).toBe('')
    h.cleanup()
  })

  it('speechSupported and speak/cancelSpeech never throw regardless of window.speechSynthesis presence', () => {
    const h = makeHarness()
    expect(() => h.session.speak('hello')).not.toThrow()
    expect(() => h.session.cancelSpeech()).not.toThrow()
    h.cleanup()
  })
})
