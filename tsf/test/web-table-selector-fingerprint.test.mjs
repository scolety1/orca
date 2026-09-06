import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTablesFromHtml } from '../domain/html-table-tokenizer.mjs'
import {
  computeTableSelectorFingerprint,
  detectTableDrift
} from '../domain/web-table-selector-fingerprint.mjs'

const v1 =
  '<table><tr><th>Player</th><th>Yards</th></tr><tr><td>Favre</td><td>4413</td></tr></table>'
const v2SameShape =
  '<table><tr><th>Player</th><th>Yards</th></tr><tr><td>Everett</td><td>3970</td></tr></table>'
const v2Drifted =
  '<table><tr><th>Player</th><th>Yards</th><th>Rating</th></tr><tr><td>Favre</td><td>4413</td><td>99.5</td></tr></table>'

test('an unchanged table structure produces no drift warning', () => {
  const a = computeTableSelectorFingerprint(extractTablesFromHtml(v1)[0])
  const b = computeTableSelectorFingerprint(extractTablesFromHtml(v2SameShape)[0])
  const result = detectTableDrift(a, b)
  assert.equal(result.drifted, false)
})

test('an added column is detected as drift with an explicit warning', () => {
  const a = computeTableSelectorFingerprint(extractTablesFromHtml(v1)[0])
  const b = computeTableSelectorFingerprint(extractTablesFromHtml(v2Drifted)[0])
  const result = detectTableDrift(a, b)
  assert.equal(result.drifted, true)
  assert.ok(result.changedFields.includes('columnCount'))
  assert.match(result.warning, /changed/)
})

test('no prior fingerprint means no drift claim (first acquisition)', () => {
  const b = computeTableSelectorFingerprint(extractTablesFromHtml(v1)[0])
  const result = detectTableDrift(null, b)
  assert.equal(result.drifted, false)
})
