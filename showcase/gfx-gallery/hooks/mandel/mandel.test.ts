import { expect, test } from 'claude-code/testing'

import { HOME, cellToPixel, describe, escape, panBy, pixelToComplex, renderFrame, shade, svgOfFrame, zoomAt } from './mandel'

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)) + 1e-9)

test('escape: set members and fast escapers', () => {
  expect(escape(0, 0, 100)).toBe(-1)
  expect(escape(-1, 0, 100)).toBe(-1)
  expect(escape(2, 2, 100)).toBeGreaterThan(0)
  expect(escape(2, 2, 100)).toBeLessThan(3)
  // smooth: nearby points give different fractional counts
  expect(escape(0.3, 0.6, 200)).not.toBe(Math.round(escape(0.3, 0.6, 200)))
})

test('pixelToComplex: center pixel is the view center', () => {
  const p = pixelToComplex(HOME, 100, 25, 100, 50, 49.5, 24.5)
  near(p.re, HOME.cx)
  near(p.im, HOME.cy)
})

test('cellToPixel maps cells to the encoder grid', () => {
  expect(cellToPixel('half', 10, 5, 5, 2.5)).toEqual({ px: 5, py: 5 })
  expect(cellToPixel('braille', 10, 5, 5, 2.5)).toEqual({ px: 10, py: 10 })
})

test('zoomAt: the clicked point becomes the center, scale halves', () => {
  for (const enc of ['half', 'quad', 'braille'] as const) {
    const z = zoomAt(HOME, enc, 100, 25, 0, 0, 2)
    near(z.scale, HOME.scale / 2)
    // top-left corner of the region
    near(z.cx, HOME.cx - 50 * HOME.scale)
    near(z.cy, HOME.cy - 25 * HOME.scale) // half a screen of rows, 2 * scale a row
  }
  const out = zoomAt(HOME, 'half', 100, 25, 50, 12.5, 0.5)
  near(out.cx, HOME.cx)
  near(out.scale, HOME.scale * 2)
})

test('panBy: dragging right moves the view left; a cell column is `scale`', () => {
  const p = panBy(HOME, 'half', 100, 25, 10, 0)
  near(p.cx, HOME.cx - 10 * HOME.scale)
  const q = panBy(HOME, 'braille', 100, 25, 10, 0)
  near(q.cx, p.cx)
  const v = panBy(HOME, 'half', 100, 25, 0, 5)
  near(v.cy, HOME.cy - 10 * HOME.scale)
  near(panBy(HOME, 'quad', 100, 25, 0, 5).cy, v.cy)
  near(panBy(HOME, 'braille', 100, 25, 0, 5).cy, v.cy)
})

test('renderFrame: sized for the encoder, set interior black, under budget', () => {
  const t0 = Date.now()
  const f = renderFrame(HOME, 'half', 160, 50, 96)
  const ms = Date.now() - t0
  expect(f.width).toBe(160)
  expect(f.height).toBe(100)
  expect(f.rgb[50 * 160 + 100]).toBe(shade(-1)) // c = -0.5+0i region, inside
  expect(new Set(f.rgb).size).toBeGreaterThan(5)
  expect(ms).toBeLessThan(500)
})

test('svgOfFrame: valid size and a path per color', () => {
  const f = renderFrame(HOME, 'half', 60, 15, 64)
  const svg = svgOfFrame(f, 480, 240)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.length).toBeLessThan(131072)
  expect(svg).toContain('<path')
})

test('describe names center and magnification', () => {
  expect(describe(HOME)).toContain('x1')
})
