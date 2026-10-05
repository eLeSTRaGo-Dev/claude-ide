// Pure pixel painters for the Chrome pane: gradients, anti-aliased rounded
// rectangles, soft drop shadows, glass cards, a pill toggle and a tiny bitmap
// font, all into a `Frame` that raster.ts encodes to cells.
import { createFrame, lerpColor, palette, rgb } from '../shared/raster'
import type { Frame } from '../shared/raster'
import type { Theme } from '../shared/theme'

export type Rect = { x: number; y: number; w: number; h: number }
export type ColorAt = (x: number, y: number) => number

export const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0')

export function parseHex(text: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim())

  return m ? parseInt(m[1]!, 16) : 0
}

const lumOf = (c: number): number => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)

/** Black or white, whichever reads on `bg`. */
export const readable = (bg: number): number => (lumOf(bg) > 140 ? 0x111111 : 0xffffff)

/** `c` scaled toward black until its luminance is at most `max` (a light default foreground reads on it). */
export function ensureDark(c: number, max = 120): number {
  const l = lumOf(c)

  return l <= max ? c : lerpColor(c, 0, 1 - max / l)
}

export function at(f: Frame, x: number, y: number): number {
  return x < 0 || y < 0 || x >= f.width || y >= f.height ? 0 : f.rgb[y * f.width + x]!
}

/** Paints `src` over the pixel at coverage `a` (0..1); outside the frame is ignored. */
export function blendPx(f: Frame, x: number, y: number, src: number, a: number): void {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height || a <= 0) return
  const i = y * f.width + x
  f.rgb[i] = a >= 1 ? src : lerpColor(f.rgb[i]!, src, a)
}

/** Vertical gradient over `rect` through evenly spaced stops. */
export const vertical = (rect: Rect, stops: number[]): ColorAt => (_x, y) =>
  palette(stops, rect.h <= 1 ? 0 : (y - rect.y) / (rect.h - 1))

/** Diagonal gradient: `dx` of the way along x, the rest along y. */
export const diagonal = (rect: Rect, stops: number[], dx = 0.6): ColorAt => (x, y) =>
  palette(stops, ((x - rect.x) / Math.max(1, rect.w - 1)) * dx + ((y - rect.y) / Math.max(1, rect.h - 1)) * (1 - dx))

export const flat = (c: number): ColorAt => () => c

/** Signed distance (pixels, negative inside) from a pixel centre to a rounded rectangle. */
export function rrectDistance(rect: Rect, r: number, px: number, py: number): number {
  const rr = Math.min(r, rect.w / 2, rect.h / 2)
  const qx = Math.abs(px + 0.5 - (rect.x + rect.w / 2)) - (rect.w / 2 - rr)
  const qy = Math.abs(py + 0.5 - (rect.y + rect.h / 2)) - (rect.h / 2 - rr)

  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr
}

/** Coverage 0..1 of the pixel: 1 inside, a one-pixel ramp across the edge. */
export const coverage = (d: number): number => (d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d)

/** Rounded rectangle; the edge pixels blend into what is already there. */
export function paintRRect(f: Frame, rect: Rect, r: number, color: ColorAt, alpha = 1): void {
  for (let y = Math.floor(rect.y) - 1; y <= rect.y + rect.h; y++) {
    for (let x = Math.floor(rect.x) - 1; x <= rect.x + rect.w; x++) {
      const c = coverage(rrectDistance(rect, r, x, y)) * alpha
      if (c > 0) blendPx(f, x, y, color(x, y), c)
    }
  }
}

/** A soft drop shadow: the rounded rectangle moved by (dx, dy), fading over `blur` pixels. */
export function paintShadow(f: Frame, rect: Rect, r: number, dx: number, dy: number, color: number, alpha: number, blur = 2): void {
  const s: Rect = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }
  for (let y = s.y - blur - 1; y <= s.y + s.h + blur; y++) {
    for (let x = s.x - blur - 1; x <= s.x + s.w + blur; x++) {
      const d = rrectDistance(s, r, Math.floor(x), Math.floor(y))
      const k = d <= 0 ? 1 : d >= blur ? 0 : 1 - d / blur
      if (k > 0) blendPx(f, Math.floor(x), Math.floor(y), color, alpha * k * k)
    }
  }
}

