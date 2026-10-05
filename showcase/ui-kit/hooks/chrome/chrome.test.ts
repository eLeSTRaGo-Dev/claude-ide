import { expect, test } from 'claude-code/testing'

import { createFrame, encode } from '../shared/raster'
import { THEMES } from '../shared/theme'
import {
  ROWS, at, cellColor, coverage, ensureDark, flat, hex, layoutOf, paintButton, paintRRect, paintRing,
  paintScene, paintShadow, paintText, parseHex, px, readable, rrectDistance, textWidth, variantOf, vertical,
} from './chrome'

const BG = 0x101010
const WHITE = 0xffffff

const blank = (w: number, h: number) => {
  const f = createFrame(w, h)
  f.rgb.fill(BG)

  return f
}

test('hex / parseHex round trip', () => {
  expect(hex(0x0a0b0c)).toBe('#0a0b0c')
  expect(parseHex('#0a0b0c')).toBe(0x0a0b0c)
  expect(parseHex('nope')).toBe(0)
})

test('readable / ensureDark', () => {
  expect(readable(0x000000)).toBe(0xffffff)
  expect(readable(0xffffff)).toBe(0x111111)
  const d = ensureDark(0xffffff, 100)
  expect(d & 255).toBeLessThanOrEqual(100)
  expect(ensureDark(0x101010, 100)).toBe(0x101010)
})

test('vertical gradient: ends and middle', () => {
  const g = vertical({ x: 0, y: 0, w: 4, h: 3 }, [0x000000, 0xff0000])
  expect(g(0, 0)).toBe(0x000000)
  expect(g(3, 2)).toBe(0xff0000)
  expect(g(1, 1) >> 16).toBe(128)
})

test('rrectDistance: inside negative, outside positive, corner cut', () => {
  const r = { x: 0, y: 0, w: 10, h: 10 }
  expect(rrectDistance(r, 3, 5, 5)).toBeLessThan(0)
  expect(rrectDistance(r, 3, 20, 5)).toBeGreaterThan(0)
  // the corner pixel is outside a radius-3 rounded rect but inside a square one
  expect(coverage(rrectDistance(r, 3, 0, 0))).toBeLessThan(0.5)
  expect(coverage(rrectDistance(r, 0, 0, 0))).toBe(1)
})

test('paintRRect: interior solid, corner blended, outside untouched', () => {
  const f = blank(12, 12)
  paintRRect(f, { x: 2, y: 2, w: 8, h: 8 }, 3, flat(WHITE))
  expect(at(f, 6, 6)).toBe(WHITE)
  expect(at(f, 0, 0)).toBe(BG)
  const corner = at(f, 2, 2)
  expect(corner).not.toBe(WHITE)
  expect(corner).toBeGreaterThanOrEqual(BG)
})

test('paintRRect: out-of-frame rects do not throw', () => {
  const f = blank(4, 4)
  paintRRect(f, { x: -5, y: -5, w: 30, h: 30 }, 4, flat(WHITE))
  expect(at(f, 2, 2)).toBe(WHITE)
})

test('paintShadow: darkens beyond the rect down-right, not up-left', () => {
  const f = createFrame(20, 20)
  f.rgb.fill(WHITE)
  paintShadow(f, { x: 4, y: 4, w: 8, h: 8 }, 2, 2, 2, 0x000000, 0.5, 2)
  expect(at(f, 13, 13)).toBeLessThan(WHITE)
  expect(at(f, 2, 2)).toBe(WHITE)
})

test('paintRing: lights only the edge band', () => {
  const f = blank(12, 12)
  paintRing(f, { x: 1, y: 1, w: 10, h: 10 }, 2, flat(WHITE))
  expect(at(f, 6, 1)).toBeGreaterThan(BG)
  expect(at(f, 6, 6)).toBe(BG)
})

test('paintText: lit pixels of a glyph, scale and width', () => {
  expect(textWidth('AB', 2)).toBe(14)
  const f = blank(20, 12)
  paintText(f, 'H', 0, 0, 2, flat(WHITE))
  expect(at(f, 0, 0)).toBe(WHITE)
  expect(at(f, 2, 0)).toBe(BG)
  expect(at(f, 4, 0)).toBe(WHITE)
  expect(at(f, 2, 4)).toBe(WHITE)
})

test('layoutOf: controls fit the columns and do not overlap', () => {
  const L = layoutOf(80)
  expect(L.columns).toBe(80)
  const b = L.buttons
  expect(b.primary.x + b.primary.w).toBeLessThan(b.secondary.x)
  expect(b.secondary.x + b.secondary.w).toBeLessThan(b.danger.x)
  expect(b.danger.x + b.danger.w).toBeLessThan(b.icon.x)
  expect(L.card.y + L.card.h).toBeLessThanOrEqual(ROWS)
  expect(layoutOf(10).columns).toBeGreaterThanOrEqual(60)
})

test('paintButton: pressed is darker at the top and drops the shadow', () => {
  const v = variantOf(THEMES.claude, 'primary')
  const cell = { x: 1, y: 1, w: 8, h: 3 }
  const up = blank(24, 14)
  const down = blank(24, 14)
  paintButton(up, cell, v, false, 3)
  paintButton(down, cell, v, true, 3)
  const r = px(cell)
  const lum = (c: number) => (c >> 16) + ((c >> 8) & 255) + (c & 255)
  expect(lum(at(down, r.x + 6, r.y + 2))).toBeLessThan(lum(at(up, r.x + 6, r.y + 2)))
  // a shadow pixel just below-right of the unpressed button
  expect(at(up, r.x + r.w + 1, r.y + r.h)).not.toBe(BG)
  expect(at(down, r.x + r.w + 1, r.y + r.h)).toBe(BG)
})

test('paintScene: size, pressed swaps pixels, themes differ', () => {
  const claude = paintScene(80, THEMES.claude, { toggle: true })
  expect(claude.width).toBe(160)
  expect(claude.height).toBe(ROWS * 2)
  const pressed = paintScene(80, THEMES.claude, { pressed: 'primary', toggle: true })
  expect(Array.from(pressed.rgb)).not.toEqual(Array.from(claude.rgb))
  const off = paintScene(80, THEMES.claude, { toggle: false })
  expect(Array.from(off.rgb)).not.toEqual(Array.from(claude.rgb))
  const light = paintScene(80, THEMES.light, { toggle: true })
  expect(light.rgb[0]).not.toBe(claude.rgb[0])
  // page background is painted everywhere
  expect(claude.rgb.every(c => c <= 0xffffff)).toBe(true)
})

test('cellColor: averages the cell and encodes to a valid raster', () => {
  const f = createFrame(2, 2)
  f.rgb.set([0x000000, 0x000000, 0xfefefe, 0xfefefe])
  expect(cellColor(f, 0, 0)).toBe('#7f7f7f')
  const scene = paintScene(70, THEMES.neon, { toggle: true })
  const cells = encode(scene, 'quad', 70, ROWS)
  expect(cells.length).toBe(Math.ceil((70 * ROWS * 12) / 3) * 4)
})
