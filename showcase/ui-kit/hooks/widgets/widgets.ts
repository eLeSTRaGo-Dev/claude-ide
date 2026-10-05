// Pure math of the Widgets pane: no `$`, no elements.

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** `v` snapped to `step` from `min`, clamped to [min, max]. */
export function snap(v: number, min: number, max: number, step: number): number {
  const s = step > 0 ? step : 1
  const n = Math.round((v - min) / s) * s + min

  return clamp(Number(n.toFixed(6)), min, max)
}

/** The cell (0..width-1) a value's thumb sits in. */
export function thumbCell(v: number, min: number, max: number, width: number): number {
  if (max <= min || width <= 1) return 0

  return Math.round(clamp((v - min) / (max - min), 0, 1) * (width - 1))
}

/**
 * The value under pointer position `px` (cells, fractional: `fine.x` or `x + 0.5`) on a
 * track `width` cells wide. A thumb's cell center is `cell + 0.5`, so the first cell
 * is `min` and the last `max`.
 */
export function valueFromX(px: number, width: number, min: number, max: number, step: number): number {
  if (width <= 1) return min
  const frac = clamp((px - 0.5) / (width - 1), 0, 1)

  return snap(min + frac * (max - min), min, max, step)
}

/** Pointer x of an event: sub-cell when the terminal reports it. */
export const pointerX = (e: { x: number; fine?: { x: number } }): number => e.fine?.x ?? e.x + 0.5

/** Which of a range's two thumbs a press at `v` takes: the nearer, the upper on a tie past the middle. */
export function nearerThumb(v: number, lo: number, hi: number): 'lo' | 'hi' {
  const dl = Math.abs(v - lo)
  const dh = Math.abs(v - hi)
  if (dl === dh) return v > hi ? 'hi' : v < lo ? 'lo' : 'hi'

  return dl < dh ? 'lo' : 'hi'
}

/** Stars lit by a pointer at cell `x`: each star takes two cells (`★ `). */
export const starsFromX = (x: number, count: number): number => clamp(Math.floor(x / 2) + 1, 1, count)

/** h 0..360, s and v 0..100 to `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360
  const ss = clamp(s, 0, 100) / 100
  const vv = clamp(v, 0, 100) / 100
  const f = (n: number): number => {
    const k = (n + hh / 60) % 6

    return vv - vv * ss * Math.max(0, Math.min(k, 4 - k, 1))
  }
  const hex = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0')

  return '#' + hex(f(5)) + hex(f(3)) + hex(f(1))
}

/** '#000000' or '#ffffff', whichever reads on `hex`. */
export function readable(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255

  return lum > 0.6 ? '#000000' : '#ffffff'
}

/** The toggle's thumb cell for animation progress 0..1 over `inner` cells. */
export const toggleCell = (progress: number, inner: number): number => Math.round(clamp(progress, 0, 1) * (inner - 1))

/** Next animation progress toward `on`, one frame of `frameMs` over `durationMs`. */
export function toggleStep(progress: number, on: boolean, frameMs: number, durationMs: number): number {
  const d = frameMs / durationMs

  return on ? Math.min(1, progress + d) : Math.max(0, progress - d)
}
