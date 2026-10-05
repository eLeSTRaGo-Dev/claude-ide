import { expect, test } from 'claude-code/testing'

import { BRANCHES, GRAPH, PATCH } from './fixtures'
import {
  clipDiff,
  commitLabel,
  parseBranches,
  parseGraph,
  parseRefs,
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
