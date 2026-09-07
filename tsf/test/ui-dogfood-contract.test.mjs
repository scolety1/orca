import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeLaunchDescriptor,
  runDogfoodPass,
  runIterativeDogfood
} from '../domain/ui-dogfood-contract.mjs'

function fakePage() {
  return {
    setViewportSize: async () => {},
    evaluate: async () => {},
    waitForTimeout: async () => {}
  }
}

function fakeCaptureFactory(consoleErrors = []) {
  return () => ({ consoleErrors: [...consoleErrors], failedRequests: [], reset() {}, detach() {} })
}

const TWO_SURFACES = () => [
  { id: 'home', title: 'Home', open: async () => {} },
  { id: 'settings', title: 'Settings', open: async () => {} }
]

test('normalizeLaunchDescriptor requires targetId/launch/surfaceStrategy and validates viewports', () => {
  assert.throws(() => normalizeLaunchDescriptor({}))
  assert.throws(() => normalizeLaunchDescriptor({ targetId: 't' }))
  assert.throws(() =>
    normalizeLaunchDescriptor({
      targetId: 't',
      launch: async () => {},
      surfaceStrategy: [],
      viewports: ['not-real']
    })
  )
  const ok = normalizeLaunchDescriptor({
    targetId: 't',
    launch: async () => {},
    surfaceStrategy: []
  })
  assert.deepEqual(ok.viewports, ['desktop'])
})

test('REQUIRED PROOF: runDogfoodPass launches once, visits every surface x viewport, and closes the instance even on error', async () => {
  let closeCalls = 0
  let launchCalls = 0
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => {
      launchCalls += 1
      return {
        page: fakePage(),
        close: async () => {
          closeCalls += 1
        }
      }
    },
    surfaceStrategy: TWO_SURFACES,
    viewports: ['desktop', 'mobile']
  }
  let detectCalls = 0
  const run = await runDogfoodPass(descriptor, {
    attachCapture: fakeCaptureFactory(),
    detectSurfaceFindings: async () => {
      detectCalls += 1
      return []
    }
  })
  assert.equal(launchCalls, 1)
  assert.equal(closeCalls, 1)
  // 2 surfaces x 2 viewports
  assert.equal(detectCalls, 4)
  assert.equal(run.surfaceCount, 2)
  assert.equal(run.targetId, 'fake-app')
})

test('runDogfoodPass still closes the instance when a detector throws', async () => {
  let closed = false
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => ({
      page: fakePage(),
      close: async () => {
        closed = true
      }
    }),
    surfaceStrategy: TWO_SURFACES
  }
  await assert.rejects(
    runDogfoodPass(descriptor, {
      attachCapture: fakeCaptureFactory(),
      detectSurfaceFindings: async () => {
        throw new Error('boom')
      }
    })
  )
  assert.equal(closed, true)
})

// F31 (Phase 3, resource-aware execution hardening): attachCapture used to
// run BEFORE any try/finally existed, so a real launched Electron instance
// leaked when it threw. Proves instance.close() is now reached even from
// this specific pre-try failure point, not just from inside the loop.
test('F31: runDogfoodPass still closes the instance when attachCapture itself throws', async () => {
  let closed = false
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => ({
      page: fakePage(),
      close: async () => {
        closed = true
      }
    }),
    surfaceStrategy: TWO_SURFACES
  }
  await assert.rejects(
    runDogfoodPass(descriptor, {
      attachCapture: () => {
        throw new Error('attachCapture boom')
      }
    })
  )
  assert.equal(closed, true)
})

test('runDogfoodPass turns real captured console errors into real CONSOLE_ERROR findings', async () => {
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => ({ page: fakePage(), close: async () => {} }),
    surfaceStrategy: () => [{ id: 'home', title: 'Home', open: async () => {} }]
  }
  const run = await runDogfoodPass(descriptor, {
    attachCapture: fakeCaptureFactory([{ text: 'TypeError: real crash', location: null }])
  })
  assert.equal(run.totalFindings, 1)
  assert.equal(run.findings[0].category, 'CONSOLE_ERROR')
})

