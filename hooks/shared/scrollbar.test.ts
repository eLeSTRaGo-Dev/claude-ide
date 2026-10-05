import { expect, test } from 'claude-code/testing'

import { scrollbar } from './scrollbar'

test('scrollbar: blank when everything fits', () => {
  expect(scrollbar(5, 5, 0, 4)).toEqual([' ', ' ', ' ', ' '])
  expect(scrollbar(3, 10, 0, 2)).toEqual([' ', ' '])
  expect(scrollbar(10, 5, 0, 0)).toEqual([])
})

test('scrollbar: proportional thumb, at least one row', () => {
  expect(scrollbar(20, 10, 0, 10).join('')).toBe('┃┃┃┃┃│││││')
  expect(scrollbar(1000, 10, 0, 10).join('')).toBe('┃│││││││││')
})

test('scrollbar: thumb follows the offset to the end', () => {
  expect(scrollbar(20, 10, 10, 10).join('')).toBe('│││││┃┃┃┃┃')
  expect(scrollbar(20, 10, 5, 10).join('')).toBe('│││┃┃┃┃┃││')
  expect(scrollbar(20, 10, 99, 10).join('')).toBe('│││││┃┃┃┃┃')
  expect(scrollbar(20, 10, -3, 10).join('')).toBe('┃┃┃┃┃│││││')
})
