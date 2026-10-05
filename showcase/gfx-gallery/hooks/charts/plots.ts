// Terminal plots as Raster cells (pure): heat map, braille line, smooth bars.
import { DEFAULT, cellsFromWords, createFrame, encode, packCell, rgb } from '../shared/raster'
import type { Grid } from './data'

/** GitHub dark: none, then four greens. */
export const LEVELS = [rgb(45, 51, 59), rgb(14, 68, 41), rgb(0, 109, 50), rgb(38, 166, 65), rgb(57, 211, 83)]
export const LINE = rgb(57, 211, 83)
export const BAR = rgb(88, 166, 255)
const LOWER = [0x20, 0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588]

/** 7 rows x (2 per week) columns: a day is `▀` (half a row, one column) then a gap column; future days are blank. */
export function heatCells(grid: Grid): { columns: number; rows: number; cells: string } {
  const columns = grid.weeks.length * 2
  const words = new Uint32Array(columns * 7 * 3)
  for (let d = 0; d < 7; d++) {
    for (let w = 0; w < grid.weeks.length; w++) {
      const day = grid.weeks[w]![d]
      const i = d * columns + w * 2
      if (day) packCell(words, i, 0x2580, LEVELS[day.level]!, DEFAULT)
      else packCell(words, i, 0x20, DEFAULT, DEFAULT)
      packCell(words, i + 1, 0x20, DEFAULT, DEFAULT)
    }
  }
  return { columns, rows: 7, cells: cellsFromWords(words) }
}

/** Braille line of `values` against 0..top: one point per pixel column, joined by vertical runs. */
export function lineCells(values: readonly number[], top: number, columns: number, rows: number): string {
  const width = columns * 2
  const height = rows * 4
  const frame = createFrame(width, height)
  const y = (v: number): number => {
    const t = top > 0 ? Math.min(1, Math.max(0, v / top)) : 0
    return height - 1 - Math.round(t * (height - 1))
  }
  let prev = -1
  for (let x = 0; x < width && x < values.length; x++) {
    const cur = y(values[x]!)
    const from = prev < 0 ? cur : prev
    const lo = Math.min(from, cur)
    const hi = Math.max(from, cur)
    for (let py = lo; py <= hi; py++) frame.rgb[py * width + x] = LINE
    prev = cur
  }
  return encode(frame, 'braille', columns, rows)
}

/** Vertical bars: each `barWidth` wide plus `gap`, eighth-block tops for sub-cell height. */
export function barCells(
  values: readonly number[],
  top: number,
  barWidth: number,
  gap: number,
  rows: number,
): { columns: number; cells: string } {
  const columns = values.length * (barWidth + gap)
  const words = new Uint32Array(columns * rows * 3)
  for (let r = 0; r < rows * columns; r++) packCell(words, r, 0x20, DEFAULT, DEFAULT)
  values.forEach((v, b) => {
    const eighths = top > 0 ? Math.round((Math.min(v, top) / top) * rows * 8) : 0
    for (let x = 0; x < barWidth; x++) {
      const col = b * (barWidth + gap) + x
      for (let r = 0; r < rows; r++) {
        const fill = Math.max(0, Math.min(8, eighths - (rows - 1 - r) * 8))
        if (fill > 0) packCell(words, r * columns + col, LOWER[fill]!, BAR, DEFAULT)
      }
    }
  })
  return { columns, cells: cellsFromWords(words) }
}
