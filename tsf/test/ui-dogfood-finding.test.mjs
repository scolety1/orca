import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyAutoFixEligibility,
  classifySeverity,
  deduplicateFindings,
  diffDogfoodRuns,
  normalizeFinding,
  scoreDogfoodFindings,
  shouldIterateAgain
} from '../domain/ui-dogfood-finding.mjs'

test('normalizeFinding rejects an unknown category', () => {
  assert.throws(() => normalizeFinding({ category: 'NOT_REAL', surfaceId: 'x', description: 'x' }))
})

test('normalizeFinding rejects a missing surfaceId/description', () => {
  assert.throws(() => normalizeFinding({ category: 'DEAD_LINK', description: 'x' }))
  assert.throws(() => normalizeFinding({ category: 'DEAD_LINK', surfaceId: 'x' }))
})

test('normalizeFinding defaults objective to true unless explicitly false', () => {
  const finding = normalizeFinding({ category: 'DEAD_LINK', surfaceId: 'x', description: 'y' })
  assert.equal(finding.objective, true)
  const opinion = normalizeFinding({
    category: 'DEAD_LINK',
    surfaceId: 'x',
    description: 'y',
    objective: false
  })
  assert.equal(opinion.objective, false)
})

test('REQUIRED PROOF: subjective aesthetic and layout findings are never auto-fix eligible, regardless of other flags', () => {
  for (const category of ['SUBJECTIVE_AESTHETIC', 'LAYOUT_PROBLEM']) {
    const finding = normalizeFinding({
      category,
      surfaceId: 'x',
      description: 'y',
      blocksCoreFlow: true,
      objective: true
    })
    assert.equal(classifyAutoFixEligibility(finding), false)
  }
})

test('a broken/inaccessible/dead-link/state-loss finding blocking the core flow is P0, otherwise P1', () => {
  for (const category of [
    'BROKEN_INTERACTION',
    'DEAD_LINK',
    'STATE_LOSS',
    'INACCESSIBLE_INTERACTION'
  ]) {
    const blocking = normalizeFinding({
      category,
      surfaceId: 'x',
      description: 'y',
      blocksCoreFlow: true
    })
    const nonBlocking = normalizeFinding({ category, surfaceId: 'x', description: 'y' })
    assert.equal(classifySeverity(blocking), 'P0')
    assert.equal(classifySeverity(nonBlocking), 'P1')
  }
})

test('accessibility defects are only auto-fix eligible when explicitly marked objective', () => {
  const objective = normalizeFinding({
    category: 'ACCESSIBILITY_DEFECT',
    surfaceId: 'x',
    description: 'y',
    objective: true
  })
  const opinion = normalizeFinding({
    category: 'ACCESSIBILITY_DEFECT',
    surfaceId: 'x',
    description: 'y',
    objective: false
  })
  assert.equal(classifyAutoFixEligibility(objective), true)
  assert.equal(classifyAutoFixEligibility(opinion), false)
  assert.equal(classifySeverity(objective), 'P2')
  assert.equal(classifySeverity(opinion), 'P3')
})

test('deduplicateFindings collapses the same surface+category+description across viewports into one, recording occurrences and viewports', () => {
  const findings = [
    normalizeFinding({
      category: 'CLIPPED_CONTENT',
      surfaceId: 's',
      description: 'row overflows its card',
      viewport: 'desktop'
    }),
    normalizeFinding({
      category: 'CLIPPED_CONTENT',
      surfaceId: 's',
      description: 'row overflows its card',
      viewport: 'mobile'
    })
  ]
  const deduped = deduplicateFindings(findings)
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].occurrences, 2)
  assert.deepEqual(deduped[0].viewports.sort(), ['desktop', 'mobile'])
  assert.equal(deduped[0].affectsAllViewports, true)
})

test('deduplicateFindings keeps genuinely different findings distinct', () => {
  const findings = [
    normalizeFinding({ category: 'CLIPPED_CONTENT', surfaceId: 's', description: 'row overflows' }),
    normalizeFinding({ category: 'DEAD_LINK', surfaceId: 's', description: 'row overflows' })
  ]
  assert.equal(deduplicateFindings(findings).length, 2)
})

test('scoreDogfoodFindings produces an honest bySeverity breakdown and auto-fix count', () => {
  const findings = [
    normalizeFinding({
      category: 'BROKEN_INTERACTION',
      surfaceId: 's',
      description: 'a',
      blocksCoreFlow: true
    }),
    normalizeFinding({ category: 'SUBJECTIVE_AESTHETIC', surfaceId: 's', description: 'b' })
  ]
  const scored = scoreDogfoodFindings(findings)
  assert.equal(scored.totalFindings, 2)
  assert.equal(scored.bySeverity.P0, 1)
  assert.equal(scored.bySeverity.P3, 1)
  assert.equal(scored.autoFixEligibleCount, 1)
  assert.equal(scored.blockingCount, 1)
})

test('diffDogfoodRuns reports resolved/persisting/newlyIntroduced by real dedup identity, not array position', () => {
  const before = [
    normalizeFinding({ category: 'DEAD_LINK', surfaceId: 's', description: 'docs 404s' }),
    normalizeFinding({ category: 'DEAD_LINK', surfaceId: 's', description: 'support 404s' })
  ]
  const after = [
    normalizeFinding({ category: 'DEAD_LINK', surfaceId: 's', description: 'support 404s' }),
    normalizeFinding({ category: 'CONSOLE_ERROR', surfaceId: 's', description: 'new regression' })
  ]
  const diff = diffDogfoodRuns(before, after)
  assert.equal(diff.resolvedCount, 1)
  assert.equal(diff.persistingCount, 1)
  assert.equal(diff.newlyIntroducedCount, 1)
  assert.equal(diff.netImprovement, 0)
})

test('REQUIRED PROOF: a regression from a fix always earns another iteration, and the cap always wins regardless', () => {
  const before = [normalizeFinding({ category: 'DEAD_LINK', surfaceId: 's', description: 'a' })]
  const after = [
    normalizeFinding({ category: 'CONSOLE_ERROR', surfaceId: 's', description: 'regression' })
  ]
  const diff = diffDogfoodRuns(before, after)
  assert.equal(shouldIterateAgain(diff, 1, 3), true)
  assert.equal(shouldIterateAgain(diff, 3, 3), false)
})

test('shouldIterateAgain stops once nothing new appeared and nothing real remains', () => {
  const diff = diffDogfoodRuns(
    [normalizeFinding({ category: 'DEAD_LINK', surfaceId: 's', description: 'a' })],
    []
  )
  assert.equal(shouldIterateAgain(diff, 1, 3), false)
})
