import { expect, test } from 'claude-code/testing'

import {
  authorTotals, bucketByDay, buildGrid, dailySeries, dayKey, fmt, inRange, levelFor, monthLabels, niceMax,
  parseLog, resample, summary, weekdayTotals,
} from './data'
import { LOG, NOW, at } from './fixtures'

test('parseLog: header lines with optional shortstat', () => {
  const c = parseLog(LOG)
  expect(c.length).toBe(5)
  expect(c[0]).toEqual({ ts: at(2026, 10, 7), author: 'Ada', added: 10, deleted: 3 })
  expect(c[1]).toMatchObject({ added: 1, deleted: 0 })
  expect(c[2]).toMatchObject({ author: 'Bob', added: 0, deleted: 7 })
  expect(c[3]).toMatchObject({ added: 0, deleted: 0 })
  expect(parseLog('')).toEqual([])
  expect(parseLog('garbage\n@x\ty\n')).toEqual([])
})

test('bucketByDay / summary', () => {
  const c = parseLog(LOG)
  const days = bucketByDay(c)
  expect(days.get('2026-10-07')).toEqual({ commits: 2, added: 11, deleted: 3 })
  expect(days.get('2026-10-06')).toBeUndefined()
  expect(summary(c)).toEqual({ commits: 5, added: 15, deleted: 14 })
})

test('levelFor', () => {
  expect(levelFor(0, 10)).toBe(0)
  expect(levelFor(1, 10)).toBe(1)
  expect(levelFor(10, 10)).toBe(4)
  expect(levelFor(5, 10)).toBe(2)
  expect(levelFor(3, 0)).toBe(0)
})

test('buildGrid: weeks are Sunday columns, today ends the last one', () => {
  const grid = buildGrid(bucketByDay(parseLog(LOG)), NOW, 4)
  expect(grid.weeks.length).toBe(4)
  const last = grid.weeks[3]!
  // 2026-10-07 is a Wednesday: Sun 4, Mon 5, Tue 6, Wed 7, then nothing
  expect(last.map(d => d?.key)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', undefined, undefined, undefined].map(k => k ?? undefined))
  expect(last[4]).toBeNull()
  expect(last[3]).toMatchObject({ commits: 2, level: 4 })
  expect(last[1]).toMatchObject({ commits: 1, level: 2 })
  expect(grid.weeks[0]![0]!.key).toBe('2026-09-13')
  expect(grid.max).toBe(2)
  expect(grid.total).toBe(4) // Sep 1 is outside the four weeks
})

test('monthLabels: first column of each month, in order', () => {
  const grid = buildGrid(new Map(), NOW, 10)
  const labels = monthLabels(grid)
  expect(labels.map(l => l.label)).toEqual(['Aug', 'Sep', 'Oct'])
  expect(labels[0]!.col).toBe(0)
})

test('dailySeries / resample', () => {
  const s = dailySeries(bucketByDay(parseLog(LOG)), NOW, 7)
  expect(s).toEqual([0, 0, 0, 0, 1, 0, 2].map((v, i) => (i === 3 ? 0 : v)).map((v, i) => (i === 3 ? 0 : v)))
  expect(resample([1, 3, 5, 7], 2)).toEqual([2, 6])
  expect(resample([4], 3)).toEqual([4, 4, 4])
  expect(resample([1, 2], 0)).toEqual([])
})

test('niceMax / fmt', () => {
  expect(niceMax(0)).toBe(1)
  expect(niceMax(3)).toBe(5)
  expect(niceMax(7)).toBe(10)
  expect(niceMax(0.3)).toBe(0.5)
  expect(niceMax(130)).toBe(200)
  expect(fmt(0)).toBe('0')
  expect(fmt(2.5)).toBe('2.5')
  expect(fmt(12.04)).toBe('12')
  expect(fmt(250)).toBe('250')
})

test('weekdayTotals / authorTotals / inRange / dayKey', () => {
  const c = parseLog(LOG)
  const w = weekdayTotals(c)
  expect(w[3]).toBe(3) // Wednesdays: Oct 7 x2, Sep 30
  expect(w[1]).toBe(1) // Monday Oct 5
  expect(w.reduce((a, b) => a + b)).toBe(5)
  expect(authorTotals(c, 2)).toEqual([{ name: 'Ada', count: 3 }, { name: 'Bob', count: 1 }])
  expect(inRange(c, NOW, 4).length).toBe(4)
  expect(dayKey(new Date(2026, 0, 5).getTime())).toBe('2026-01-05')
})
