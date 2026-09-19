// Hands-Free Command + Project Manager V1, generic voice layer: minimal
// types for the Web Speech API's SpeechRecognition interface -- not shipped
// in the default DOM lib types (@types/dom-speech-recognition exists but
// isn't a dependency here; this file covers exactly what
// use-voice-session.ts actually uses, nothing speculative). Types only, no
// runtime code -- this file has zero TSF-specific knowledge, portable
// unchanged to a second product.
//
// Deliberately NOT a `declare global { interface Window {...} }`
// augmentation: that pattern needs `interface` specifically for TypeScript
// declaration merging (a `type` alias cannot merge with the built-in
// `Window` type), which this repo's own lint config (consistent-type-
// definitions) disallows everywhere else with no exception for this real
// structural case. use-voice-session.ts instead reads
// window.SpeechRecognition/webkitSpeechRecognition through a narrow, local
// type assertion at its one real usage site -- no global augmentation, no
// lint conflict, no risk of two independent files both declaring the same
// global interface.

export type SpeechRecognitionResultLike = {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: { readonly transcript: string; readonly confidence: number }
}

export type SpeechRecognitionEventLike = {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechRecognitionResultLike>
} & Event

export type SpeechRecognitionErrorEventLike = {
  readonly error: string
  readonly message: string
} & Event

export type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
} & EventTarget

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export type SpeechRecognitionWindow = {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}
