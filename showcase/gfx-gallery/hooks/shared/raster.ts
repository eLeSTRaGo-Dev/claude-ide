// Sub-cell rasterizer: an RGB framebuffer -> `Raster` cells (base64 u32 triplets).
// Pure; assumes a little-endian host.

// TS 5.6 lacks the ES2026 base64 typings the engine's runtime has.
declare global {
  interface Uint8Array {
    toBase64(): string
  }
  interface Uint8ArrayConstructor {
    fromBase64(text: string): Uint8Array
  }
}

export type Encoder = 'half' | 'quad' | 'braille'

/** The terminal's default color (bit 24 alone). */
export const DEFAULT = 0x01000000

export type Frame = { width: number; height: number; rgb: Uint32Array }

const SPACE = 0x20
const HALF_UPPER = 0x2580
const BRAILLE_BASE = 0x2800

// Index = mask with TL=1, TR=2, BL=4, BR=8.
const QUAD_GLYPHS = [
  0x20, // none
  0x2598, // ▘ TL
  0x259d, // ▝ TR
  0x2580, // ▀ TL|TR
  0x2596, // ▖ BL
  0x258c, // ▌ TL|BL
  0x259e, // ▞ TR|BL
  0x259b, // ▛ TL|TR|BL
  0x2597, // ▗ BR
  0x259a, // ▚ TL|BR
  0x2590, // ▐ TR|BR
  0x259c, // ▜ TL|TR|BR
  0x2584, // ▄ BL|BR
  0x2599, // ▙ TL|BL|BR
  0x259f, // ▟ TR|BL|BR
  0x2588, // █ all
]

// Braille dot bit by [dy][dx].
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

export function pixelsFor(enc: Encoder, columns: number, rows: number): { width: number; height: number } {
  if (enc === 'half') return { width: columns, height: rows * 2 }
  if (enc === 'quad') return { width: columns * 2, height: rows * 2 }
  return { width: columns * 2, height: rows * 4 }
}

export function createFrame(width: number, height: number): Frame {
  return { width, height, rgb: new Uint32Array(width * height) }
}

export function packCell(words: Uint32Array, index: number, codePoint: number, fg: number, bg: number): void {
  const i = index * 3
  words[i] = codePoint
  words[i + 1] = fg
  words[i + 2] = bg
}

export function cellsFromWords(words: Uint32Array): string {
  return new Uint8Array(words.buffer, words.byteOffset, words.byteLength).toBase64()
}

export function rgb(r: number, g: number, b: number): number {
  return ((clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b)) >>> 0
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

export function lerpColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t
  return rgb(r, g, bl)
}

/** h in turns (wraps), s and v in 0..1. */
export function hsv(h: number, s: number, v: number): number {
  const hh = (h - Math.floor(h)) * 6
  const i = Math.floor(hh)
  const f = hh - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  let r: number, g: number, b: number
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    default: r = v; g = p; b = q
  }
  return rgb(r * 255, g * 255, b * 255)
}

/** Piecewise-linear gradient over evenly spaced stops; t is clamped to 0..1. */
export function palette(stops: number[], t: number): number {
  if (stops.length === 0) return 0
  if (stops.length === 1) return stops[0]!
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * (stops.length - 1)
  const i = Math.min(Math.floor(x), stops.length - 2)
  return lerpColor(stops[i]!, stops[i + 1]!, x - i)
}

function lum(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)
}

function dist2(a: number, b: number): number {
  const r = ((a >> 16) & 255) - ((b >> 16) & 255)
  const g = ((a >> 8) & 255) - ((b >> 8) & 255)
  const bl = (a & 255) - (b & 255)
  return r * r + g * g + bl * bl
}

export function encode(
  frame: Frame,
  enc: Encoder,
  columns: number,
  rows: number,
  opts: { bg?: number; threshold?: number } = {},
): string {
  const words = new Uint32Array(columns * rows * 3)
  const { width: fw, height: fh, rgb: px } = frame
  const at = (x: number, y: number): number => (x < fw && y < fh ? px[y * fw + x]! : 0)
  let n = 0

  if (enc === 'half') {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < columns; cx++, n++) {
        const top = at(cx, cy * 2)
        const bot = at(cx, cy * 2 + 1)
        if (top === bot) packCell(words, n, SPACE, top, top)
        else packCell(words, n, HALF_UPPER, top, bot)
      }
    }
  } else if (enc === 'quad') {
    const c = [0, 0, 0, 0]
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < columns; cx++, n++) {
        const x = cx * 2
        const y = cy * 2
        c[0] = at(x, y)
        c[1] = at(x + 1, y)
        c[2] = at(x, y + 1)
        c[3] = at(x + 1, y + 1)
        let lo = 0
        let hi = 0
        let loL = Infinity
        let hiL = -Infinity
        for (let k = 0; k < 4; k++) {
          const v = c[k]!
          const l = lum(v)
          if (l < loL) { loL = l; lo = v }
          if (l > hiL) { hiL = l; hi = v }
        }
        let mask = 0
        let r1 = 0, g1 = 0, b1 = 0, n1 = 0
        let r0 = 0, g0 = 0, b0 = 0, n0 = 0
        for (let k = 0; k < 4; k++) {
          const v = c[k]!
          const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255
          if (dist2(v, hi) < dist2(v, lo)) {
            mask |= 1 << k
            r1 += r; g1 += g; b1 += b; n1++
          } else {
            r0 += r; g0 += g; b0 += b; n0++
          }
        }
        const bg = rgb(r0 / n0, g0 / n0, b0 / n0)
        if (mask === 0) packCell(words, n, SPACE, bg, bg)
        else packCell(words, n, QUAD_GLYPHS[mask]!, rgb(r1 / n1, g1 / n1, b1 / n1), bg)
      }
    }
  } else {
    const key = opts.bg
    const threshold = opts.threshold ?? 0.5 * 255
    const bgOut = key ?? DEFAULT
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < columns; cx++, n++) {
        let bits = 0
        let r = 0, g = 0, b = 0, lit = 0
        for (let dy = 0; dy < 4; dy++) {
          const rowBits = BRAILLE_BITS[dy]!
          for (let dx = 0; dx < 2; dx++) {
            const v = at(cx * 2 + dx, cy * 4 + dy)
            const on = key === undefined ? lum(v) > threshold : v !== key
            if (on) {
              bits |= rowBits[dx]!
              r += (v >> 16) & 255; g += (v >> 8) & 255; b += v & 255
              lit++
            }
          }
        }
        if (lit === 0) packCell(words, n, SPACE, DEFAULT, bgOut)
        else packCell(words, n, BRAILLE_BASE + bits, rgb(r / lit, g / lit, b / lit), bgOut)
      }
    }
  }
  return cellsFromWords(words)
}
