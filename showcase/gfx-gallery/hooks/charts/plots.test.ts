import { expect, test } from 'claude-code/testing'

import { DEFAULT } from '../shared/raster'
import { bucketByDay, buildGrid, parseLog } from './data'
import { LOG, NOW } from './fixtures'
import { BAR, LEVELS, barCells, heatCells, lineCells } from './plots'
import { barsSvg, esc, heatSvg, lineSvg } from './svg'

const words = (b64: string): Uint32Array => {
  const bytes = Uint8Array.fromBase64(b64)

  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

test('heatCells: colored half block then a gap per week; future days blank', () => {
  const grid = buildGrid(bucketByDay(parseLog(LOG)), NOW, 4)
  const h = heatCells(grid)
  expect([h.columns, h.rows]).toEqual([8, 7])
  const w = words(h.cells)
  expect(w.length).toBe(8 * 7 * 3)
  const cell = (row: number, col: number) => Array.from(w.slice((row * 8 + col) * 3, (row * 8 + col) * 3 + 3))
  expect(cell(3, 6)).toEqual([0x2580, LEVELS[4]!, DEFAULT]) // Wed Oct 7
  expect(cell(3, 7)).toEqual([0x20, DEFAULT, DEFAULT])
  expect(cell(4, 6)[0]).toBe(0x20) // Thursday: future
  expect(cell(0, 0)).toEqual([0x2580, LEVELS[0]!, DEFAULT])
})

test('lineCells: a rising line lights braille at the bottom left and top right', () => {
  const w = words(lineCells([0, 1, 2, 3], 3, 2, 1))
  expect(w.length).toBe(6)
  const bits = (i: number) => w[i * 3]! - 0x2800
  expect(w[0]).toBeGreaterThan(0x2800)
  expect(bits(0) & 0x44).not.toBe(0) // left column, lower dots
  expect(bits(1) & 0xb8).not.toBe(0) // right cell, upper dots
})

test('barCells: eighth-block tops give sub-cell heights', () => {
  const b = barCells([1, 4], 4, 2, 1, 2)
  expect(b.columns).toBe(6)
  const w = words(b.cells)
  const glyph = (r: number, c: number) => w[(r * 6 + c) * 3]
  expect(glyph(1, 3)).toBe(0x2588) // full bar, bottom row
  expect(glyph(0, 3)).toBe(0x2588)
  expect(glyph(1, 0)).toBe(0x2584) // 1/4 of 16 eighths = 4 -> half block
  expect(glyph(0, 0)).toBe(0x20)
  expect(glyph(1, 2)).toBe(0x20) // gap
  expect(w[(1 * 6 + 0) * 3 + 1]).toBe(BAR)
})

test('esc', () => {
  expect(esc(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
})

test('heatSvg: a rect with a tooltip per drawn day', () => {
  const grid = buildGrid(bucketByDay(parseLog(LOG)), NOW, 4)
  const s = heatSvg(grid)
  expect(s.startsWith('<svg')).toBe(true)
  expect(s).toContain('<title>2 commits on 2026-10-07</title>')
  expect(s).toContain('<title>1 commit on 2026-10-05</title>')
  expect(s).toContain('<title>0 commits on 2026-09-13</title>')
  expect((s.match(/<rect /g) ?? []).length).toBe(grid.weeks.flat().filter(d => d).length)
  expect(s).toContain('.day:hover')
  expect(s.length).toBeLessThan(131072)
  const full = heatSvg(buildGrid(new Map(), NOW, 53))
  expect(full.length).toBeLessThan(131072)
})

test('lineSvg / barsSvg: paths, hover points, escaped labels', () => {
  const l = lineSvg([0, 1, 2], ['a<', 'b', 'c'], 300)
  expect(l).toContain('<path class="ln" d="M')
  expect((l.match(/class="pt"/g) ?? []).length).toBe(3)
  expect(l).toContain('a&lt;: 0 commits/day')
  expect(lineSvg([], [], 300)).not.toContain('<path')
  const b = barsSvg(['Sun', 'Mon'], [3, 0], 300)
  expect(b).toContain('<title>Sun: 3 commits</title>')
  expect((b.match(/class="bar"/g) ?? []).length).toBe(2)
})
