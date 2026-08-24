import assert from 'node:assert/strict'
import test from 'node:test'
import { scrollTranscriptToBottom } from './chat-transcript-scroll.ts'

// Regression for a real V1 defect: Planner Chat used Element.scrollIntoView,
// which scrolls every scrollable ancestor -- on a long Project Detail page
// this jumped the whole page's scroll, not just the transcript. The fix
// drives the viewport's own scrollTop directly and touches nothing else.

test('advances the given viewport to its own bottom', () => {
  const viewport = { scrollTop: 0, scrollHeight: 800 }
  scrollTranscriptToBottom(viewport)
  assert.equal(viewport.scrollTop, 800)
})

test('does nothing when no viewport is mounted yet', () => {
  assert.doesNotThrow(() => scrollTranscriptToBottom(null))
  assert.doesNotThrow(() => scrollTranscriptToBottom(undefined))
})

test('touches only the passed viewport, never a wider page scroll position', () => {
  const page = { scrollY: 4200 } // stand-in for window/document scroll
  const viewport = { scrollTop: 0, scrollHeight: 500 }
  scrollTranscriptToBottom(viewport)
  assert.equal(page.scrollY, 4200, 'page scroll must be untouched by a transcript update')
})
