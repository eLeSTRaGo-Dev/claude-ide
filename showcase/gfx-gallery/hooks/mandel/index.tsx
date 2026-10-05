import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { MandelState } from '../../types'
import { pixelsFor } from '../shared/raster'
import type { Encoder } from '../shared/raster'
import { encode } from '../shared/raster'
import {
  HOME, ITER_MAX, ITER_MIN, ITER_STEP, describe, panBy, renderFrame, renderGrid, svgOfFrame, zoomAt, zoomCenter,
} from './mandel'
import type { View } from './mandel'

const PANE = 'gfx-mandel'
const RASTER = 'mandel'
const OVERLAY = 'mandel-pointer'
const ENCODERS: readonly Encoder[] = ['half', 'quad', 'braille']
const MAX_COLUMNS = 160
const MAX_SVG_COLUMNS = 120
const MAX_SVG_ROWS = 40
const PREVIEW_ITER = 40
const HEADER_ROWS = 4

const mandel = atom<'gfx-gallery', 'mandel'>(
  { plugin: 'gfx-gallery', key: 'mandel' } as const,
  { ...HOME, encoder: 'half' } satisfies MandelState,
)

// Not in $.state (the contract has no slot): the iteration cap, the drawn
// geometry the pointer messages map through, the last frame, the drag's base.
let iters = 96
let layout = { columns: 0, rows: 0, encoder: 'half' as Encoder }
let last: { key: string; cells: string; ms: number } | undefined
let dragBase: View | undefined

const viewOf = (s: MandelState): View => ({ cx: s.cx, cy: s.cy, scale: s.scale })

// The frame for a view, cached by everything it depends on.
function cellsFor(view: View, enc: Encoder, columns: number, rows: number, maxIter: number): string {
  const key = [view.cx, view.cy, view.scale, enc, columns, rows, maxIter].join('|')
  if (last?.key === key) return last.cells
  const t0 = Date.now()
  const cells = encode(renderFrame(view, enc, columns, rows, maxIter), enc, columns, rows)
  last = { key, cells, ms: Date.now() - t0 }

  return cells
}

