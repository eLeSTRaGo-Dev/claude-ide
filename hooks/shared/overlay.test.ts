import { expect, test } from 'claude-code/testing'

import { cardHeight, cardWidth, centerOffset, darken, menuSize, modalBox, wrapText } from './overlay'

test('centerOffset', () => {
  expect(centerOffset(20, 10)).toBe(5)
  expect(centerOffset(21, 10)).toBe(5)
  expect(centerOffset(5, 10)).toBe(0)
})

test('wrapText', () => {
  expect(wrapText('aa bb cc', 5)).toEqual(['aa bb', 'cc'])
  expect(wrapText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  expect(wrapText('', 5)).toEqual([''])
})

test('modalBox centers card plus shadow', () => {
  const b = modalBox(100, 40, 48, cardHeight(2))
  expect(b.left).toBe(25)
  expect(b.shadowLeft).toBe(b.left + 1)
  expect(b.shadowTop).toBe(b.top + 1)
  expect(cardWidth(30)).toBe(24)
  expect(cardWidth(200)).toBe(48)
})

test('darken / menuSize', () => {
  expect(darken('#ffffff', 0.5)).toBe('#808080')
  expect(darken('red', 0.5)).toBe('red')
  const s = menuSize([{ label: 'Edit', icon: 'e', kbd: 'ctrl+e' }, { label: '', separator: true }])
  expect(s.height).toBe(4)
  expect(s.width).toBeGreaterThan(12)
})
