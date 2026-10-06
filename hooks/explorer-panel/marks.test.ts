import { expect, test } from 'claude-code/testing'

import { deleteTargets, pruneMarks, rangeOf, toggleMark } from './marks'
import type { Row } from './tree'

const row = (path: string, depth = 0): Row => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  depth,
  kind: 'file',
  isExpanded: false,
})

const rows = ['/p/a', '/p/b', '/p/c', '/p/d'].map(path => row(path))

test('toggleMark adds a path, then removes it', () => {
  expect(toggleMark([], '/p/a')).toEqual(['/p/a'])
  expect(toggleMark(['/p/a', '/p/b'], '/p/c')).toEqual(['/p/a', '/p/b', '/p/c'])
  expect(toggleMark(['/p/a', '/p/b'], '/p/a')).toEqual(['/p/b'])
})

test('rangeOf spans anchor to path in row order, either direction', () => {
  expect(rangeOf(rows, '/p/b', '/p/d')).toEqual(['/p/b', '/p/c', '/p/d'])
  expect(rangeOf(rows, '/p/d', '/p/b')).toEqual(['/p/b', '/p/c', '/p/d'])
  expect(rangeOf(rows, '/p/c', '/p/c')).toEqual(['/p/c'])
})

test('rangeOf marks the path alone without a listed anchor', () => {
  expect(rangeOf(rows, undefined, '/p/c')).toEqual(['/p/c'])
  expect(rangeOf(rows, '/p/gone', '/p/c')).toEqual(['/p/c'])
})

test('deleteTargets dedupes and drops paths under another listed dir', () => {
  expect(deleteTargets(['/p/src/a.ts', '/p/b', '/p/src', '/p/b'], '/p')).toEqual({
    paths: ['/p/b', '/p/src'],
  })
  expect(deleteTargets(['/p/src2', '/p/src'], '/p')).toEqual({ paths: ['/p/src2', '/p/src'] })
})

test('deleteTargets returns the first refusal', () => {
  expect(deleteTargets(['/p/a', '/p', '/q/x'], '/p')).toEqual({ error: 'Not the root' })
  expect(deleteTargets(['/p/a', '/q/x'], '/p')).toEqual({ error: 'Outside the root: /q/x' })
})

test('pruneMarks drops the gone paths, keeping order', () => {
  const gone = new Set(['/p/b'])
  expect(pruneMarks(['/p/a', '/p/b', '/p/c'], path => gone.has(path))).toEqual(['/p/a', '/p/c'])
  expect(pruneMarks([], () => true)).toEqual([])
})
