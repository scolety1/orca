import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DOGFOOD_VIEWPORTS,
  enumerateSurfaces,
  normalizeSurface
} from '../domain/ui-dogfood-surface-catalog.mjs'

test('normalizeSurface rejects a missing id/title/open', () => {
  assert.throws(() => normalizeSurface({ title: 't', open: () => {} }))
  assert.throws(() => normalizeSurface({ id: 'x', open: () => {} }))
  assert.throws(() => normalizeSurface({ id: 'x', title: 't' }))
})

test('normalizeSurface fills in real defaults', () => {
  const surface = normalizeSurface({ id: 'x', title: 't', open: () => {} })
  assert.equal(surface.description, '')
  assert.deepEqual(surface.keywords, [])
  assert.equal(surface.coreFlow, false)
})

test('enumerateSurfaces accepts a plain array strategy', () => {
  const surfaces = enumerateSurfaces([{ id: 'a', title: 'A', open: () => {} }], {})
  assert.equal(surfaces.length, 1)
  assert.equal(surfaces[0].id, 'a')
})

test('enumerateSurfaces accepts a function strategy given the real context', () => {
  const strategy = (context) => [{ id: context.tag, title: 'T', open: () => {} }]
  const surfaces = enumerateSurfaces(strategy, { tag: 'from-context' })
  assert.equal(surfaces[0].id, 'from-context')
})

test('enumerateSurfaces rejects a strategy that does not return an array', () => {
  assert.throws(() => enumerateSurfaces(() => ({ not: 'an array' }), {}))
})

test('DOGFOOD_VIEWPORTS covers desktop/laptop/mobile with distinct, real dimensions', () => {
  const ids = Object.keys(DOGFOOD_VIEWPORTS)
  assert.deepEqual(ids.sort(), ['desktop', 'laptop', 'mobile'])
  const widths = new Set(Object.values(DOGFOOD_VIEWPORTS).map((v) => v.width))
  assert.equal(widths.size, 3)
})
