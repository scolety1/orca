import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTablesFromHtml, stripTags } from '../domain/html-table-tokenizer.mjs'

test('extracts a simple table with one header row', () => {
  const html = `<table><caption>QB Stats</caption>
    <tr><th>Player</th><th>Yards</th></tr>
    <tr><td>Smith</td><td>1200</td></tr>
    <tr><td>Jones</td><td>980</td></tr>
  </table>`
  const [table] = extractTablesFromHtml(html)
  assert.equal(table.caption, 'QB Stats')
  assert.deepEqual(table.headers, ['Player', 'Yards'])
  assert.equal(table.rowCount, 2)
  assert.deepEqual(table.bodyRows[0], ['Smith', '1200'])
})

test('picks up multiple sibling tables independently', () => {
  const html = `
    <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
    <table><tr><th>B</th></tr><tr><td>2</td></tr></table>
  `
  const tables = extractTablesFromHtml(html)
  assert.equal(tables.length, 2)
  assert.deepEqual(tables[0].headers, ['A'])
  assert.deepEqual(tables[1].headers, ['B'])
})

test('flattens a grouped, multi-row header using colspan/rowspan', () => {
  const html = `<table>
    <thead>
      <tr><th rowspan="2">Player</th><th colspan="2">Passing</th></tr>
      <tr><th>Yards</th><th>TD</th></tr>
    </thead>
    <tbody>
      <tr><td>Smith</td><td>1200</td><td>9</td></tr>
    </tbody>
  </table>`
  const [table] = extractTablesFromHtml(html)
  assert.deepEqual(table.headers, ['Player', 'Passing / Yards', 'Passing / TD'])
  assert.deepEqual(table.bodyRows[0], ['Smith', '1200', '9'])
})

test('records a warning for a ragged body row instead of throwing', () => {
  const html = `<table>
    <tr><th>A</th><th>B</th><th>C</th></tr>
    <tr><td>1</td><td>2</td></tr>
  </table>`
  const [table] = extractTablesFromHtml(html)
  assert.equal(table.columnCount, 3)
  assert.deepEqual(table.bodyRows[0], ['1', '2'])
  assert.ok(table.warnings.some((w) => w.includes('ROW_LENGTH_MISMATCH')))
})

test('auto-closes an unclosed <td> instead of losing subsequent rows', () => {
  const html = `<table>
    <tr><th>A</th><th>B</th></tr>
    <tr><td>1<td>2</tr>
    <tr><td>3</td><td>4</td></tr>
  </table>`
  const tables = extractTablesFromHtml(html)
  assert.equal(tables.length, 1)
  assert.equal(tables[0].rowCount, 2)
  assert.deepEqual(tables[0].bodyRows[1], ['3', '4'])
})

test('ignores a table nested inside a cell as a separate table, flattening its text, and warns about it', () => {
  const html = `<table>
    <tr><th>Outer</th></tr>
    <tr><td>before <table><tr><td>inner</td></tr></table> after</td></tr>
  </table>`
  const tables = extractTablesFromHtml(html)
  assert.equal(tables.length, 1)
  assert.match(tables[0].bodyRows[0][0], /before.*inner.*after/)
  const warning = tables[0].warnings.find((w) => w.startsWith('NESTED_TABLE_FLATTENED'))
  assert.ok(warning, 'expected a NESTED_TABLE_FLATTENED warning')
  assert.match(warning, /outer table index 0/)
  assert.match(warning, /1 nested <table>/)
  assert.match(warning, /row index \[1\]/)
  assert.match(warning, /flattened to plain text/)
})

test('records one warning listing every affected row when multiple nested tables appear', () => {
  const html = `<table>
    <tr><th>Outer</th></tr>
    <tr><td><table><tr><td>a</td></tr></table></td></tr>
    <tr><td>plain</td></tr>
    <tr><td><table><tr><td>b</td></tr></table></td></tr>
  </table>`
  const [table] = extractTablesFromHtml(html)
  const warnings = table.warnings.filter((w) => w.startsWith('NESTED_TABLE_FLATTENED'))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /2 nested <table>/)
  assert.match(warnings[0], /row indexes \[1, 3\]/)
})

test('an ordinary table with no nesting produces no nested-table warning', () => {
  const html = '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>'
  const [table] = extractTablesFromHtml(html)
  assert.equal(
    table.warnings.some((w) => w.startsWith('NESTED_TABLE_FLATTENED')),
    false
  )
})

test('sibling (non-nested) tables never trigger a nested-table warning on either one', () => {
  const html = '<table><tr><th>A</th></tr></table><table><tr><th>B</th></tr></table>'
  const tables = extractTablesFromHtml(html)
  assert.equal(tables[0].warnings.length, 0)
  assert.equal(tables[1].warnings.length, 0)
})

test('decodes entities and strips markup in stripTags', () => {
  assert.equal(stripTags('A &amp; <b>B</b>&nbsp;C'), 'A & B C')
})

test('does not extract a table that is commented out', () => {
  const html = `<!-- <table><tr><th>Secret</th></tr><tr><td>1</td></tr></table> --><p>Nothing here.</p>`
  assert.equal(extractTablesFromHtml(html).length, 0)
})

test('a real table after a comment is still extracted correctly', () => {
  const html = `<!-- <table><tr><th>Fake</th></tr></table> --><table><tr><th>Real</th></tr><tr><td>1</td></tr></table>`
  const tables = extractTablesFromHtml(html)
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0].headers, ['Real'])
})

test('a literal > inside a quoted attribute does not truncate the tag or corrupt cell text', () => {
  const html = `<table><tr><th>H</th></tr><tr><td title="a>b">x</td></tr></table>`
  const [table] = extractTablesFromHtml(html)
  assert.deepEqual(table.bodyRows[0], ['x'])
})

test('a leading all-<th> row inside <tbody> (no <thead>) is recognized as the header', () => {
  const html = `<table><tbody><tr><th>Player</th><th>Yards</th></tr><tr><td>Smith</td><td>1200</td></tr></tbody></table>`
  const [table] = extractTablesFromHtml(html)
  assert.deepEqual(table.headers, ['Player', 'Yards'])
  assert.deepEqual(table.bodyRows, [['Smith', '1200']])
})

test('a maliciously huge colspan is clamped instead of exhausting memory or throwing', () => {
  const html = `<table><tr><td colspan="999999999">wide</td></tr></table>`
  const [table] = extractTablesFromHtml(html)
  assert.equal(table.bodyRows[0].length, 1000)
  assert.ok(table.bodyRows[0].every((cell) => cell === 'wide'))
})

test('a maliciously huge header colspan is likewise clamped', () => {
  const html = `<table><tr><th colspan="999999999">Wide</th></tr><tr><td>x</td></tr></table>`
  const [table] = extractTablesFromHtml(html)
  assert.equal(table.headers.length, 1000)
})

test('empty and missing cells become empty strings, not thrown errors', () => {
  const html = `<table>
    <tr><th>A</th><th>B</th></tr>
    <tr><td></td><td>—</td></tr>
  </table>`
  const [table] = extractTablesFromHtml(html)
  assert.deepEqual(table.bodyRows[0], ['', '—'])
})
