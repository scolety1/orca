// Hands-Free Command + Project Manager V1/V2, generic voice layer: a
// TSF-agnostic speech session hook. Zero imports of anything project-
// specific (no @/lib/api, no command-* module, no project-ID concept) --
// intended to be directly reusable, unchanged, by a second product (Colety
// Labs Command) once this one proves the design. The public shape here
// (start/stop/cancel/listening/transcript/error/speak) is the stable
// contract a future realtime provider (OpenAI Realtime, Deepgram) must
// satisfy to be swapped in -- only the internal engine construction below
// (today: the browser's own Web Speech API) would need to change; no
// caller of this hook would need to.
//
// Conversational Hands-Free V2: adds a self-managed continuous session
// (auto re-arm recognition after a natural end, bounded backoff on
// transient errors, never listening while speak() is in progress) --
// this is a GENERIC voice-conversation capability (any product built on
// this hook wants "keep listening across turns without self-
// transcribing"), so it lives here rather than being reimplemented by
// each caller. What stays product-specific, in CommandPanel.tsx: WHEN to
// turn handsFreeMode on/off, and WHAT to do with each transcript.
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SpeechRecognitionConstructor,
  SpeechRecognitionLike,
  SpeechRecognitionWindow
} from './speech-recognition-types'

export type VoiceSessionOptions = {
  continuous?: boolean
  interimResults?: boolean
  lang?: string
  // When true, this hook self-manages a continuous session: a natural
  // recognition end (a completed turn, or a transient no-speech/network
  // hiccup) automatically re-arms listening; recognition is never active
  // while speak() is producing audio, resuming automatically once it
  // finishes. Read fresh on every render (safe to flip live).
  handsFreeMode?: boolean
}

export type VoiceSessionError = {
  code: string
  message: string
  // False once this hook has given up retrying (an unrecoverable provider
  // error, or repeated consecutive failures to even start) -- the mission's
  // own exit condition for hands-free ("...until explicitly turned off, OR
  // an unrecoverable provider error occurs"). A caller owns the actual
  // handsFreeMode toggle state, so it should watch this field and turn
  // that mode off in its own UI when it sees `recoverable: false` while
  // hands-free was on -- this hook only reports the fact, never mutates a
  // toggle it doesn't own.
  recoverable: boolean
}

export type VoiceSession = {
  // Real feature detection -- false (never a guess) when this browser has
  // no SpeechRecognition constructor at all. Every consumer must branch on
  // this for the mission's required "clear microphone-off state" instead
  // of showing a mic control that silently does nothing.
  supported: boolean
  listening: boolean
  // The accumulated FINAL transcript for the current session (cleared by
  // cancel() or a fresh start()) -- never includes not-yet-final words.
  transcript: string
  // The current in-progress (not yet final) segment, updated live while
  // listening -- a caller binding this into a text input gets a genuine
  // live transcript, per the mission's own requirement.
  interimTranscript: string
  error: VoiceSessionError | null
  // Calling start() while speak() is in progress cancels the in-flight
  // speech first (the safest reliable approximation of barge-in this
  // browser API can support -- see this file's own header on why true
  // simultaneous listen-while-speaking isn't attempted; a real
  // PROVIDER LIMITATION, not faked).
  start: () => void
  // Stops listening but keeps whatever was already recognized (transcript
  // stays as-is) -- the browser's own engine finalizes in-flight speech.
  // A deliberate stop always disables auto-restart for that call, even in
  // handsFreeMode -- an explicit stop must stay stopped.
  stop: () => void
  // Aborts immediately and discards everything from this session,
  // including any not-yet-final speech -- true cancel-before-submission.
  // Also always disables auto-restart for that call.
  cancel: () => void
  // Optional spoken output, independently feature-detected from STT --
  // a browser can support one without the other.
  speechSupported: boolean
  // True for the duration of a speak() utterance -- exposed so a caller
  // can show a "speaking" indicator distinct from "listening."
  speaking: boolean
  speak: (text: string) => void
  cancelSpeech: () => void
}

function resolveConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') {
    return null
  }
  const speechWindow = window as unknown as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

// Real Web Speech API error codes (MDN SpeechRecognitionErrorEvent.error):
// a transient condition worth auto-retrying in a continuous session vs. one
// that means retrying blindly would spin forever or re-request a permission
// the owner already declined. 'audio-capture' (no working microphone) and
// 'not-allowed'/'service-not-allowed' (permission denied/blocked) are
// deliberately NOT recoverable -- retrying those never succeeds on its own.
const RECOVERABLE_ERROR_CODES = new Set(['no-speech', 'network', 'aborted'])
const MAX_CONSECUTIVE_START_FAILURES = 4
const RESTART_BACKOFF_MS = [250, 600, 1200, 2500]
const CLEAN_END_RESTART_DELAY_MS = 300
// Real Web Speech no-speech timeouts take several real seconds; a session
// that errors within this floor of its own onstart is essentially
// guaranteed to be a real crash-loop (e.g. an immediate network failure),
// never a normal silence timeout.
const MIN_HEALTHY_SESSION_MS = 1500

