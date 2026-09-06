import test from 'node:test'
import assert from 'node:assert/strict'
import { inferTableSchema } from '../domain/web-table-schema-inference.mjs'

test('infers number, string and missing without renaming header text', () => {
  const headers = ['Player', 'Yards', 'Rating']
  const rows = [
    ['Favre', '4413', '99.5'],
    ['Everett', '3970', ''],
    ['Aikman', '3304', 'N/A']
  ]
  const { columns } = inferTableSchema(headers, rows)
  assert.equal(columns[0].fieldName, 'Player')
  assert.equal(columns[0].observedType, 'string')
  assert.equal(columns[1].observedType, 'number')
  assert.equal(columns[2].missingCount, 2)
})

test('reports zero confidence and unknown type for an all-missing column', () => {
  const { columns, totalMissingCells } = inferTableSchema(['Notes'], [['—'], ['-'], ['']])
  assert.equal(columns[0].observedType, 'unknown')
  assert.equal(columns[0].confidence, 0)
  assert.equal(totalMissingCells, 3)
})

test('classifies a percentage column distinctly from a plain number column', () => {
  const { columns } = inferTableSchema(['Completion %'], [['62.5%'], ['58.1%']])
  assert.equal(columns[0].observedType, 'percentage')
})
