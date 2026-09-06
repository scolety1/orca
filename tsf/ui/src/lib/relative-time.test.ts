import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRelativeTime } from './relative-time.ts'

const NOW = new Date('2026-09-06T12:00:00.000Z')

test('seconds/minutes/hours/days each pick the right unit', () => {
  assert.equal(formatRelativeTime('2026-09-06T11:59:42.000Z', NOW), '18s ago')
  assert.equal(formatRelativeTime('2026-09-06T11:55:00.000Z', NOW), '5m ago')
  assert.equal(formatRelativeTime('2026-09-06T09:00:00.000Z', NOW), '3h ago')
  assert.equal(formatRelativeTime('2026-09-04T12:00:00.000Z', NOW), '2d ago')
})

test('a timestamp in the future (clock skew) never shows a negative duration', () => {
  assert.equal(formatRelativeTime('2026-09-06T12:00:05.000Z', NOW), 'just now')
})

test('an unparseable timestamp degrades honestly instead of showing "NaNs ago"', () => {
  assert.equal(formatRelativeTime('not-a-date', NOW), 'unknown')
})
