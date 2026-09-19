// Hands-Free Command + Project Manager V1, generic voice layer: a
// TSF-agnostic speech session hook. Zero imports of anything project-
// specific (no @/lib/api, no command-* module, no project-ID concept) --
// intended to be directly reusable, unchanged, by a second product (Colety
// Labs Command) once this one proves the design. The public shape here
// (start/stop/cancel/listening/transcript/error/speak) is the stable
// contract a future realtime provider (OpenAI Realtime, Deepgram) must
// satisfy to be swapped in -- only the internal engine construction below
// (today: the browser's own Web Speech API) would need to change; no
// caller of this hook would need to.
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
}

export type VoiceSessionError = {
  code: string
  message: string
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
  start: () => void
  // Stops listening but keeps whatever was already recognized (transcript
  // stays as-is) -- the browser's own engine finalizes in-flight speech.
  stop: () => void
  // Aborts immediately and discards everything from this session,
  // including any not-yet-final speech -- true cancel-before-submission.
  cancel: () => void
  // Optional spoken output, independently feature-detected from STT --
  // a browser can support one without the other.
  speechSupported: boolean
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

export function useVoiceSession(options: VoiceSessionOptions = {}): VoiceSession {
  const { continuous = true, interimResults = true, lang } = options
  const RecognitionCtor = resolveConstructor()
  const supported = RecognitionCtor != null
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<VoiceSessionError | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const start = useCallback(() => {
    if (!RecognitionCtor) {
      setError({
        code: 'UNSUPPORTED',
        message: 'Speech recognition is not available in this browser.'
      })
      return
    }
    // A fresh engine instance per start() -- several real browser
    // implementations refuse to restart a previously stopped/errored
    // instance; this is the simplest contract that works everywhere,
    // matching common real-world practice for this API.
    recognitionRef.current?.abort()
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
      setError({ code: event.error, message: event.message || event.error })
    }
    // The browser's own STT-based endpointing (silence/end-of-speech
    // detection) -- this IS "automatic reasonable turn detection if
    // supported," per the mission spec; no separate VAD implementation is
    // layered on top. Never auto-restarts here -- a caller wanting
    // continuous multi-turn listening calls start() again; avoiding an
    // internal restart loop keeps this hook's own behavior simple and
    // predictable.
    recognition.onend = () => {
      setListening(false)
      setInterimTranscript('')
    }
    recognition.onstart = () => {
      setListening(true)
    }
    recognitionRef.current = recognition
    recognition.start()
  }, [RecognitionCtor, continuous, interimResults, lang])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const cancel = useCallback(() => {
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
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
    },
    [speechSupported]
  )

  const cancelSpeech = useCallback(() => {
    if (speechSupported) {
      window.speechSynthesis.cancel()
    }
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
    speak,
    cancelSpeech
  }
}
