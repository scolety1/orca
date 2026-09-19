// Conversational Hands-Free V2, generic voice layer: whether this page is
// very likely running inside an Electron-embedded webview rather than a
// real, independent browser tab. Real, reported finding: Electron's
// bundled Chromium build fails Web Speech API's SpeechRecognition with a
// bare `network` error, with no visible browser-level cause -- the actual
// speech-recognition service Web Speech API depends on is unreachable from
// inside that shell. Useful for ANY product embedding this voice layer
// inside an Electron host, not just TSF/Orca.
export function isLikelyElectronRuntime(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /electron/i.test(navigator.userAgent)
}
