import assert from 'node:assert/strict'
import test from 'node:test'
import { readProjectsListFilters, writeProjectsListFilters } from './projects-list-filters.ts'

test('no params -> the exact prior defaults', () => {
  assert.deepEqual(readProjectsListFilters(new URLSearchParams()), {
    filter: 'ALL',
    search: '',
    sort: 'NEEDS_ATTENTION_FIRST'
  })
})

test('a known filter/sort/search round-trips exactly', () => {
  const filters = { filter: 'BLOCKED' as const, search: 'talent', sort: 'NAME_ASC' as const }
  const read = readProjectsListFilters(writeProjectsListFilters(filters))
  assert.deepEqual(read, filters)
})

test('an unknown/garbage filter or sort falls back to the default, never crashes', () => {
  const params = new URLSearchParams('filter=NOT_REAL&sort=ALSO_NOT_REAL&q=talent')
  assert.deepEqual(readProjectsListFilters(params), {
    filter: 'ALL',
    search: 'talent',
    sort: 'NEEDS_ATTENTION_FIRST'
  })
})

test('writeProjectsListFilters omits every value still at its default -- a plain visit keeps a clean URL', () => {
  const params = writeProjectsListFilters({ filter: 'ALL', search: '', sort: 'NEEDS_ATTENTION_FIRST' })
  assert.equal(params.toString(), '')
})

test('writeProjectsListFilters includes only the values that differ from default', () => {
  const params = writeProjectsListFilters({ filter: 'WORKING', search: '', sort: 'NEEDS_ATTENTION_FIRST' })
  assert.equal(params.toString(), 'filter=WORKING')
})
