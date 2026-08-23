import { ChevronRight, Folder, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { DirectoryBrowseResult } from '@/lib/onboarding-types'

export function AddProjectRepositoryStep({
  repoPath,
  onRepoPathChange,
  browsing,
  browseError,
  browseOpen,
  browseResult,
  onOpenBrowser,
  onSelectPath,
  onCloseBrowse,
  onNext
}: {
  repoPath: string
  onRepoPathChange: (value: string) => void
  browsing: boolean
  browseError: string | null
  browseOpen: boolean
  browseResult: DirectoryBrowseResult | null
  onOpenBrowser: (dirPath?: string) => void
  onSelectPath: (path: string) => void
  onCloseBrowse: () => void
  onNext: () => void
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Repository path
          </label>
          <div className="flex gap-2">
            <input
              value={repoPath}
              onChange={(e) => onRepoPathChange(e.target.value)}
              placeholder="C:\Users\you\Documents\my-project"
              className="w-full min-w-0 rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button variant="outline" onClick={() => onOpenBrowser()} disabled={browsing}>
              {browsing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Folder className="size-4" />
              )}
              Browse
            </Button>
          </div>
          {browseError && <div className="mt-1.5 text-xs text-destructive">{browseError}</div>}
        </div>

        {browseOpen && browseResult && (
          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="truncate" title={browseResult.path}>
                {browseResult.path}
              </span>
              {browseResult.parent && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onOpenBrowser(browseResult.parent!)}
                >
                  Up
                </Button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto tsf-scrollbar">
              {browseResult.directories.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No subdirectories here.
                </div>
              ) : (
                browseResult.directories.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 truncate text-left"
                      onClick={() => onOpenBrowser(`${browseResult.path}\\${name}`)}
                    >
                      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{name}</span>
                    </button>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => onSelectPath(`${browseResult.path}\\${name}`)}
                    >
                      Select
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between border-t border-border px-3 py-2">
              <Button size="xs" variant="ghost" onClick={onCloseBrowse}>
                Close
              </Button>
              <Button size="xs" onClick={() => onSelectPath(browseResult.path)}>
                Select this folder
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button disabled={!repoPath.trim()} onClick={onNext}>
            Next <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
