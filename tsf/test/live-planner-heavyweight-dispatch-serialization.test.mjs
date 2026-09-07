// F32 (Phase 3, resource-aware execution hardening): proves
// serializeHeavyweightDispatchWhenPressured (live-planner.mjs) -- the one
// in-process choke point every heavyweight LLM-CLI dispatch call site
// funnels through -- actually serializes concurrent dispatches under
// PRESSURED tier (closing the gap where PRESSURED was fully ADMITted, same
// as HEALTHY, so two callers could spawn a real child process at once) while
// leaving HEALTHY tier's own documented "normal Fleet concurrency"
// untouched. Uses fake run() functions (never a real child_process.spawn)
// so this is a fast, deterministic ordering proof, not a timing-sensitive
// real-process test.
import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeHeavyweightDispatchWhenPressured } from '../server/live-planner.mjs'

const GB = 1024 ** 3

async function withForcedTier(availableBytes, fn) {
  const prior = {
    total: process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES,
    free: process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES
  }
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * GB)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(availableBytes)
  try {
    return await fn()
  } finally {
    if (prior.total === undefined) {
      delete process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES
    } else {
      process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = prior.total
    }
    if (prior.free === undefined) {
      delete process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES
    } else {
      process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = prior.free
    }
  }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

test('F32: PRESSURED tier serializes two concurrent heavyweight dispatches -- the second never starts before the first finishes', async () => {
  await withForcedTier(3 * GB, async () => {
    // 3GB free -> PRESSURED (2.5-4GB band)
    const order = []
    let releaseFirst
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    const first = serializeHeavyweightDispatchWhenPressured(async () => {
      order.push('first-start')
      await firstGate
      order.push('first-end')
      return 'first-result'
    })
    await tick()
    const second = serializeHeavyweightDispatchWhenPressured(async () => {
      order.push('second-start')
      return 'second-result'
    })
    await tick()
    // Second must NOT have started while first is still holding the gate.
    assert.deepEqual(order, ['first-start'])
    releaseFirst()
    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start'])
    assert.equal(firstResult, 'first-result')
    assert.equal(secondResult, 'second-result')
  })
})

test('F32: CRITICAL tier also serializes (not just PRESSURED)', async () => {
  await withForcedTier(2 * GB, async () => {
    // 2GB free -> CRITICAL (1.5-2.5GB band)
    const order = []
    let releaseFirst
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    const first = serializeHeavyweightDispatchWhenPressured(async () => {
      order.push('first-start')
      await firstGate
      order.push('first-end')
    })
    await tick()
    const second = serializeHeavyweightDispatchWhenPressured(async () => {
      order.push('second-start')
    })
    await tick()
    assert.deepEqual(order, ['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start'])
  })
})

test('F32: HEALTHY tier keeps normal Fleet concurrency -- does not serialize', async () => {
  await withForcedTier(8 * GB, async () => {
    // 8GB free -> HEALTHY (>=4GB)
    const order = []
    let releaseFirst
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    const first = serializeHeavyweightDispatchWhenPressured(async () => {
      order.push('first-start')
      await firstGate
      order.push('first-end')
    })
    await tick()
    const second = serializeHeavyweightDispatchWhenPressured(async () => {
      order.push('second-start')
    })
    await tick()
    // Both must have started before either finished -- true concurrency.
    assert.deepEqual(order, ['first-start', 'second-start'])
    releaseFirst()
    await first
    await second
  })
})

test('F32: a third dispatch queued under PRESSURED runs strictly after the second, not interleaved', async () => {
  await withForcedTier(3 * GB, async () => {
    const order = []
    const make = (name) =>
      serializeHeavyweightDispatchWhenPressured(async () => {
        order.push(`${name}-start`)
        await tick()
        order.push(`${name}-end`)
      })
    const all = Promise.all([make('a'), make('b'), make('c')])
    await all
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end', 'c-start', 'c-end'])
  })
})
