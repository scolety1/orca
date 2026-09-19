import { Ear, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { VoiceSession } from '@/lib/voice/use-voice-session'

// Hands-Free Command + Project Manager V1/V2: the mic + hands-free +
// speak-responses controls, split out of CommandPanel.tsx purely to stay
// under this repo's max-lines budget. Mic never executes directly -- it
// only ever drives `voice`'s own transcript state; CommandPanel's useEffect
// is the one place that writes a final transcript into `draft`, and send()
// (unchanged) is the one real consumer. This file stays TSF-agnostic
// beyond the prop shape itself.
export function CommandVoiceControls({
  voice,
  handsFreeMode,
  onToggleHandsFree,
  speakResponses,
  onToggleSpeakResponses
}: {
  voice: VoiceSession
  handsFreeMode: boolean
  onToggleHandsFree: () => void
  speakResponses: boolean
  onToggleSpeakResponses: () => void
}) {
  const micLabel = !voice.supported
    ? 'Voice input unsupported in this browser'
    : voice.speaking
      ? 'Interrupt and start listening'
      : voice.listening
        ? 'Stop listening'
        : 'Start voice input'
  const micTitle = !voice.supported
    ? 'Voice input is not supported in this browser -- try Chrome or Edge'
    : voice.speaking
      ? 'TSF is speaking -- click to interrupt and start listening'
      : voice.listening
        ? 'Listening -- click to stop'
        : 'Click to speak'
  const handsFreeTitle = voice.supported
    ? 'Hands-free: stays listening across turns and speaks replies'
    : 'Voice input is not supported in this browser -- try Chrome or Edge'
  return (
    <>
      <Button
        variant={voice.listening ? 'default' : voice.speaking ? 'secondary' : 'ghost'}
        size="icon-sm"
        disabled={!voice.supported}
        onClick={() => (voice.listening ? voice.stop() : voice.start())}
        aria-label={micLabel}
        title={micTitle}
      >
        {voice.supported ? (
          <Mic className={cn('size-4', (voice.listening || voice.speaking) && 'animate-pulse')} />
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
      {handsFreeMode && voice.speechSupported && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSpeakResponses}
          aria-label={speakResponses ? 'Turn off spoken replies' : 'Turn on spoken replies'}
          title={
            speakResponses
              ? 'Speaking replies aloud -- click to switch to visible-only'
              : 'Replies are visible only -- click to also hear them'
          }
        >
          {speakResponses ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </Button>
      )}
    </>
  )
}
