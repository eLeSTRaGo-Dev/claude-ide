// Pure helpers for the web pane: cell/pixel mapping, the bridge's stdout lines,
// the command file, raster downscale. No `$` here.
import { createFrame, rgb } from './raster'
import type { Frame } from './raster'

export const PANE = 'uik-web'
export const CELL_W = 10
export const CELL_H = 20
export const MAX_PX = 2048
export const DEFAULT_URL_NAME = 'demo.html'

/** Viewport pixels for a box of cells (~10x20 px a cell), clamped to the Image limits. */
export function viewportPx(columns: number, rows: number): { width: number; height: number } {
  const clamp = (v: number) => Math.max(64, Math.min(MAX_PX, Math.round(v)))

  return { width: clamp(columns * CELL_W), height: clamp(rows * CELL_H) }
}

/** A pointer position in cells (fractional where known) to page pixels. */
export function cellToPage(
  cell: { x: number; y: number },
  box: { columns: number; rows: number },
  page: { width: number; height: number },
): { x: number; y: number } {
  const fx = Math.max(0, Math.min(box.columns, cell.x))
  const fy = Math.max(0, Math.min(box.rows, cell.y))

  return {
    x: Math.min(page.width - 1, Math.round((fx / box.columns) * page.width)),
    y: Math.min(page.height - 1, Math.round((fy / box.rows) * page.height)),
  }
}

export type BridgeLine =
  | { kind: 'frame'; file: string; width: number; height: number; n: number }
  | { kind: 'status'; status: string; message?: string }
  | { kind: 'url'; url: string }

/** One stdout line of the bridge; undefined for anything else. */
export function parseLine(line: string): BridgeLine | undefined {
  let o: unknown
  try {
    o = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof o !== 'object' || o === null) return undefined
  const r = o as Record<string, unknown>
  if (typeof r.frame === 'string' && typeof r.width === 'number' && typeof r.height === 'number' && typeof r.n === 'number') {
    return { kind: 'frame', file: r.frame, width: r.width, height: r.height, n: r.n }
  }
  if (typeof r.status === 'string') return { kind: 'status', status: r.status, ...(typeof r.message === 'string' ? { message: r.message } : {}) }
  if (typeof r.url === 'string') return { kind: 'url', url: r.url }

  return undefined
}

/** Pieces of text (a line may span two) into whole lines plus the unfinished tail. */
export function splitLines(tail: string, text: string): { lines: string[]; tail: string } {
  const parts = (tail + text).split('\n')
  const rest = parts.pop() ?? ''

  return { lines: parts.map(l => l.trim()).filter(l => l !== ''), tail: rest }
}

export type Cmd =
  | { mouse: { type: 'down' | 'up' | 'move'; x: number; y: number; button?: 'left' | 'middle' | 'right' } }
  | { key: { key: string; ctrl?: boolean; shift?: boolean; meta?: boolean } }
  | { scroll: number }
  | { goto: string }
  | { back: true }
  | { reload: true }
  | { resize: [number, number] }
  | { quit: true }

export const encodeCommand = (cmd: Cmd): string => JSON.stringify(cmd)

export type Queued = { seq: number; cmd: Cmd }
const KEEP = 48

/** Appends a command to the command file's queue (bounded) and returns its text. */
export function enqueue(queue: Queued[], seq: number, cmd: Cmd): { queue: Queued[]; text: string } {
  const next = [...queue, { seq, cmd }].slice(-KEEP)

  return { queue: next, text: JSON.stringify(next) }
}

/** Box-filter downscale of raw rgb24 to a Raster frame of dw x dh pixels. */
export function downscaleRgb(bytes: Uint8Array, w: number, h: number, dw: number, dh: number): Frame {
  const frame = createFrame(dw, dh)
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * h) / dh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / dh))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * w) / dw)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / dw))
      let r = 0, g = 0, b = 0, c = 0
      // sample at most 4x4 points of the source block
      const sx = Math.max(1, Math.floor((x1 - x0) / 4))
      const sy = Math.max(1, Math.floor((y1 - y0) / 4))
      for (let yy = y0; yy < y1; yy += sy) {
        for (let xx = x0; xx < x1; xx += sx) {
          const i = (yy * w + xx) * 3
          r += bytes[i] ?? 0; g += bytes[i + 1] ?? 0; b += bytes[i + 2] ?? 0; c++
        }
      }
      frame.rgb[y * dw + x] = rgb(Math.round(r / c), Math.round(g / c), Math.round(b / c))
    }
  }

  return frame
}

/** Frames per second over a window of arrival times (ms), now included. */
export function fpsOf(times: readonly number[], now: number, windowMs = 2000): number {
  const recent = times.filter(t => now - t <= windowMs)

  return recent.length < 2 ? 0 : Math.round(((recent.length - 1) * 1000) / Math.max(1, now - recent[0]!))
}
