import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { useVoiceSession, type VoiceSession, type VoiceSessionOptions } from './use-voice-session'
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
  // Simulates an engine that fails before ever reaching onstart (a genuine
  // real-world failure-to-start, distinct from "started fine, then errored
  // later") -- used to test the bounded consecutive-failure budget, which
  // must only count THIS kind of failure, never a healthy start followed
  // by an ordinary later error.
  static nextStartFails = false

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
    if (FakeSpeechRecognition.nextStartFails) {
      this.emitError('network')
      return
    }
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

  // Real browsers reliably fire onend immediately after onerror (the
  // recognition session ends) -- mirrored here so tests exercise the same
  // cascade use-voice-session.ts's own errorHandledRef is designed against.
  emitError(error: string, message = '') {
    this.onerror?.({ error, message })
    this.onend?.()
  }
}

function makeHarness(initialOptions: VoiceSessionOptions = {}) {
  let latest: VoiceSession | null = null
  let currentOptions = initialOptions
  function Probe() {
    latest = useVoiceSession(currentOptions)
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
    setOptions: (next: VoiceSessionOptions) => {
      currentOptions = next
      act(() => root.render(createElement(Probe)))
    },
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    }
  }
}

function speechWindow(): SpeechRecognitionWindow {
  return window as unknown as SpeechRecognitionWindow
}

// A minimal fake SpeechSynthesisUtterance/window.speechSynthesis -- only
// what use-voice-session.ts's speak()/cancelSpeech touch (onstart/onend/
// onerror callbacks, speak()/cancel()). Lets a test drive TTS lifecycle
// events deterministically, same convention as FakeSpeechRecognition above.
class FakeUtterance {
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}

function installFakeSpeechSynthesis() {
  let current: FakeUtterance | null = null
  const synth = {
    speak: (utterance: FakeUtterance) => {
      current = utterance
      utterance.onstart?.()
    },
    cancel: () => {
      current = null
    }
  }
  ;(window as unknown as { speechSynthesis: typeof synth }).speechSynthesis = synth
  ;(
    globalThis as unknown as { SpeechSynthesisUtterance: typeof FakeUtterance }
  ).SpeechSynthesisUtterance = FakeUtterance
  return {
    finishSpeaking: () => current?.onend?.(),
    errorSpeaking: () => current?.onerror?.()
  }
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
    FakeSpeechRecognition.nextStartFails = false
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

  describe('Conversational Hands-Free V2: continuous session', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('handsFreeMode: false (default/V1) never auto-restarts after a natural onend', () => {
      const h = makeHarness({ handsFreeMode: false })
      act(() => h.session.start())
      act(() => lastInstance!.onend?.())
      act(() => vi.advanceTimersByTime(5000))
      h.rerender()
      expect(h.session.listening).toBe(false)
      h.cleanup()
    })

    it('handsFreeMode: true auto-restarts listening after a natural onend (a completed turn)', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      const firstInstance = lastInstance
      act(() => lastInstance!.onend?.())
      act(() => vi.advanceTimersByTime(1000))
      h.rerender()
      expect(h.session.listening).toBe(true)
      expect(lastInstance).not.toBe(firstInstance)
      h.cleanup()
    })

    it('an explicit stop() during handsFreeMode never auto-restarts', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      act(() => h.session.stop())
      act(() => vi.advanceTimersByTime(5000))
      h.rerender()
      expect(h.session.listening).toBe(false)
      h.cleanup()
    })

    it('an explicit cancel() during handsFreeMode never auto-restarts', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      act(() => h.session.cancel())
      act(() => vi.advanceTimersByTime(5000))
      h.rerender()
      expect(h.session.listening).toBe(false)
      h.cleanup()
    })

    it('a recoverable error (no-speech) auto-restarts with bounded backoff in handsFreeMode', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      act(() => lastInstance!.emitError('no-speech'))
      h.rerender()
      expect(h.session.listening).toBe(false)
      act(() => vi.advanceTimersByTime(300))
      h.rerender()
      expect(h.session.listening).toBe(true)
      h.cleanup()
    })

    it('an unrecoverable error (not-allowed) never auto-restarts, and is reported as such', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      act(() => lastInstance!.emitError('not-allowed', 'denied'))
      act(() => vi.advanceTimersByTime(5000))
      h.rerender()
      expect(h.session.listening).toBe(false)
      expect(h.session.error?.code).toBe('not-allowed')
      expect(h.session.error?.recoverable).toBe(false)
      h.cleanup()
    })

    it('repeated consecutive failures-to-start give up after the bounded budget, reporting recoverable: false', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      // The very first start() above already succeeds (onstart fires) --
      // flip to "engine fails before onstart" for every restart the auto-
      // recovery loop attempts from here, simulating a real crash-loop.
      FakeSpeechRecognition.nextStartFails = true
      act(() => lastInstance!.emitError('network'))
      for (let i = 0; i < 6; i += 1) {
        act(() => vi.advanceTimersByTime(3000))
      }
      h.rerender()
      expect(h.session.error?.recoverable).toBe(false)
      h.cleanup()
    })

    it('a long session with many ordinary no-speech re-arm cycles never runs out of retries (onstart resets the failure budget)', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      for (let i = 0; i < 10; i += 1) {
        // Each cycle: the engine genuinely starts (resetting the budget),
        // then times out on silence -- a normal, expected, endlessly
        // repeatable pattern for a real long hands-free conversation.
        act(() => lastInstance!.onend?.())
        act(() => vi.advanceTimersByTime(300))
      }
      h.rerender()
      expect(h.session.listening).toBe(true)
      expect(h.session.error).toBe(null)
      h.cleanup()
    })

    it('turning handsFreeMode off cancels a pending scheduled restart', () => {
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      act(() => lastInstance!.onend?.())
      h.setOptions({ handsFreeMode: false })
      act(() => vi.advanceTimersByTime(5000))
      h.rerender()
      expect(h.session.listening).toBe(false)
      h.cleanup()
    })

    it('speak() pauses recognition while speaking (no self-transcription) and resumes after in handsFreeMode', () => {
      const tts = installFakeSpeechSynthesis()
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.start())
      expect(h.session.listening).toBe(true)

      act(() => h.session.speak('TSF is waiting on verification.'))
      h.rerender()
      expect(h.session.speaking).toBe(true)
      expect(h.session.listening).toBe(false)

      act(() => tts.finishSpeaking())
      act(() => vi.advanceTimersByTime(300))
      h.rerender()
      expect(h.session.speaking).toBe(false)
      expect(h.session.listening).toBe(true)
      h.cleanup()
    })

    it('speak() does not resume listening afterward when handsFreeMode is off', () => {
      const tts = installFakeSpeechSynthesis()
      const h = makeHarness({ handsFreeMode: false })
      act(() => h.session.start())
      act(() => h.session.speak('a normal tap-to-talk response'))
      act(() => tts.finishSpeaking())
      act(() => vi.advanceTimersByTime(300))
      h.rerender()
      expect(h.session.listening).toBe(false)
      h.cleanup()
    })

    it('calling start() while TSF is speaking cancels the in-flight speech (the safest real approximation of barge-in)', () => {
      const tts = installFakeSpeechSynthesis()
      const h = makeHarness({ handsFreeMode: true })
      act(() => h.session.speak('a long spoken response the owner wants to interrupt'))
      h.rerender()
      expect(h.session.speaking).toBe(true)

      act(() => h.session.start())
      h.rerender()
      expect(h.session.speaking).toBe(false)
      expect(h.session.listening).toBe(true)
      void tts
      h.cleanup()
    })
  })
})
