// Pure helpers of the host-render demo: sizes, argv, shm names, rgb -> Frame.
import { createFrame, rgb } from '../shared/raster'
import type { Frame } from '../shared/raster'

export const CELL_W = 10 // assumed pixels per terminal column
export const CELL_H = 20 // assumed pixels per terminal row
export const BG = '#14141c'
export const MAX_COLUMNS = 120
export const MAX_ROWS = 34
export const VIDEO = 'video'
export const VIDEO_FRAMES = 30
export const VIDEO_FPS = 15

export type Asset = { name: string; label: string; aspect: number }

// Every bundled SVG is 800x480.
export const ASSETS: readonly Asset[] = [
  { name: 'logo', label: 'logo', aspect: 800 / 480 },
  { name: 'diagram', label: 'diagram', aspect: 800 / 480 },
  { name: 'aa', label: 'anti-aliasing', aspect: 800 / 480 },
]

export const assetOf = (name: string): Asset => ASSETS.find(a => a.name === name) ?? ASSETS[0]!

/** Cells (columns x rows) that fit the room with the picture's aspect, given ~10x20 px cells. */
export function fitCells(
  roomColumns: number,
  roomRows: number,
  aspect: number,
): { columns: number; rows: number } {
  const maxC = Math.max(1, Math.min(roomColumns, MAX_COLUMNS))
  const maxR = Math.max(1, Math.min(roomRows, MAX_ROWS))
  const columns = Math.max(1, Math.floor(Math.min(maxC, (maxR * CELL_H * aspect) / CELL_W)))
  const rows = Math.max(1, Math.min(maxR, Math.round((columns * CELL_W) / (CELL_H * aspect))))

  return { columns, rows }
}

/** Pixels the Image path renders for a box of cells. */
export const imagePixels = (columns: number, rows: number) => ({
  width: columns * CELL_W,
  height: rows * CELL_H,
})

/** FNV-1a, 8 hex digits: names the /dev/shm files of one render. */
export function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0

  return h.toString(16).padStart(8, '0')
}

export const shmPath = (hash: string, ext: string): string => `/dev/shm/gfx-gallery-${hash}.${ext}`
export const videoDir = (hash: string): string => `/dev/shm/gfx-gallery-${hash}-v`
export const videoFrame = (dir: string, n: number): string => `${dir}/f${String(n + 1).padStart(3, '0')}.rgb`

export const rsvgArgv = (asset: string, out: string, w: number, h: number): string[] => [
  'rsvg-convert', '-w', String(w), '-h', String(h), '-b', BG, '-o', out, asset,
]

export const magickPngArgv = (asset: string, out: string, w: number, h: number): string[] => [
  'magick', '-background', BG, '-density', '192', asset, '-resize', `${w}x${h}!`, '-alpha', 'remove', out,
]

/** PNG or SVG -> raw rgb24 of exactly w x h. */
export const magickRgbArgv = (src: string, out: string, w: number, h: number): string[] => [
  'magick', '-background', BG, src, '-resize', `${w}x${h}!`, '-alpha', 'remove', '-depth', '8', `rgb:${out}`,
]

export const ffmpegArgv = (dir: string, w: number, h: number): string[] => [
  'ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${VIDEO_FPS}`,
  '-frames:v', String(VIDEO_FRAMES), '-f', 'image2', '-c:v', 'rawvideo', '-pix_fmt', 'rgb24', `${dir}/f%03d.rgb`,
]

/** Raw rgb24 bytes (3 per pixel) -> a Frame; a short buffer leaves the rest black. */
export function frameFromRgb(bytes: Uint8Array, width: number, height: number): Frame {
  const frame = createFrame(width, height)
  const n = Math.min(width * height, Math.floor(bytes.length / 3))
  for (let i = 0; i < n; i++) frame.rgb[i] = rgb(bytes[i * 3]!, bytes[i * 3 + 1]!, bytes[i * 3 + 2]!)

  return frame
}
