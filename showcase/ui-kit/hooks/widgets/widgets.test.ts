import { expect, test } from 'claude-code/testing'

import { hsvToHex, nearerThumb, snap, starsFromX, thumbCell, toggleCell, toggleStep, valueFromX } from './widgets'

test('valueFromX maps ends and middle, with sub-cell precision', () => {
  expect(valueFromX(0.5, 21, 0, 100, 1)).toBe(0)
  expect(valueFromX(20.5, 21, 0, 100, 1)).toBe(100)
  expect(valueFromX(10.5, 21, 0, 100, 1)).toBe(50)
  expect(valueFromX(10.75, 21, 0, 100, 1)).toBe(51)
  expect(valueFromX(-5, 21, 0, 100, 1)).toBe(0)
  expect(valueFromX(99, 21, 10, 90, 5)).toBe(90)
})

test('thumbCell inverts valueFromX at cell centers', () => {
  for (const v of [0, 25, 50, 100]) expect(valueFromX(thumbCell(v, 0, 100, 21) + 0.5, 21, 0, 100, 1)).toBe(v)
  expect(thumbCell(10, 10, 90, 30)).toBe(0)
})

test('snap, nearerThumb, starsFromX', () => {
  expect(snap(47, 10, 90, 5)).toBe(45)
  expect(snap(1000, 10, 90, 5)).toBe(90)
  expect(nearerThumb(20, 10, 80)).toBe('lo')
  expect(nearerThumb(70, 10, 80)).toBe('hi')
  expect(starsFromX(0, 5)).toBe(1)
  expect(starsFromX(5, 5)).toBe(3)
  expect(starsFromX(40, 5)).toBe(5)
})

test('hsvToHex', () => {
  expect(hsvToHex(0, 100, 100)).toBe('#ff0000')
  expect(hsvToHex(120, 100, 100)).toBe('#00ff00')
  expect(hsvToHex(240, 100, 100)).toBe('#0000ff')
  expect(hsvToHex(0, 0, 100)).toBe('#ffffff')
  expect(hsvToHex(200, 50, 0)).toBe('#000000')
  expect(hsvToHex(360, 100, 100)).toBe('#ff0000')
})

test('toggle animation reaches both ends in about 150 ms', () => {
  let p = 0
  for (let i = 0; i < 3; i++) p = toggleStep(p, true, 50, 150)
  expect(p).toBe(1)
  expect(toggleCell(1, 4)).toBe(3)
  expect(toggleCell(0, 4)).toBe(0)
  expect(Math.abs(toggleStep(1, false, 50, 150) - 2 / 3)).toBeLessThan(1e-9)
})
