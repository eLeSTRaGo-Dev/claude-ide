import { expect, test } from 'claude-code/testing'

import { BRANCHES, GRAPH, PATCH } from './fixtures'
import {
  branchTree,
  clipDiff,
  diffLines,
  commitLabel,
  parseBranches,
  parseGraph,
  parseRefs,
  sliceDiff,
  splitShow,
  trackLabel,
} from './git'

test('parseBranches: local first, current marked, origin/HEAD skipped', () => {
  const branches = parseBranches(BRANCHES)
  expect(branches.map(b => b.name).slice(0, 3)).toEqual([
    'develop',
    'fix/delivery-readiness',
    'origin/develop',
  ])
  expect(branches[0]).toMatchObject({
    name: 'develop',
    isHead: true,
    isRemote: false,
    upstream: 'origin/develop',
  })
  expect(branches.some(b => b.name.endsWith('/HEAD'))).toBe(false)
  expect(branches.filter(b => b.isRemote).every(b => !b.isHead)).toBe(true)
  expect(branches.find(b => b.name === 'origin/main')?.isRemote).toBe(true)
})

test('parseGraph: commits, merges and connector lines', () => {
  const lines = parseGraph(GRAPH)
  const commits = lines.filter(line => line.commit)
  expect(commits.length).toBe(9)
  expect(lines.length).toBeGreaterThan(commits.length)
  const connector = lines.find(line => line.commit === undefined)
  expect(connector?.graph).toContain('|')
  const head = lines.find(line => line.commit?.short === '908022a')
  expect(head?.commit?.refs).toEqual(['HEAD -> develop', 'origin/develop'])
  expect(head?.commit?.subject).toBe('oh-my-project v0.7.1')
  expect(head?.commit?.date).toBe('2026-07-09')
  const merge = lines.find(line => line.commit?.short === '352e0cc')
  expect(merge?.commit?.refs).toEqual(['origin/main'])
  expect(commitLabel(head!)).toContain('(HEAD -> develop, origin/develop)')
})

test('empty and not-a-repo output', () => {
  expect(parseBranches('')).toEqual([])
  expect(parseGraph('')).toEqual([])
  expect(parseGraph('fatal: not a git repository\n')[0]?.commit).toBeUndefined()
})

test('helpers', () => {
  expect(parseRefs('')).toEqual([])
  expect(parseRefs('tag: v1, origin/HEAD')).toEqual(['tag: v1'])
  expect(trackLabel('[ahead 1, behind 2]')).toBe('+1 -2')
  expect(trackLabel('[gone]')).toBe('gone')
  expect(trackLabel(undefined)).toBe('')
  expect(splitShow('a\nb\n\n')).toEqual(['a', 'b'])
})

test('clipDiff: cut diff keeps hunk counts valid', () => {
  const diff = [
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1,3 +1,4 @@ ctx',
    ' a',
    '-b',
    '+c',
    '+d',
    ' e',
  ].join('\n')
  expect(clipDiff(diff, 100)).toBe(diff.replace('-1,3 +1,4', '-1,3 +1,4'))
  expect(clipDiff(diff, 6).split('\n')[3]).toBe('@@ -1,2 +1,1 @@ ctx')
  expect(clipDiff(diff, 3)).toBe('')
  expect(clipDiff(PATCH, 12)).toContain('@@')
})

const DIFF = [
  'diff --git a/x b/x',
  '--- a/x',
  '+++ b/x',
  '@@ -1,3 +1,4 @@ ctx',
  ' a',
  '-b',
  '+c',
  '+d',
  ' e',
  'diff --git a/y b/y',
  '--- a/y',
  '+++ b/y',
  '@@ -10,2 +10,2 @@',
  '-- q',
  '+r',
  ' s',
].join('\n')

test('sliceDiff: offset 0 is clipDiff, whole diff stays as is', () => {
  expect(sliceDiff(DIFF, 0, 100)).toBe(DIFF)
  expect(sliceDiff(DIFF, 0, 6)).toBe(clipDiff(DIFF, 6))
  expect(sliceDiff(DIFF, 0, 6).split('\n')[3]).toBe('@@ -1,2 +1,1 @@ ctx')
})

test('sliceDiff: a hunk entered mid-way gets a header of its own', () => {
  // starts at "-b": old line 2, new line 2; keeps -b +c +d ' e'
  expect(sliceDiff(DIFF, 5, 4)).toBe(
    ['@@ -2,2 +2,3 @@ ctx', '-b', '+c', '+d', ' e'].join('\n'),
  )
  // cut at both ends
  expect(sliceDiff(DIFF, 6, 2)).toBe(['@@ -2,0 +2,2 @@ ctx', '+c', '+d'].join('\n'))
})

test('sliceDiff: file headers only with a hunk after them', () => {
  // ends inside the second file's header block: nothing of it is kept
  expect(sliceDiff(DIFF, 3, 8)).toBe(
    ['@@ -1,3 +1,4 @@ ctx', ' a', '-b', '+c', '+d', ' e'].join('\n'),
  )
  // starts at the second file's `diff` line
  expect(sliceDiff(DIFF, 9, 100)).toBe(DIFF.split('\n').slice(9).join('\n'))
  // starts inside a header block: its lines are dropped, the hunk kept
  expect(sliceDiff(DIFF, 10, 100)).toBe(DIFF.split('\n').slice(12).join('\n'))
  expect(sliceDiff(DIFF, 0, 3)).toBe('')
  expect(sliceDiff(DIFF, 99, 5)).toBe('')
  expect(sliceDiff('', 0, 5)).toBe('')
})

test('sliceDiff: a removed `-- q` line is a body line, not a header', () => {
  expect(sliceDiff(DIFF, 14, 2)).toBe(['@@ -11,1 +10,2 @@', '+r', ' s'].join('\n'))
})

test('sliceDiff: fixture slices keep valid hunks', () => {
  const total = diffLines(PATCH).length
  for (let offset = 0; offset < total; offset += 7) {
    const text = sliceDiff(PATCH, offset, 9)
    const rows = text === '' ? [] : text.split('\n')
    let i = 0
    while (i < rows.length) {
      const m = /^@@ -\d+,(\d+) \+\d+,(\d+) @@/.exec(rows[i] ?? '')
      if (m === null) {
        i++
        continue
      }
      let o = 0
      let n = 0
      for (i++; i < rows.length && !/^(@@|diff )/.test(rows[i] ?? ''); i++) {
        const c = (rows[i] ?? '')[0]
        if (c !== '+') o++
        if (c !== '-') n++
      }
      expect([o, n]).toEqual([Number(m[1]), Number(m[2])])
    }
  }
})

test('branchTree groups branches by / with local first', () => {
  const b = (name: string, isRemote = false, isHead = false) =>
    ({ name, sha: 'x', isHead, isRemote }) as const
  const rows = branchTree(
    [b('main', false, true), b('fix/a'), b('fix/b'), b('origin/main', true), b('origin/team/x', true)],
    new Set(),
  )
  expect(rows.map(r => '  '.repeat(r.depth) + (r.kind === 'folder' ? r.name + '/' : r.name))).toEqual([
    'main',
    'fix/',
    '  a',
    '  b',
    'origin/',
    '  main',
    '  team/',
    '    x',
  ])
  const shut = branchTree([b('fix/a'), b('origin/main', true)], new Set(['l:fix']))
  expect(shut.map(r => r.name)).toEqual(['fix', 'origin', 'main'])
})
