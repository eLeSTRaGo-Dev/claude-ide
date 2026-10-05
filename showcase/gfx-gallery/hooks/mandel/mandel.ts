// Pure Mandelbrot math: views, coordinate mapping, smooth escape, a frame.
import { createFrame, hsv, pixelsFor, rgb } from '../shared/raster'
import type { Encoder, Frame } from '../shared/raster'

/** `scale` is complex units per terminal column (per cell, whatever the encoder). */
export type View = { cx: number; cy: number; scale: number }

export const HOME: View = { cx: -0.5, cy: 0, scale: 0.03 }
export const MIN_SCALE = 1e-13
export const MAX_SCALE = 0.2
export const ITER_MIN = 32
export const ITER_MAX = 1024
export const ITER_STEP = 32

const BAILOUT = 256
const LEVELS = 64
const LN2 = Math.LN2

/** Complex units of one pixel across: a cell column spans `scale`, over `width / columns` pixels. */
export function pixelSize(view: View, columns: number, width: number): number {
  return (view.scale * columns) / width
}

/** ... and down: a cell is twice as tall as wide, so a row spans `2 * scale` (a true picture, not stretched). */
export function pixelSizeY(view: View, rows: number, height: number): number {
  return (view.scale * 2 * rows) / height
}

/** The complex point under the middle of pixel (px, py) in a width x height grid. */
export function pixelToComplex(
  view: View, columns: number, rows: number, width: number, height: number, px: number, py: number,
): { re: number; im: number } {
  return {
    re: view.cx + (px + 0.5 - width / 2) * pixelSize(view, columns, width),
    im: view.cy + (py + 0.5 - height / 2) * pixelSizeY(view, rows, height),
  }
}

/** Cell coordinates (fractions allowed, 0 at the region's top-left) to pixel coordinates. */
export function cellToPixel(
  enc: Encoder, columns: number, rows: number, fx: number, fy: number,
): { px: number; py: number } {
  const { width, height } = pixelsFor(enc, columns, rows)

  return { px: (fx * width) / columns, py: (fy * height) / rows }
}

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/** Zoom by `factor` (2 = in) re-centered on the cell position (fx, fy): the point clicked becomes the center. */
export function zoomAt(
  view: View, enc: Encoder, columns: number, rows: number, fx: number, fy: number, factor: number,
): View {
  const { width, height } = pixelsFor(enc, columns, rows)
  const { px, py } = cellToPixel(enc, columns, rows, fx, fy)
  // Plain coordinates, not the pixel's middle: a click is a point.
  const re = view.cx + (px - width / 2) * pixelSize(view, columns, width)
  const im = view.cy + (py - height / 2) * pixelSizeY(view, rows, height)

  return { cx: re, cy: im, scale: clampScale(view.scale / factor) }
}

/** Zoom about the center only. */
export function zoomCenter(view: View, factor: number): View {
  return { ...view, scale: clampScale(view.scale / factor) }
}

/** The view after dragging the picture by (dx, dy) cells: the content follows the pointer. */
export function panBy(
  view: View, enc: Encoder, columns: number, rows: number, dx: number, dy: number,
): View {
  const { width, height } = pixelsFor(enc, columns, rows)

  return {
    ...view,
    cx: view.cx - ((dx * width) / columns) * pixelSize(view, columns, width),
    cy: view.cy - ((dy * height) / rows) * pixelSizeY(view, rows, height),
  }
}

/** Smooth iteration count at c, or -1 for a point in the set. */
export function escape(cr: number, ci: number, maxIter: number): number {
  // The main cardioid and the period-2 bulb are in the set.
  const q = (cr - 0.25) * (cr - 0.25) + ci * ci
  if (q * (q + (cr - 0.25)) <= 0.25 * ci * ci) return -1
  if ((cr + 1) * (cr + 1) + ci * ci <= 0.0625) return -1
  let zr = 0
  let zi = 0
  let zr2 = 0
  let zi2 = 0
  let n = 0
  while (n < maxIter && zr2 + zi2 <= BAILOUT) {
    zi = 2 * zr * zi + ci
    zr = zr2 - zi2 + cr
    zr2 = zr * zr
    zi2 = zi * zi
    n++
  }
  if (n >= maxIter) return -1

  return n + 1 - Math.log(Math.log(zr2 + zi2) / 2) / LN2
}

// Quantized cyclic palette, so neighbours share colors (merges SVG runs and keeps
// the Raster's color pairs down).
const LUT: number[] = Array.from({ length: LEVELS }, (_, i) => {
  const t = i / LEVELS

  return hsv(0.62 + t * 0.9, 0.75 - 0.25 * Math.sin(t * Math.PI * 2) ** 2, 0.55 + 0.45 * Math.sin(t * Math.PI))
})

export const INSIDE = rgb(0, 0, 0)

/** The color of a smooth iteration count; -1 (inside) is black. */
export function shade(mu: number): number {
  if (mu < 0) return INSIDE
  const i = Math.floor(mu * 1.5) % LEVELS

  return LUT[i]!
}

/** Draw the view into a width x height grid (`columns` is the cell width it covers). */
export function renderGrid(
  view: View, columns: number, rows: number, width: number, height: number, maxIter: number,
): Frame {
  const frame = createFrame(width, height)
  const xs = pixelSize(view, columns, width)
  const ys = pixelSizeY(view, rows, height)
  const left = view.cx - (width / 2) * xs
  const top = view.cy - (height / 2) * ys
  for (let y = 0; y < height; y++) {
    const ci = top + (y + 0.5) * ys
    for (let x = 0; x < width; x++) {
      frame.rgb[y * width + x] = shade(escape(left + (x + 0.5) * xs, ci, maxIter))
    }
  }

  return frame
}

export function renderFrame(
  view: View, enc: Encoder, columns: number, rows: number, maxIter: number,
): Frame {
  const { width, height } = pixelsFor(enc, columns, rows)

  return renderGrid(view, columns, rows, width, height, maxIter)
}

const hex = (c: number): string => '#' + (c & 0xffffff).toString(16).padStart(6, '0')

/** An SVG of the grid: one `<path>` per color, one `h` run per row-run of equal pixels. */
export function svgOfFrame(frame: Frame, pxW: number, pxH: number): string {
  const { width, height, rgb: px } = frame
  const paths = new Map<number, string>()
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      const c = px[y * width + x]!
      let end = x + 1
      while (end < width && px[y * width + end] === c) end++
      if (c !== INSIDE) paths.set(c, (paths.get(c) ?? '') + `M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  }
  let body = ''
  for (const [c, d] of paths) body += `<path fill="${hex(c)}" d="${d}"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${pxW}" height="${pxH}" ` +
    `preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="#000"/>${body}</svg>`
  )
}

export function describe(view: View): string {
  const sign = view.cy < 0 ? '-' : '+'

  return `c = ${view.cx.toPrecision(10)} ${sign} ${Math.abs(view.cy).toPrecision(10)}i   ${view.scale.toExponential(2)}/col   x${(HOME.scale / view.scale).toFixed(0)}`
}
