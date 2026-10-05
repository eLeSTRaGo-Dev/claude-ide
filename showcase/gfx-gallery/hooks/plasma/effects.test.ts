import { expect, test } from 'claude-code/testing'

import { createFire, createPlasma, fireColors, frameKb, plasmaColors, rng, sinT } from './effects'

test('sinT matches sin over a turn', () => {
  expect(Math.abs(sinT(0) - 0)).toBeLessThan(0.005)
  expect(Math.abs(sinT(0.25) - 1)).toBeLessThan(0.005)
  expect(Math.abs(sinT(0.75) - -1)).toBeLessThan(0.005)
  expect(Math.abs(sinT(-0.25) - -1)).toBeLessThan(0.005)
  expect(Math.abs(sinT(3.25) - 1)).toBeLessThan(0.005)
})

test('plasma fills every pixel from its palette and changes over time', () => {
  const fx = createPlasma(32, 16)
  fx.step()
  const first = Uint32Array.from(fx.frame.rgb)
  const colors = new Set(plasmaColors)
  expect(first.every(c => colors.has(c))).toBe(true)
  expect(new Set(first).size).toBeGreaterThan(20)
  for (let i = 0; i < 20; i++) fx.step()
  expect(fx.frame.rgb).not.toEqual(first)
})

test('fire is hot at the bottom, dark at the top, and deterministic per seed', () => {
  const run = (seed: number) => {
    const fx = createFire(24, 24, rng(seed))
    for (let i = 0; i < 60; i++) fx.step()
    return fx.frame
  }
  const a = run(7)
  const bottom = a.rgb.subarray(23 * 24)
  const top = a.rgb.subarray(0, 24)
  const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)
  const avg = (xs: Uint32Array) => xs.reduce((s, c) => s + lum(c), 0) / xs.length
  expect(avg(bottom)).toBeGreaterThan(avg(top) + 200)
  expect(a.rgb.every(c => new Set(fireColors).has(c))).toBe(true)
  expect(run(7).rgb).toEqual(a.rgb)
})

test('rng stays in 0..1', () => {
  const r = rng(3)
  for (let i = 0; i < 1000; i++) {
    const v = r()
    expect(v >= 0 && v < 1).toBe(true)
  }
})

test('frameKb counts 16 base64 bytes a cell', () => {
  expect(Math.abs(frameKb(100, 40) - 62.5)).toBeLessThan(0.05)
})