/** One-pixel ring along the inside of the rounded rectangle's edge. */
export function paintRing(f: Frame, rect: Rect, r: number, color: ColorAt, alpha = 1): void {
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      const d = rrectDistance(rect, r, x, y)
      const c = coverage(d) - coverage(d + 1)
      if (c > 0) blendPx(f, x, y, color(x, y), c * alpha)
    }
  }
}

// 3x5 glyphs, row-major, '#' lit. Just the letters the showcase draws.
const FONT: Record<string, string[]> = {
  C: ['###', '#..', '#..', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  ' ': ['...', '...', '...', '...', '...'],
}

/** Pixel width of `text` at `scale` (glyphs 3 wide, one pixel gap, scaled). */
export const textWidth = (text: string, scale: number): number => Math.max(0, text.length * 4 - 1) * scale

/** Paints `text` in the 3x5 font at `scale`; unknown letters are blank. */
export function paintText(f: Frame, text: string, x: number, y: number, scale: number, color: ColorAt, alpha = 1): void {
  let cx = x
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' ']!
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (g[gy]![gx] !== '#') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cx + gx * scale + sx
            const py = y + gy * scale + sy
            blendPx(f, px, py, color(px, py), alpha)
          }
        }
      }
    }
    cx += 4 * scale
  }
}

// Layout, in terminal cells. A cell is 2 pixels wide and 2 tall (quad encoding).
export const ROWS = 25
export const MIN_COLUMNS = 60

export type ButtonKey = 'primary' | 'secondary' | 'danger' | 'icon'
export type Layout = {
  hero: Rect
  buttons: Record<ButtonKey, Rect>
  card: Rect
  toggle: Rect
  columns: number
}

export function layoutOf(columns: number): Layout {
  const w = Math.max(MIN_COLUMNS, columns)

  return {
    columns: w,
    hero: { x: 1, y: 0, w: w - 2, h: 8 },
    buttons: {
      primary: { x: 2, y: 10, w: 14, h: 3 },
      secondary: { x: 19, y: 10, w: 14, h: 3 },
      danger: { x: 36, y: 10, w: 12, h: 3 },
      icon: { x: 51, y: 10, w: 3, h: 3 },
    },
    card: { x: 2, y: 16, w: w - 4, h: 8 },
    toggle: { x: 5, y: 18, w: 8, h: 2 },
  }
}

/** A cell rectangle in pixels. */
export const px = (c: Rect): Rect => ({ x: c.x * 2, y: c.y * 2, w: c.w * 2, h: c.h * 2 })

export type Variant = { top: number; bottom: number }

/** Gradient ends per button, from the theme (darkened so a light default label reads). */
export function variantOf(t: Theme, key: ButtonKey): Variant {
  const base = { primary: parseHex(t.accent), secondary: parseHex(t.surfaceHover), danger: parseHex(t.danger), icon: parseHex(t.info) }[key]
  const dark = ensureDark(base, key === 'secondary' ? 90 : 105)

  return { top: lerpColor(dark, 0xffffff, 0.18), bottom: lerpColor(dark, 0, 0.25) }
}

export type SceneState = { pressed?: string; toggle: boolean }

/** The page background, vertical wash from `bg` to a slightly raised tone. */
function paintPage(f: Frame, t: Theme): void {
  const bg = parseHex(t.bg)
  const low = lerpColor(bg, parseHex(t.surface), 0.6)
  const rect = { x: 0, y: 0, w: f.width, h: f.height }
  const g = vertical(rect, [bg, low])
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) f.rgb[y * f.width + x] = g(x, y)
}

