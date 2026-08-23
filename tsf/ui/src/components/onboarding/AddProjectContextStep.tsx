import { ArrowLeft, ChevronRight, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import type { MigrationContextAttachment } from '@/lib/migration-context-attachments'

export function AddProjectContextStep({
  handoffText,
  onHandoffTextChange,
  attachments,
  attachmentDragActive,
  onDragActiveChange,
  onAddFiles,
  onRemoveAttachment,
  onBack,
  onAnalyze
}: {
  handoffText: string
  onHandoffTextChange: (value: string) => void
  attachments: MigrationContextAttachment[]
  attachmentDragActive: boolean
  onDragActiveChange: (active: boolean) => void
  onAddFiles: (files: FileList | File[]) => void
  onRemoveAttachment: (id: string) => void
  onBack: () => void
  onAnalyze: () => void
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Migration handoff / context (optional)
          </label>
          <Textarea
            value={handoffText}
            onChange={(e) => onHandoffTextChange(e.target.value)}
            placeholder="Paste a summary from the old project chat, if you have one. TSF treats this as evidence, not authority — it will check it against what the repository actually shows."
            rows={6}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Attachments (optional)
          </label>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              onDragActiveChange(true)
            }}
            onDragLeave={() => onDragActiveChange(false)}
            onDrop={(e) => {
              e.preventDefault()
              onDragActiveChange(false)
              if (e.dataTransfer.files.length) {
                onAddFiles(e.dataTransfer.files)
              }
            }}
            className={cn(
              'flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground transition-colors',
              attachmentDragActive && 'border-primary bg-primary/5'
            )}
          >
            <Paperclip className="size-4" />
            <div>Drag files here, or</div>
            <label className="cursor-pointer text-primary underline underline-offset-2">
              choose files
              <input
                type="file"
                multiple
                accept=".md,.txt,.json,.pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    onAddFiles(e.target.files)
                  }
                  e.target.value = ''
                }}
              />
            </label>
            <div className="text-[10px]">
              .md, .txt, .json, .pdf, .docx — read-only evidence, never sent to the repository.
            </div>
          </div>

          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {(a.size / 1024).toFixed(1)} KB
                      </span>
                      {a.extractionStatus === 'EXTRACTED' && (
                        <Badge variant="healthy">extracted</Badge>
                      )}
                      {a.extractionStatus === 'TRUNCATED' && (
                        <Badge variant="degraded">truncated</Badge>
                      )}
                      {(a.extractionStatus === 'UNSUPPORTED_FORMAT' ||
                        a.extractionStatus === 'MALFORMED' ||
                        a.extractionStatus === 'EMPTY') && (
                        <Badge variant="unknown">
                          {a.extractionStatus.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    {a.extractionNote && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {a.extractionNote}
                      </div>
                    )}
                    {a.sha256 && (
                      <div
                        className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground"
                        title={a.sha256}
                      >
                        sha256:{a.sha256.slice(0, 16)}…
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onRemoveAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <Button onClick={onAnalyze}>
            Analyze <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