test('REQUIRED PROOF: runIterativeDogfood stops once applyFixes resolves everything and nothing new appears', async () => {
  let call = 0
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => ({ page: fakePage(), close: async () => {} }),
    surfaceStrategy: () => [{ id: 'home', title: 'Home', open: async () => {} }]
  }
  const result = await runIterativeDogfood(
    descriptor,
    {
      attachCapture: fakeCaptureFactory(),
      detectSurfaceFindings: async () => {
        call += 1
        // First pass finds one dead link; the "fix" makes it disappear.
        return call === 1 ? [{ category: 'DEAD_LINK', description: 'docs 404s' }] : []
      },
      applyFixes: async (fixable) => ({ appliedCount: fixable.length })
    },
    3
  )
  assert.equal(result.iterations[0].run.totalFindings, 1)
  assert.equal(result.finalRun.totalFindings, 0)
  assert.equal(result.iterationCount, 2)
})

// Phase 5 (browser/screenshot reliability): deps.captureScreenshot used to
// have zero try/catch around it -- one transient CDP hiccup threw straight
// out of runDogfoodPass and aborted the whole multi-surface pass.
test('runDogfoodPass retries a transient captureScreenshot failure and still returns the real screenshot', async () => {
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => ({ page: fakePage(), close: async () => {} }),
    surfaceStrategy: () => [{ id: 'home', title: 'Home', open: async () => {} }]
  }
  let calls = 0
  const run = await runDogfoodPass(descriptor, {
    attachCapture: fakeCaptureFactory(),
    screenshotRetryDelayMs: 0,
    captureScreenshot: async (page, surfaceId, viewportId) => {
      calls += 1
      if (calls === 1) {
        throw new Error('transient CDP miss')
      }
      return { surfaceId, viewportId, filePath: '/fake.png' }
    }
  })
  assert.equal(calls, 2)
  assert.equal(run.screenshots.length, 1)
  assert.deepEqual(run.screenshots[0], { surfaceId: 'home', viewportId: 'desktop', filePath: '/fake.png' })
  assert.equal(run.screenshotFailureCount, 0)
})

test('runDogfoodPass degrades gracefully when captureScreenshot fails persistently: records it, does not abort the run, still visits every other surface', async () => {
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => ({ page: fakePage(), close: async () => {} }),
    surfaceStrategy: TWO_SURFACES
  }
  const run = await runDogfoodPass(descriptor, {
    attachCapture: fakeCaptureFactory(),
    screenshotRetryDelayMs: 0,
    captureScreenshot: async () => {
      throw new Error('CDP permanently broken')
    }
  })
  // Both surfaces still visited -- the run completed, not aborted.
  assert.equal(run.surfaceCount, 2)
  assert.equal(run.screenshots.length, 2)
  // A persistent break stays VISIBLE (never silently swallowed), not thrown.
  assert.equal(run.screenshotFailureCount, 2)
  for (const shot of run.screenshots) {
    assert.equal(shot.failed, true)
    assert.match(shot.error, /CDP permanently broken/)
  }
})

test('runIterativeDogfood never exceeds maxIterations even with a persistent regression', async () => {
  const descriptor = {
    targetId: 'fake-app',
    launch: async () => ({ page: fakePage(), close: async () => {} }),
    surfaceStrategy: () => [{ id: 'home', title: 'Home', open: async () => {} }]
  }
  const result = await runIterativeDogfood(
    descriptor,
    {
      attachCapture: fakeCaptureFactory(),
      // Every applied fix "introduces" a differently-worded, auto-fix-eligible
      // regression, so newlyIntroducedCount stays > 0 forever -- only the cap
      // can stop this.
      detectSurfaceFindings: async () => {
        const n = Math.random()
        return [{ category: 'BROKEN_INTERACTION', description: `regression ${n}` }]
      },
      applyFixes: async () => ({ appliedCount: 1 })
    },
    2
  )
  assert.ok(result.iterationCount <= 3) // iteration 0 (baseline) + up to maxIterations fix passes
})
