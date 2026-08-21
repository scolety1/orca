import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOpenUrlCommand, openUrl } from '../server/open-url-command.mjs'

test('Windows uses cmd /c start with the title-parsing quirk workaround', () => {
  const { command, args } = buildOpenUrlCommand('http://127.0.0.1:4610', 'win32')
  assert.equal(command, 'cmd')
  assert.deepEqual(args, ['/c', 'start', '""', 'http://127.0.0.1:4610'])
})

test('macOS uses open', () => {
  const { command, args } = buildOpenUrlCommand('http://127.0.0.1:4610', 'darwin')
  assert.equal(command, 'open')
  assert.deepEqual(args, ['http://127.0.0.1:4610'])
})

test('Linux uses xdg-open', () => {
  const { command, args } = buildOpenUrlCommand('http://127.0.0.1:4610', 'linux')
  assert.equal(command, 'xdg-open')
  assert.deepEqual(args, ['http://127.0.0.1:4610'])
})

test('openUrl spawns the platform command with a detached, ignored-stdio process', () => {
  const calls = []
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options })
    return { unref: () => {} }
  }
  openUrl('http://127.0.0.1:4610', { platform: 'darwin', spawnFn: fakeSpawn })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'open')
  assert.deepEqual(calls[0].args, ['http://127.0.0.1:4610'])
  assert.equal(calls[0].options.stdio, 'ignore')
  assert.equal(calls[0].options.detached, true)
})