export function useVoiceSession(options: VoiceSessionOptions = {}): VoiceSession {
  const { continuous = true, interimResults = true, lang, handsFreeMode = false } = options
  const RecognitionCtor = resolveConstructor()
  const supported = RecognitionCtor != null
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<VoiceSessionError | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const handsFreeModeRef = useRef(handsFreeMode)
  const explicitStopRef = useRef(false)
  const errorHandledRef = useRef(false)
  const consecutiveStartFailuresRef = useRef(0)
  // 0 means "no onstart to credit since the last time this was consumed" --
  // see onerror's own real Codex adversarial-review finding below.
  const startedAtRef = useRef(0)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<() => void>(() => {})
  const speakingRef = useRef(false)

  useEffect(() => {
    handsFreeModeRef.current = handsFreeMode
    // Turning hands-free off mid-flight must cancel any pending auto-
    // restart -- otherwise a scheduled restart from just before the
    // toggle flipped would still fire once and silently re-arm the mic.
    if (!handsFreeMode && restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [handsFreeMode])

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current)
      }
      recognitionRef.current?.abort()
    }
  }, [])

  const scheduleRestart = useCallback((delay: number) => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
    }
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null
      if (handsFreeModeRef.current && !speakingRef.current) {
        startRef.current()
      }
    }, delay)
  }, [])

  const start = useCallback(() => {
    // REAL CODEX ADVERSARIAL-REVIEW FINDING (P0, fixed): a pending
    // auto-restart timer (scheduled 300ms after a natural end, or after a
    // backoff delay) was never cancelled by an explicit start() call --
    // clicking the mic (or any other caller-driven start()) during that
    // gap left the timer armed; it later fired, called start() AGAIN, and
    // that second start() aborted the recognition instance THIS call just
    // created, whose own onend then rescheduled yet another restart --
    // a real abort/restart loop. Any call to start() -- manual or
    // internal -- supersedes whatever was scheduled before it.
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    if (!RecognitionCtor) {
      setError({
        code: 'UNSUPPORTED',
        message: 'Speech recognition is not available in this browser.',
        recoverable: false
      })
      return
    }
    // Calling start() while TSS is speaking is treated as a deliberate
    // interrupt (the safest real approximation of barge-in available --
    // see this file's own header) -- cancel the in-flight utterance first.
    if (speakingRef.current && speechSupported) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      speakingRef.current = false
    }
    // Real regression, caught by this file's own new test: aborting a
    // PREVIOUS instance below fires ITS onend SYNCHRONOUSLY (matching many
    // real engines) -- if explicitStopRef were already false at that
    // point, that old onend would misread this as a natural end and
    // schedule its OWN competing restart, racing this call's brand new
    // instance. Marked deliberate here, before the abort; the new
    // instance's own onend (attached below, its own separate closure)
    // resets it back to false whenever IT actually needs to.
    explicitStopRef.current = true
    // A fresh engine instance per start() -- several real browser
    // implementations refuse to restart a previously stopped/errored
    // instance; this is the simplest contract that works everywhere,
    // matching common real-world practice for this API.
    recognitionRef.current?.abort()
    explicitStopRef.current = false
    const recognition = new RecognitionCtor()
    recognition.continuous = continuous
    recognition.interimResults = interimResults
    if (lang) {
      recognition.lang = lang
    }
    setTranscript('')
    setInterimTranscript('')
    setError(null)
    recognition.onresult = (event) => {
      let finalDelta = ''
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalDelta += text
        } else {
          interim += text
        }
      }
      if (finalDelta) {
        setTranscript((prev) => (prev ? `${prev} ${finalDelta}`.trim() : finalDelta.trim()))
      }
      setInterimTranscript(interim)
    }
    recognition.onerror = (event) => {
      // Real browsers reliably fire onend immediately after onerror (the
      // recognition session ends) -- errorHandledRef tells onend below
      // that THIS decision (whether/how to restart, and at what backoff)
      // is already made here, so onend's own "clean end" 300ms restart
      // never fires right after and silently clobbers a real error's
      // longer backoff delay.
      errorHandledRef.current = true
      const recoverable = RECOVERABLE_ERROR_CODES.has(event.error)
      setError({ code: event.error, message: event.message || event.error, recoverable })
      if (!handsFreeModeRef.current || explicitStopRef.current || !recoverable) {
        return
      }
      // REAL CODEX ADVERSARIAL-REVIEW FINDING (P1, fixed): resetting the
      // failure budget on every onstart meant a session that starts fine
      // and then IMMEDIATELY errors, repeating forever, retried at the
      // shortest 250ms delay indefinitely and never reached the longer
      // backoffs or the bounded give-up state -- onstart fired every
      // single cycle, so the counter could never accumulate. Only a
      // session that was genuinely alive for a real minimum duration
      // before erroring counts as "healthy" now; startedAtRef is consumed
      // (reset to 0) here so a later onstart-less failure (the engine
      // fails before even starting) can never be miscredited from a much
      // earlier successful start or a fake-timer-advanced stale value.
      const trulyStarted = startedAtRef.current > 0
      const aliveMs = trulyStarted ? Date.now() - startedAtRef.current : 0
      startedAtRef.current = 0
      if (trulyStarted && aliveMs >= MIN_HEALTHY_SESSION_MS) {
        consecutiveStartFailuresRef.current = 0
      }
      if (consecutiveStartFailuresRef.current >= MAX_CONSECUTIVE_START_FAILURES) {
        setError({
          code: event.error,
          message: 'Repeated speech recognition errors -- hands-free stopped automatically.',
          recoverable: false
        })
        return
      }
      const delay =
        RESTART_BACKOFF_MS[consecutiveStartFailuresRef.current] ?? RESTART_BACKOFF_MS.at(-1)
      consecutiveStartFailuresRef.current += 1
      scheduleRestart(delay)
    }
    // The browser's own STT-based endpointing (silence/end-of-speech
    // detection) -- this IS "automatic reasonable turn detection if
    // supported," per the mission spec. In handsFreeMode, a natural end
    // (not a deliberate stop/cancel, not preceded by an error already
    // handled above, and not because speak() is about to run)
    // automatically re-arms listening -- outside handsFreeMode, behavior
    // is unchanged from V1: never auto-restarts, a caller wanting another
    // turn calls start() again itself.
    recognition.onend = () => {
      setListening(false)
      setInterimTranscript('')
      if (explicitStopRef.current) {
        explicitStopRef.current = false
        errorHandledRef.current = false
        return
      }
      if (errorHandledRef.current) {
        errorHandledRef.current = false
        return
      }
      if (!handsFreeModeRef.current || speakingRef.current) {
        return
      }
      scheduleRestart(CLEAN_END_RESTART_DELAY_MS)
    }
    recognition.onstart = () => {
      setListening(true)
      startedAtRef.current = Date.now()
    }
    recognitionRef.current = recognition
    recognition.start()
  }, [RecognitionCtor, continuous, interimResults, lang, scheduleRestart, speechSupported])

  useEffect(() => {
    startRef.current = start
  }, [start])

  const stop = useCallback(() => {
    explicitStopRef.current = true
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    recognitionRef.current?.stop()
  }, [])

  const cancel = useCallback(() => {
    explicitStopRef.current = true
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    recognitionRef.current?.abort()
    setListening(false)
    setTranscript('')
    setInterimTranscript('')
  }, [])

  const speak = useCallback(
    (text: string) => {
      if (!speechSupported || !text) {
        return
      }
      // Pause recognition while speaking -- TSF must never transcribe its
      // own spoken response as a user command. This stop is deliberate
      // (explicitStopRef), so onend above never tries to auto-restart from
      // it; the utterance's own onend/onerror below resumes listening
      // instead, once speech genuinely finishes.
      if (recognitionRef.current && listening) {
        explicitStopRef.current = true
        recognitionRef.current.stop()
      }
      // REAL CODEX ADVERSARIAL-REVIEW FINDING (P0, fixed): speakingRef used
      // to become true only inside the utterance's own onstart callback --
      // real SpeechSynthesis.speak() QUEUES the utterance asynchronously,
      // so there was a real window between this call and onstart where
      // speakingRef was still false. A start() call landing in that window
      // (an auto-restart, or the owner clicking the mic) saw
      // speakingRef.current === false, so it did NOT treat itself as a
      // barge-in and just began a fresh recognition session -- which then
      // ran WHILE the queued speech actually started playing moments
      // later, with no guard preventing TSF's own reply from being
      // transcribed as user input. Setting this synchronously, before
      // queueing, closes that window entirely.
      setSpeaking(true)
      speakingRef.current = true
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      const resumeAfterSpeech = () => {
        setSpeaking(false)
        speakingRef.current = false
        if (handsFreeModeRef.current) {
          scheduleRestart(CLEAN_END_RESTART_DELAY_MS)
        }
      }
      utterance.onend = resumeAfterSpeech
      utterance.onerror = resumeAfterSpeech
      window.speechSynthesis.speak(utterance)
    },
    [speechSupported, listening, scheduleRestart]
  )

  const cancelSpeech = useCallback(() => {
    if (speechSupported) {
      window.speechSynthesis.cancel()
    }
    setSpeaking(false)
    speakingRef.current = false
  }, [speechSupported])

  return {
    supported,
    listening,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    cancel,
    speechSupported,
    speaking,
    speak,
    cancelSpeech
  }
}