export function paintButton(f: Frame, cell: Rect, v: Variant, pressed: boolean, round: number): void {
  const r = px(cell)
  // Pressed: inset, no shadow, flipped gradient, shifted down-right by one pixel.
  if (!pressed) paintShadow(f, r, round, 2, 2, 0x000000, 0.45, 2)
  const body: Rect = pressed ? { x: r.x + 1, y: r.y + 1, w: r.w - 1, h: r.h - 1 } : { x: r.x, y: r.y, w: r.w - 1, h: r.h - 1 }
  const g = pressed
    ? vertical(body, [lerpColor(v.bottom, 0, 0.25), lerpColor(v.top, 0, 0.1)])
    : vertical(body, [v.top, v.bottom])
  paintRRect(f, body, round, g)
  if (!pressed) paintRing(f, body, round, flat(0xffffff), 0.12)
  else paintRing(f, body, round, flat(0x000000), 0.35)
}

/** The whole scene for a pane `columns` wide. */
export function paintScene(columns: number, t: Theme, s: SceneState): Frame {
  const L = layoutOf(columns)
  const f = createFrame(L.columns * 2, ROWS * 2)
  paintPage(f, t)

  // Hero banner.
  const hero = px(L.hero)
  const hs = [parseHex(t.accent), parseHex(t.focus), parseHex(t.info)].map(c => ensureDark(c, 150))
  paintShadow(f, hero, 4, 2, 3, 0x000000, 0.5, 3)
  paintRRect(f, { ...hero, w: hero.w - 1, h: hero.h - 1 }, 4, diagonal(hero, [hs[0]!, hs[1]!, hs[2]!]))
  const title = 'CHROME'
  const tx = hero.x + 5
  paintText(f, title, tx + 1, hero.y + 3, 2, flat(0x000000), 0.4)
  paintText(f, title, tx, hero.y + 2, 2, flat(0xffffff))

  // Buttons.
  for (const key of ['primary', 'secondary', 'danger', 'icon'] as const) {
    const c = L.buttons[key]
    paintButton(f, c, variantOf(t, key), s.pressed === key, key === 'icon' ? Math.min(c.w, c.h) : 3)
  }

  // Glass card: translucent surface over the page, bright top edge, soft shadow.
  const card = px(L.card)
  const body = { ...card, w: card.w - 1, h: card.h - 1 }
  paintShadow(f, card, 4, 2, 3, 0x000000, 0.4, 3)
  const surface = parseHex(t.surface)
  paintRRect(f, body, 4, flat(lerpColor(surface, 0xffffff, 0.08)), 0.72)
  paintRing(f, body, 4, flat(0xffffff), 0.22)

  // Toggle pill and its knob.
  const pill = px(L.toggle)
  const on = s.toggle
  paintRRect(f, pill, pill.h / 2, vertical(pill, on ? [lerpColor(parseHex(t.success), 0xffffff, 0.1), ensureDark(parseHex(t.success), 150)] : [0x3a3a40, 0x55555c]))
  const knob: Rect = { x: on ? pill.x + pill.w - pill.h + 0.5 : pill.x + 0.5, y: pill.y + 0.5, w: pill.h - 1, h: pill.h - 1 }
  paintShadow(f, knob, knob.h / 2, 1, 1, 0x000000, 0.4, 1)
  paintRRect(f, knob, knob.h / 2, vertical(knob, [0xffffff, 0xd8d8de]))

  return f
}

/** The `#rrggbb` of a cell: its pixels averaged, what a label's background must be to sit seamlessly on it. */
export function cellColor(f: Frame, cx: number, cy: number): string {
  let r = 0, g = 0, b = 0
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const c = at(f, cx * 2 + dx, cy * 2 + dy)
      r += (c >> 16) & 255
      g += (c >> 8) & 255
      b += c & 255
    }
  }

  return hex(rgb(r / 4, g / 4, b / 4))
}
