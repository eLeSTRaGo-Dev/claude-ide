// Pure animation effects: each fills an RGB `Frame` per step. Tables are built
// once per size so a frame costs a few array reads per pixel.
import { createFrame, palette, rgb } from '../shared/raster'
import type { Frame } from '../shared/raster'

export type Effect = {
  frame: Frame
  /** Advances the simulation one tick and repaints `frame`. */
  step: () => void
}

const TAU = Math.PI * 2
const SIN_SIZE = 1024
const SIN = new Float32Array(SIN_SIZE)
for (let i = 0; i < SIN_SIZE; i++) SIN[i] = Math.sin((i / SIN_SIZE) * TAU)

/** sin(turns * 2pi) by table; turns may be any real. */
export const sinT = (turns: number): number => SIN[Math.floor((turns - Math.floor(turns)) * SIN_SIZE) & (SIN_SIZE - 1)]!

const PLASMA_STOPS = [
  rgb(20, 0, 60),
  rgb(120, 0, 160),
  rgb(255, 40, 120),
  rgb(255, 190, 60),
  rgb(60, 220, 200),
  rgb(20, 40, 180),
  rgb(20, 0, 60),
]
const FIRE_STOPS = [
  rgb(0, 0, 0),
  rgb(60, 0, 0),
  rgb(170, 20, 0),
  rgb(240, 100, 0),
  rgb(255, 190, 30),
  rgb(255, 255, 140),
  rgb(255, 255, 255),
]

export const PALETTE_SIZE = 256
const table = (stops: number[]): Uint32Array => {
  const out = new Uint32Array(PALETTE_SIZE)
  for (let i = 0; i < PALETTE_SIZE; i++) out[i] = palette(stops, i / (PALETTE_SIZE - 1))
  return out
}
export const plasmaColors = table(PLASMA_STOPS)
export const fireColors = table(FIRE_STOPS)

/** Classic sum-of-sines plasma; `speed` is the phase advance per step in turns. */
export function createPlasma(width: number, height: number, speed = 0.004): Effect {
  const frame = createFrame(width, height)
  const radial = new Float32Array(width * height)
  const cx = width / 2
  const cy = height / 2
  // Scale by the short side so the pattern looks alike at any size.
  const unit = 1 / Math.max(1, Math.min(width, height))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) radial[y * width + x] = Math.hypot(x - cx, y - cy) * unit
  }
  const colSin = new Float32Array(width)
  let t = 0

  return {
    frame,
    step() {
      t += speed
      for (let x = 0; x < width; x++) colSin[x] = sinT(x * unit * 2.2 + t * 3)
      for (let y = 0; y < height; y++) {
        const rowSin = sinT(y * unit * 2.9 + t * 2)
        const rowBase = y * width
        for (let x = 0; x < width; x++) {
          const diag = sinT((x + y) * unit * 1.6 - t * 5)
          const rad = sinT(radial[rowBase + x]! * 3.2 - t * 4)
          // sum in -4..4 -> 0..1
          const v = (colSin[x]! + rowSin + diag + rad) * 0.125 + 0.5
          frame.rgb[rowBase + x] = plasmaColors[Math.min(PALETTE_SIZE - 1, Math.max(0, (v * PALETTE_SIZE) | 0))]!
        }
      }
    },
  }
}

/** xorshift32: a seeded `() => 0..1`. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

/** Doom-style fire: a heat grid cooled and drifted upward from a hot bottom row. */
export function createFire(width: number, height: number, random: () => number = rng(1)): Effect {
  const frame = createFrame(width, height)
  const heat = new Uint8Array(width * height)
  const last = (height - 1) * width
  for (let x = 0; x < width; x++) heat[last + x] = 255
  // Cooling scales with height so flames reach about the same fraction of it.
  const cool = Math.max(1, Math.round(260 / Math.max(8, height)))

  return {
    frame,
    step() {
      for (let x = 0; x < width; x++) {
        // the source row flickers instead of staying solid
        heat[last + x] = 200 + ((random() * 56) | 0)
      }
      for (let y = 0; y < height - 1; y++) {
        const row = y * width
        const below = row + width
        for (let x = 0; x < width; x++) {
          const drift = ((random() * 3) | 0) - 1
          const sx = Math.min(width - 1, Math.max(0, x + drift))
          const loss = (random() * (cool + 1)) | 0
          const h = heat[below + sx]! - loss
          heat[row + x] = h < 0 ? 0 : h
        }
      }
      for (let i = 0; i < heat.length; i++) frame.rgb[i] = fireColors[heat[i]!]!
    },
  }
}

export type EffectKind = 'plasma' | 'fire'

export const createEffect = (kind: EffectKind, width: number, height: number): Effect =>
  kind === 'fire' ? createFire(width, height) : createPlasma(width, height)

/** Estimated size of one frame's `cells` string, in KB (12 bytes a cell, base64). */
export const frameKb = (columns: number, rows: number): number => (columns * rows * 12 * 4) / 3 / 1024
