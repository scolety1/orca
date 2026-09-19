import { Ear, Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { VoiceSession } from '@/lib/voice/use-voice-session'

// Hands-Free Command + Project Manager V1: the mic + hands-free toggle,
// split out of CommandPanel.tsx purely to stay under this repo's max-lines
// budget. Mic never executes directly -- it only ever drives `voice`'s own
// transcript state; CommandPanel's useEffect is the one place that writes a
// final transcript into `draft`, and send() (unchanged) is the one real
// consumer. This file stays TSF-agnostic beyond the prop shape itself.
export function CommandVoiceControls({
  voice,
  handsFreeMode,
  onToggleHandsFree
}: {
  voice: VoiceSession
  handsFreeMode: boolean
  onToggleHandsFree: () => void
}) {
  const micLabel = !voice.supported
    ? 'Voice input unsupported in this browser'
    : voice.listening
      ? 'Stop listening'
      : 'Start voice input'
  const micTitle = !voice.supported
    ? 'Voice input is not supported in this browser -- try Chrome or Edge'
    : voice.listening
      ? 'Listening -- click to stop'
      : 'Click to speak'
  const handsFreeTitle = voice.supported
    ? 'Hands-free: automatically send on final transcript and speak replies'
    : 'Voice input is not supported in this browser -- try Chrome or Edge'
  return (
    <>
      <Button
        variant={voice.listening ? 'default' : 'ghost'}
        size="icon-sm"
        disabled={!voice.supported}
        onClick={() => (voice.listening ? voice.stop() : voice.start())}
        aria-label={micLabel}
        title={micTitle}
      >
        {voice.supported ? (
          <Mic className={cn('size-4', voice.listening && 'animate-pulse')} />
        ) : (
          <MicOff className="size-4" />
        )}
      </Button>
      <Button
        variant={handsFreeMode ? 'default' : 'ghost'}
        size="icon-sm"
        disabled={!voice.supported}
        onClick={onToggleHandsFree}
        aria-label={handsFreeMode ? 'Turn off hands-free mode' : 'Turn on hands-free mode'}
        title={handsFreeTitle}
      >
        <Ear className="size-4" />
      </Button>
    </>
  )
}
