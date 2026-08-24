export interface ScrollableViewport {
  scrollTop: number
  scrollHeight: number
}

// Advances the transcript viewport's own scroll position to its bottom.
// Deliberately NOT Element.scrollIntoView: that walks and scrolls every
// scrollable ancestor -- including the page itself -- to bring the target
// into view. Real defect: submitting a Planner Chat message on a long
// Project Detail page jumped the whole page's scroll position, not just
// the transcript. Setting scrollTop directly touches only this element.
export function scrollTranscriptToBottom(viewport: ScrollableViewport | null | undefined): void {
  if (!viewport) {
    return
  }
  viewport.scrollTop = viewport.scrollHeight
}
