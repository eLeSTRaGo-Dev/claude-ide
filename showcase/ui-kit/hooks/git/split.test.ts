import { expect, test } from 'claude-code/testing'

import { dragTo, fractionOf, layoutOf, splitAt } from './split'

test('splitAt: floors the fraction of the total', () => {
  expect(splitAt(100, 0.3, 12)).toBe(30)
  expect(splitAt(143, 0.2, 12)).toBe(28)
})

test('splitAt: each side keeps the minimum', () => {
  expect(splitAt(100, 0.01, 12)).toBe(12)
  expect(splitAt(100, 0.99, 12)).toBe(88)
  expect(splitAt(12, 0.5, 4)).toBe(6)
  expect(splitAt(8, 0.9, 4)).toBe(4)
})

test('splitAt: a total too small for two minimums halves', () => {
  expect(splitAt(10, 0.9, 12)).toBe(5)
  expect(splitAt(0, 0.5, 4)).toBe(0)
})

test('fractionOf: round trips through splitAt', () => {
  expect(fractionOf(30, 100)).toBe(0.3)
  expect(fractionOf(1, 0)).toBe(0)
  for (const total of [37, 100, 143, 170])
    for (const cells of [12, 13, 24, 25])
      expect(splitAt(total, fractionOf(cells, total), 12)).toBe(cells)
})

test('dragTo: start plus travel, clamped to each side', () => {
  expect(dragTo(100, 30, 10, 12)).toBe(0.4)
  expect(dragTo(100, 30, -100, 12)).toBe(0.12)
  expect(dragTo(100, 30, 100, 12)).toBe(0.88)
  expect(dragTo(100, 30, 0.4, 12)).toBe(0.3)
  expect(dragTo(0, 30, 10, 12)).toBe(0)
})

test('layoutOf: keeps the named fractions strictly inside (0, 1)', () => {
  expect(layoutOf({ tree: 0.5 }, ['tree'])).toEqual({ tree: 0.5 })
  expect(layoutOf({ side: 0.4, info: 7, files: 0.6, other: 0.3 }, ['side', 'info', 'files'])).toEqual({
    side: 0.4,
    files: 0.6,
  })
  expect(layoutOf({ tree: 0 }, ['tree'])).toBeUndefined()
  expect(layoutOf({ tree: 1 }, ['tree'])).toBeUndefined()
  expect(layoutOf({ tree: NaN }, ['tree'])).toBeUndefined()
  expect(layoutOf({ tree: '0.5' }, ['tree'])).toBeUndefined()
})

test('layoutOf: anything but an object is no layout', () => {
  for (const value of ['x', 0.5, null, undefined, [0.5], true]) expect(layoutOf(value, ['tree'])).toBeUndefined()
  expect(layoutOf({}, ['tree'])).toBeUndefined()
})
