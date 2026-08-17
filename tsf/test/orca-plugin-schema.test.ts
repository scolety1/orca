import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePluginManifest } from '../../src/shared/plugins/plugin-manifest'

describe('TSF Orca plugin manifest', () => {
  it('satisfies the pinned Orca plugin v1 schema', () => {
    const manifest = JSON.parse(readFileSync(resolve('tsf/orca-plugin.json'), 'utf8'))
    const parsed = parsePluginManifest(manifest)
    expect(parsed).toMatchObject({
      ok: true,
      manifest: {
        id: 'foundation',
        publisher: 'thousand-sunny-fleet',
        pluginApi: 1,
        capabilities: [
          { kind: 'workspace:read' },
          { kind: 'storage' },
          { kind: 'events:subscribe' }
        ]
      }
    })
  })
})