export function register(on: On) {
  on('ui.message', { requestId: PANE }, async ($, e) => {
    if (e.element !== OVERLAY) return {}
    const data = e.data as {
      zoom?: { dir: number; x: number; y: number }
      drag?: { dx: number; dy: number; done?: boolean }
    } | null
    if (data === null || typeof data !== 'object' || layout.columns === 0) return {}
    const state = await read($, mandel)

    if (data.zoom !== undefined) {
      const { dir, x, y } = data.zoom
      const next = zoomAt(viewOf(state), layout.encoder, layout.columns, layout.rows, x, y, dir > 0 ? 2 : 0.5)
      await update($, mandel, s => ({ ...s, ...next }))
    } else if (data.drag !== undefined) {
      dragBase ??= viewOf(state)
      const { dx, dy, done } = data.drag
      const next = panBy(dragBase, layout.encoder, layout.columns, layout.rows, dx, dy)
      if (done === true) {
        dragBase = undefined
        await update($, mandel, s => ({ ...s, ...next }))
      } else if (e.surface === 'terminal') {
        // Live preview: a coarse repaint of the shifted view, no tree redraw.
        const cells = cellsFor(next, layout.encoder, layout.columns, layout.rows, Math.min(iters, PREVIEW_ITER))
        await $.ui.blit({ requestId: PANE, key: RASTER, cells })
      }
    }

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, mandel)
    const view = viewOf(state)
    const isTerminal = e.surface === 'terminal'
    const columns = Math.max(8, Math.min(isTerminal ? MAX_COLUMNS : MAX_SVG_COLUMNS, e.props.bodyColumns))
    const rows = Math.max(4, Math.min(isTerminal ? 256 : MAX_SVG_ROWS, e.props.scroll.bodyRows - HEADER_ROWS))
    // The Svg grid is the half-block grid, so one mapping serves both.
    const enc: Encoder = isTerminal ? state.encoder : 'half'
    layout = { columns, rows, encoder: enc }

    const set = (next: Partial<MandelState>) => update($, mandel, s => ({ ...s, ...next }))
    const nudge = (fx: number, fy: number) => () => {
      const next = panBy(view, enc, columns, rows, fx, fy)
      return set(next)
    }
    const stepIters = (d: number) => async () => {
      iters = Math.min(ITER_MAX, Math.max(ITER_MIN, iters + d))
      $.ui.invalidate('ui.render')
    }

    const buttons = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="zoom-in" label="zoom+ (i)" hotkey="i" onPress={() => set(zoomCenter(view, 2))} />
        <Button key="zoom-out" label="zoom- (o)" hotkey="o" onPress={() => set(zoomCenter(view, 0.5))} />
        <Button key="reset" label="reset (r)" hotkey="r" onPress={() => set({ ...HOME })} />
        {isTerminal && (
          <Button
            key="encoder"
            label={`${state.encoder} (e)`}
            hotkey="e"
            onPress={() => set({ encoder: ENCODERS[(ENCODERS.indexOf(state.encoder) + 1) % ENCODERS.length]! })}
          />
        )}
        <Button key="iter-less" label="iter- (d)" hotkey="d" onPress={stepIters(-ITER_STEP)} />
        <Button key="iter-more" label="iter+ (u)" hotkey="u" onPress={stepIters(ITER_STEP)} />
        <Button key="pan-left" label="←" hotkey="h" onPress={nudge(columns / 4, 0)} />
        <Button key="pan-down" label="↓" hotkey="j" onPress={nudge(0, -rows / 4)} />
        <Button key="pan-up" label="↑" hotkey="k" onPress={nudge(0, rows / 4)} />
        <Button key="pan-right" label="→" hotkey="l" onPress={nudge(-columns / 4, 0)} />
      </Box>
    )

    const info = (ms?: number) => (
      <Text dimColor key="info">
        {`${describe(view)}   iter ${iters}${ms === undefined ? '' : `   ${ms} ms`}`}
      </Text>
    )

    if (isTerminal) {
      const { Raster, Client } = $.ui.resolve(e as typeof e & { surface: 'terminal' })
      const cells = cellsFor(view, enc, columns, rows, iters)
      const px = pixelsFor(enc, columns, rows)

      return (
        <Box flexDirection="column">
          {buttons}
          {info(last?.ms)}
          <Text dimColor key="size">{`${px.width}x${px.height} px, left click zoom in, right click zoom out, drag pan`}</Text>
          <Box position="relative" width={columns} height={rows}>
            <Raster key={RASTER} columns={columns} rows={rows} cells={cells} />
            <Box position="absolute" top={0} left={0}>
              <Client key={OVERLAY} module="./overlay-client.tsx" width={columns} height={rows} />
            </Box>
          </Box>
        </Box>
      )
    }

    // desktop, vscode, mobile: an Svg of a low-res grid (rects per row-run).
    const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })
    const gw = columns
    const gh = rows * 2
    const t0 = Date.now()
    const frame = renderGrid(view, gw, rows, gw, gh, iters)
    const source = svgOfFrame(frame, gw * 8, gh * 8)
    const ms = Date.now() - t0
    const picture = <Svg key="picture" source={source} alt={`Mandelbrot set, ${describe(view)}`} width={gw * 8} height={gh * 8} />
    const elements = $.ui.resolve(e)
    const Client = 'Client' in elements ? elements.Client : undefined

    return (
      <Box flexDirection="column">
        {buttons}
        {info(ms)}
        {Client === undefined ? (
          picture
        ) : (
          <Box position="relative" width={columns} height={rows}>
            {picture}
            <Box position="absolute" top={0} left={0}>
              <Client key={OVERLAY} module="./overlay-client.tsx" width={columns} height={rows} />
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
