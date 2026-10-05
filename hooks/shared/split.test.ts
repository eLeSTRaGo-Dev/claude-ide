import { expect, test } from 'claude-code/testing'

import { fractionOf, splitAt } from './split'

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
