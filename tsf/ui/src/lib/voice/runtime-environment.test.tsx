import { describe, it, expect, afterEach } from 'vitest'
import { isLikelyElectronRuntime } from './runtime-environment'

describe('isLikelyElectronRuntime', () => {
  const originalUserAgent = navigator.userAgent

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true
    })
  })

  it('returns true when the user agent names Electron', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orca/1.0.0 Electron/33.0.0 Chrome/130.0.0.0',
      configurable: true
    })
    expect(isLikelyElectronRuntime()).toBe(true)
  })

  it('returns false for a real, independent Chrome browser tab', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      configurable: true
    })
    expect(isLikelyElectronRuntime()).toBe(false)
  })
})
