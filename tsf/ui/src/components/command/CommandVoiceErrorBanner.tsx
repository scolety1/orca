import { isLikelyElectronRuntime } from '@/lib/voice/runtime-environment'
import type { VoiceSessionError } from '@/lib/voice/use-voice-session'

// Conversational Hands-Free V2, Phase 13: real, reported finding --
// Electron's bundled Chromium build fails SpeechRecognition with a bare
// `network` error; the real speech-recognition service is unreachable
// from inside that shell, not a real network outage. A generic provider
// error would tell the owner nothing actionable here; this names the real
// cause and the real fix. Split out of CommandPanel.tsx purely to stay
// under this repo's max-lines budget.
export function CommandVoiceErrorBanner({ error }: { error: VoiceSessionError }) {
  if (isLikelyElectronRuntime() && error.code === 'network') {
    return (
      <>
        Voice recognition isn&apos;t supported in this desktop shell yet.{' '}
        <a
          href={typeof window !== 'undefined' ? window.location.href : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Open TSF in Chrome
        </a>{' '}
        for voice.
      </>
    )
  }
  return <>Voice input: {error.message}</>
}
