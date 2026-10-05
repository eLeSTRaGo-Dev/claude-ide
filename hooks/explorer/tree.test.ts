import { expect, test } from 'claude-code/testing'

import {
  clip,
  filterFor,
  flatten,
  isBinary,
  languageOf,
  window,
} from './tree'
import type { Entry, Row } from './tree'

const file = (name: string): Entry => ({ name, kind: 'file', size: 1, mtimeMs: 0 })
const dir = (name: string): Entry => ({ name, kind: 'dir', size: 0, mtimeMs: 0 })

const listings = new Map<string, Entry[]>([
  ['/p', [file('b.txt'), dir('src'), file('A.md'), dir('.git'), dir('Docs')]],
  ['/p/src', [file('z.ts'), dir('inner'), file('a.ts')]],
  ['/p/src/inner', [file('deep.ts')]],
])

const rowsOf = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    path: `/r/${i}`,
    name: String(i),
    depth: 0,
    kind: 'file' as const,
    isExpanded: false,
  }))

test('flatten sorts dirs first, then names case-insensitively', () => {
  const rows = flatten(listings, new Set(), '/p')
  expect(rows.map(row => row.name)).toEqual(['Docs', 'src', 'A.md', 'b.txt'])
})

test('flatten hides .git in both modes', () => {
  for (const mode of ['files', 'unity'] as const) {
    const rows = flatten(listings, new Set(), '/p', { mode })
    expect(rows.some(row => row.name === '.git')).toBe(false)
  }
})

test('flatten nests expanded dirs with depth', () => {
  const expanded = new Set(['/p/src', '/p/src/inner'])
  const rows = flatten(listings, expanded, '/p')
  expect(rows.map(row => [row.name, row.depth])).toEqual([
    ['Docs', 0],
    ['src', 0],
    ['inner', 1],
    ['deep.ts', 2],
    ['a.ts', 1],
    ['z.ts', 1],
    ['A.md', 0],
    ['b.txt', 0],
  ])
  expect(rows[1]?.isExpanded).toBe(true)
  expect(rows[0]?.isExpanded).toBe(false)
})

test('flatten shows nothing under an expanded dir without a listing', () => {
  const rows = flatten(listings, new Set(['/p/Docs']), '/p')
  expect(rows.map(row => row.name)).toEqual(['Docs', 'src', 'A.md', 'b.txt'])
  expect(rows[0]?.isExpanded).toBe(true)
})

test('flatten applies a custom filter', () => {
  const rows = flatten(listings, new Set(), '/p', {
    filter: entry => entry.kind === 'file',
  })
  expect(rows.map(row => row.name)).toEqual(['A.md', 'b.txt'])
})

test('filterFor returns a filter per mode', () => {
  expect(filterFor('files')(dir('.git'), '/p', 'files')).toBe(false)
  expect(filterFor('unity')(file('x'), '/p', 'unity')).toBe(true)
})

test('window shows everything when it fits', () => {
  const win = window(rowsOf(3), 2, 10)
  expect(win.offset).toBe(0)
  expect(win.rows).toHaveLength(3)
})

test('window keeps the selection visible at both edges', () => {
  const rows = rowsOf(20)
  expect(window(rows, 0, 5).offset).toBe(0)
  expect(window(rows, 19, 5).offset).toBe(15)
  expect(window(rows, 19, 5).rows.map(row => row.name)).toEqual([
    '15', '16', '17', '18', '19',
  ])
})

test('window scrolls one row at a time and keeps a margin', () => {
  const rows = rowsOf(20)
  // selection reaches the last visible row: one more row comes into view
  const down = window(rows, 4, 5, 0)
  expect(down.offset).toBe(1)
  expect(down.rows.at(-1)?.name).toBe('5')
  // and back up
  const up = window(rows, 1, 5, 1)
  expect(up.offset).toBe(0)
})

test('window with no selection clamps the offset', () => {
  expect(window(rowsOf(20), -1, 5, 99).offset).toBe(15)
  expect(window([], -1, 5).rows).toEqual([])
})

test('languageOf maps extensions', () => {
  expect(languageOf('a.ts')).toBe('typescript')
  expect(languageOf('A.CS')).toBe('csharp')
  expect(languageOf('Makefile')).toBeUndefined()
})

test('isBinary sniffs for NUL', () => {
  expect(isBinary('plain text')).toBe(false)
  expect(isBinary('ab\0cd')).toBe(true)
})

test('clip caps lines', () => {
  expect(clip('a\nb\nc', 2)).toBe('a\nb')
})
