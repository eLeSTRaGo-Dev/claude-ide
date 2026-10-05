import { expect, test } from 'claude-code/testing'

import {
  ASSETS, CELL_H, CELL_W, MAX_COLUMNS, assetOf, fitCells, frameFromRgb, hashOf, imagePixels, magickRgbArgv,
  rsvgArgv, shmPath, videoFrame,
} from './host'

test('frameFromRgb: bytes to packed pixels', () => {
  const f = frameFromRgb(Uint8Array.of(255, 0, 0, 0, 1, 2, 9, 9), 2, 2)
  expect(f.width).toBe(2)
  expect(f.height).toBe(2)
  expect(Array.from(f.rgb)).toEqual([0xff0000, 0x000102, 0, 0])
})

test('fitCells: aspect kept, capped by the room', () => {
  const a = 800 / 480
  const wide = fitCells(200, 20, a)
  expect(wide.rows).toBe(20)
  expect(wide.columns).toBe(Math.floor((20 * CELL_H * a) / CELL_W))
  const narrow = fitCells(40, 50, a)
  expect(narrow.columns).toBe(40)
  expect(narrow.rows).toBe(Math.round((40 * CELL_W) / (CELL_H * a)))
  expect(fitCells(500, 500, a).columns).toBeLessThanOrEqual(MAX_COLUMNS)
  expect(fitCells(0, 0, a)).toEqual({ columns: 1, rows: 1 })
})

test('imagePixels: cells times the assumed cell size', () => {
  expect(imagePixels(60, 18)).toEqual({ width: 60 * CELL_W, height: 18 * CELL_H })
})

test('hashOf / shmPath / videoFrame', () => {
  expect(hashOf('a')).toHaveLength(8)
  expect(hashOf('a')).not.toBe(hashOf('b'))
  expect(shmPath('abcd1234', 'png')).toBe('/dev/shm/gfx-gallery-abcd1234.png')
  expect(videoFrame('/d', 0)).toBe('/d/f001.rgb')
})

test('argv and assets', () => {
  expect(rsvgArgv('a.svg', '/o.png', 600, 360).slice(0, 5)).toEqual(['rsvg-convert', '-w', '600', '-h', '360'])
  expect(magickRgbArgv('a.png', '/o.rgb', 60, 36).at(-1)).toBe('rgb:/o.rgb')
  expect(assetOf('nope')).toBe(ASSETS[0])
})
