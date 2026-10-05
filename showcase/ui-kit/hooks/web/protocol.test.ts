import { expect, test } from 'claude-code/testing'

import { cellToPage, downscaleRgb, encodeCommand, enqueue, fpsOf, parseLine, splitLines, viewportPx } from './protocol'

test('viewportPx maps cells at 10x20 and clamps', () => {
  expect(viewportPx(100, 30)).toEqual({ width: 1000, height: 600 })
  expect(viewportPx(500, 500)).toEqual({ width: 2048, height: 2048 })
  expect(viewportPx(1, 1)).toEqual({ width: 64, height: 64 })
})

test('cellToPage scales fractional cells to page pixels, clamped', () => {
  const box = { columns: 100, rows: 30 }
  const page = { width: 1000, height: 600 }
  expect(cellToPage({ x: 50, y: 15 }, box, page)).toEqual({ x: 500, y: 300 })
  expect(cellToPage({ x: 12.375, y: 0.5 }, box, page)).toEqual({ x: 124, y: 10 })
  expect(cellToPage({ x: -3, y: 99 }, box, page)).toEqual({ x: 0, y: 599 })
  expect(cellToPage({ x: 100, y: 30 }, box, page)).toEqual({ x: 999, y: 599 })
})

test('parseLine reads frames, status and url, and ignores the rest', () => {
  expect(parseLine('{"frame":"/dev/shm/a.rgb","width":10,"height":5,"n":3}')).toEqual({ kind: 'frame', file: '/dev/shm/a.rgb', width: 10, height: 5, n: 3 })
  expect(parseLine('{"status":"error","message":"no chromium"}')).toEqual({ kind: 'status', status: 'error', message: 'no chromium' })
  expect(parseLine('{"status":"ready"}')).toEqual({ kind: 'status', status: 'ready' })
  expect(parseLine('{"url":"file:///x"}')).toEqual({ kind: 'url', url: 'file:///x' })
  expect(parseLine('Download https://x')).toBeUndefined()
  expect(parseLine('{"frame":1}')).toBeUndefined()
})

test('splitLines joins pieces and keeps the unfinished tail', () => {
  const a = splitLines('', '{"a":1}\n{"b"')
  expect(a).toEqual({ lines: ['{"a":1}'], tail: '{"b"' })
  expect(splitLines(a.tail, ':2}\n\n')).toEqual({ lines: ['{"b":2}'], tail: '' })
})

test('commands encode as one JSON object and the queue is bounded', () => {
  expect(encodeCommand({ scroll: 120 })).toBe('{"scroll":120}')
  let q: { seq: number; cmd: { scroll: number } }[] = []
  let text = ''
  for (let i = 1; i <= 60; i++) {
    const r = enqueue(q, i, { scroll: i })
    q = r.queue as typeof q
    text = r.text
  }
  const parsed = JSON.parse(text) as { seq: number }[]
  expect(parsed.length).toBe(48)
  expect(parsed[0]!.seq).toBe(13)
  expect(parsed[47]!.seq).toBe(60)
})

test('fpsOf counts frames in the window', () => {
  expect(fpsOf([], 1000)).toBe(0)
  expect(fpsOf([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 1000)).toBe(10)
})

test('downscaleRgb averages a block', () => {
  const bytes = new Uint8Array([0, 0, 0, 200, 100, 50, 0, 0, 0, 200, 100, 50]) // 2x2: black, c / black, c
  const f = downscaleRgb(bytes, 2, 2, 1, 1)
  expect(f.rgb[0]).toBe((100 << 16) | (50 << 8) | 25)
})
