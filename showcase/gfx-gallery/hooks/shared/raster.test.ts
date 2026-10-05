import { expect, test } from 'claude-code/testing'

import {
  DEFAULT, cellsFromWords, createFrame, encode, hsv, lerpColor, packCell, palette, pixelsFor, rgb,
} from './raster'

function decode(b64: string): Uint32Array {
  const bytes = Uint8Array.fromBase64(b64)
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

const RED = 0xff0000
const BLUE = 0x0000ff
const BLACK = 0
const WHITE = 0xffffff

test('pixelsFor: pixels per encoder', () => {
  expect(pixelsFor('half', 10, 5)).toEqual({ width: 10, height: 10 })
  expect(pixelsFor('quad', 10, 5)).toEqual({ width: 20, height: 10 })
  expect(pixelsFor('braille', 10, 5)).toEqual({ width: 20, height: 20 })
})

test('cellsFromWords / packCell: round trip', () => {
  const w = new Uint32Array(6)
  packCell(w, 1, 0x2588, 0xff8800, DEFAULT)
  const d = decode(cellsFromWords(w))
  expect(d.length).toBe(6)
  expect(Array.from(d.slice(3))).toEqual([0x2588, 0xff8800, DEFAULT])
})

test('half: top is fg, bottom is bg; equal pixels are a space', () => {
  const f = createFrame(2, 2)
  f.rgb.set([RED, BLUE, BLUE, BLUE])
  const d = decode(encode(f, 'half', 2, 1))
  expect(d.length).toBe(6)
  expect(Array.from(d.slice(0, 3))).toEqual([0x2580, RED, BLUE])
  expect(Array.from(d.slice(3, 6))).toEqual([0x20, BLUE, BLUE])
})

const GLYPHS: [number, number][] = [
  [1, 0x2598], [2, 0x259d], [3, 0x2580], [4, 0x2596], [5, 0x258c], [6, 0x259e], [7, 0x259b],
  [8, 0x2597], [9, 0x259a], [10, 0x2590], [11, 0x259c], [12, 0x2584], [13, 0x2599], [14, 0x259f],
]

test('quad: every mask maps to its glyph', () => {
  for (const [mask, glyph] of GLYPHS) {
    const f = createFrame(2, 2)
    for (let k = 0; k < 4; k++) f.rgb[(k >> 1) * 2 + (k & 1)] = mask & (1 << k) ? WHITE : BLACK
    const d = decode(encode(f, 'quad', 1, 1))
    expect(d[0]).toBe(glyph)
    expect(d[1]).toBe(WHITE)
    expect(d[2]).toBe(BLACK)
  }
})

test('quad: a flat block is a space with its color as bg', () => {
  const f = createFrame(2, 2)
  f.rgb.fill(RED)
  const d = decode(encode(f, 'quad', 1, 1))
  expect(Array.from(d)).toEqual([0x20, RED, RED])
})

test('quad: groups average their pixels', () => {
  const f = createFrame(2, 2)
  f.rgb.set([WHITE, WHITE, BLACK, 0x020202])
  const d = decode(encode(f, 'quad', 1, 1))
  expect(d[0]).toBe(0x2580)
  expect(d[1]).toBe(WHITE)
  expect(d[2]).toBe(0x010101)
})

test('quad: size is columns * rows triplets', () => {
  const f = createFrame(8, 6)
  expect(decode(encode(f, 'quad', 4, 3)).length).toBe(36)
})

test('braille: each dot sets its bit', () => {
  const bits: [number, number, number][] = [
    [0, 0, 0x01], [0, 1, 0x02], [0, 2, 0x04], [1, 0, 0x08],
    [1, 1, 0x10], [1, 2, 0x20], [0, 3, 0x40], [1, 3, 0x80],
  ]
  for (const [x, y, bit] of bits) {
    const f = createFrame(2, 4)
    f.rgb[y * 2 + x] = WHITE
    const d = decode(encode(f, 'braille', 1, 1))
    expect(d[0]).toBe(0x2800 + bit)
    expect(d[1]).toBe(WHITE)
    expect(d[2]).toBe(DEFAULT)
  }
})

test('braille: all lit, fg is the average, empty is a space', () => {
  const f = createFrame(4, 4)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) f.rgb[y * 4 + x] = x ? 0xffffff : 0xfefefe
  const d = decode(encode(f, 'braille', 2, 1))
  expect(d[0]).toBe(0x28ff)
  expect(d[1]).toBe(0xfefefe + 0x010101 / 2 > 0 ? rgb(254.5, 254.5, 254.5) : 0)
  expect(Array.from(d.slice(3, 6))).toEqual([0x20, DEFAULT, DEFAULT])
})

test('braille: threshold and bg key', () => {
  const f = createFrame(2, 4)
  f.rgb.set([0x404040, BLACK], 0)
  expect(decode(encode(f, 'braille', 1, 1))[0]).toBe(0x20)
  expect(decode(encode(f, 'braille', 1, 1, { threshold: 10 }))[0]).toBe(0x2801)
  const keyed = decode(encode(f, 'braille', 1, 1, { bg: BLACK }))
  expect(Array.from(keyed)).toEqual([0x2801, 0x404040, BLACK])
})

test('encoders: code points stay printable width-1 BMP', () => {
  const f = createFrame(16, 16)
  for (let i = 0; i < f.rgb.length; i++) f.rgb[i] = (i * 2654435761) >>> 8
  for (const enc of ['half', 'quad', 'braille'] as const) {
    const d = decode(encode(f, enc, 4, 4))
    for (let i = 0; i < 16; i++) expect(d[i * 3]! < 0x10000).toBe(true)
  }
})

test('color helpers', () => {
  expect(rgb(255, 128, 0)).toBe(0xff8000)
  expect(rgb(300, -5, 0.4)).toBe(0xff0000)
  expect(lerpColor(BLACK, WHITE, 0.5)).toBe(0x808080)
  expect(hsv(0, 1, 1)).toBe(0xff0000)
  expect(hsv(1 / 3, 1, 1)).toBe(0x00ff00)
  expect(hsv(2 / 3, 1, 1)).toBe(0x0000ff)
  expect(hsv(0.5, 0, 1)).toBe(WHITE)
  expect(palette([BLACK, RED, WHITE], 0)).toBe(BLACK)
  expect(palette([BLACK, RED, WHITE], 0.5)).toBe(RED)
  expect(palette([BLACK, RED, WHITE], 2)).toBe(WHITE)
})
