import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import { encode, pixelsFor } from '../shared/raster'
import type { Encoder } from '../shared/raster'
import type { PlasmaState } from '../../types'
import { createEffect, frameKb } from './effects'
import type { Effect, EffectKind } from './effects'
import { SVG_H, SVG_W, svgFor } from './svg'

const PANE = 'gfx-plasma'
const KEY = 'raster'
const TICK_MS = 33
const MAX_COLUMNS = 200
const MAX_ROWS = 60
// Header buttons line + readout line.
const CHROME_ROWS = 2
// Blits refused this many times in a row mean the Raster is not mounted.
const MAX_DENIED = 15

const ENCODERS: readonly Encoder[] = ['half', 'quad', 'braille']
const EFFECTS: readonly EffectKind[] = ['plasma', 'fire']

const plasma = atom<'gfx-gallery', 'plasma'>(
  { plugin: 'gfx-gallery', key: 'plasma' } as const,
  { playing: true, encoder: 'half', effect: 'plasma' } satisfies PlasmaState,
)

// Transient: reset by a reload, which also drops the timer with the old environment.
type Loop = {
  timer: Timer | undefined
  kind: EffectKind
  encoder: Encoder
  columns: number
  rows: number
  effect: Effect
  frames: number
  denied: number
  lastAt: number
  lastFrames: number
}
let loop: Loop | undefined
const stats = { fps: 0, cells: 0, kb: 0 }

function stopLoop(): void {
  loop?.timer?.cancel()
  loop = undefined
  stats.fps = 0
}

// Pause: the timer stops, the picture and its state stay.
function pauseLoop(): void {
  loop?.timer?.cancel()
  if (loop !== undefined) loop.timer = undefined
  stats.fps = 0
}

const framesOf = (l: Loop): string =>
  encode(l.effect.frame, l.encoder, l.columns, l.rows)

// Idempotent: a loop for the same size and effect only has its encoder updated,
// so redraws never start a second timer.
async function ensureLoop(
  $: EngineInterface,
  kind: EffectKind,
  encoder: Encoder,
  columns: number,
  rows: number,
  isPlaying: boolean,
): Promise<string> {
  if (loop !== undefined && loop.kind === kind && loop.columns === columns && loop.rows === rows) {
    loop.encoder = encoder
    if (isPlaying && loop.timer === undefined) {
      const l = loop
      l.lastFrames = l.frames
      l.timer = $.clock.every(TICK_MS, () => tick($, l))
      l.lastAt = await $.clock.now()
    } else if (!isPlaying) pauseLoop()
    return framesOf(loop)
  }
  stopLoop()
  const effect = createEffect(kind, ...pixelsOf(encoder, columns, rows))
  effect.step()
  const l: Loop = {
    timer: undefined,
    kind,
    encoder,
    columns,
    rows,
    effect,
    frames: 0,
    denied: 0,
    lastAt: await $.clock.now(),
    lastFrames: 0,
  }
  stats.cells = columns * rows
  stats.kb = frameKb(columns, rows)
  if (isPlaying) l.timer = $.clock.every(TICK_MS, () => tick($, l))
  loop = l

  return framesOf(l)
}

const pixelsOf = (encoder: Encoder, columns: number, rows: number): [number, number] => {
  const { width, height } = pixelsFor(encoder, columns, rows)

  return [width, height]
}

async function tick($: EngineInterface, l: Loop): Promise<void> {
  if (loop !== l) return l.timer?.cancel()
  const [w, h] = pixelsOf(l.encoder, l.columns, l.rows)
  if (l.effect.frame.width !== w || l.effect.frame.height !== h) {
    // the encoder changed the pixel grid
    l.effect = createEffect(l.kind, w, h)
  }
  l.effect.step()
  const result = await $.ui.blit({
    requestId: PANE,
    key: KEY,
    cells: framesOf(l),
    columns: l.columns,
    rows: l.rows,
  })
  if (loop !== l) return
  if (result.deny !== undefined) {
    l.denied += 1
    if (l.denied >= MAX_DENIED) pauseLoop()

    return
  }
  l.denied = 0
  l.frames += 1
  if (l.frames - l.lastFrames >= 30) {
    const now = await $.clock.now()
    stats.fps = ((l.frames - l.lastFrames) * 1000) / Math.max(1, now - l.lastAt)
    l.lastAt = now
    l.lastFrames = l.frames
    $.ui.invalidate('ui.render')
  }
}

export function register(on: On) {
  on('ui.close', { id: PANE }, (_$, e, next) => {
    stopLoop()

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, plasma)
    const set = (patch: Partial<PlasmaState>) => update($, plasma, s => ({ ...s, ...patch }))

    const mark = (isOn: boolean, label: string) => (isOn ? `[${label}]` : ` ${label} `)
    const header = (
      <Box key="header:actions" flexDirection="row" gap={1}>
        <Button
          key="play"
          hotkey="p"
          label={state.playing ? 'pause (p)' : 'play (p)'}
          onPress={() => {
            if (state.playing) pauseLoop()
            return set({ playing: !state.playing })
          }}
        />
        {EFFECTS.map(kind => (
          <Button
            key={'effect:' + kind}
            hotkey={kind === 'plasma' ? 'l' : 'i'}
            label={mark(state.effect === kind, kind)}
            onPress={() => set({ effect: kind })}
          />
        ))}
        {e.surface === 'terminal' &&
          ENCODERS.map(enc => (
            <Button
              key={'enc:' + enc}
              hotkey={enc[0]}
              label={mark(state.encoder === enc, enc)}
              onPress={() => set({ encoder: enc })}
            />
          ))}
      </Box>
    )

    if (e.surface !== 'terminal') {
      stopLoop()
      const { Svg } = $.ui.resolve(e)
      const title = state.effect === 'fire' ? 'fire' : 'plasma'

      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>
            {title}, animated by the SVG itself{state.playing ? '' : ' (paused)'}
          </Text>
          <Svg
            key="svg"
            isInteractive
            width={SVG_W}
            height={SVG_H}
            alt={`animated ${title} effect`}
            source={svgFor(state.effect, state.playing)}
          />
        </Box>
      )
    }

    const props = e.props as { bodyColumns?: number; scroll?: { bodyRows?: number } }
    const columns = Math.max(1, Math.min(MAX_COLUMNS, props.bodyColumns ?? e.viewport?.columns ?? 80))
    const rows = Math.max(
      1,
      Math.min(MAX_ROWS, (props.scroll?.bodyRows ?? e.viewport?.rows ?? 24) - CHROME_ROWS),
    )
    const { Raster } = $.ui.resolve(e)
    const cells = await ensureLoop($, state.effect, state.encoder, columns, rows, state.playing)

    return (
      <Box flexDirection="column">
        {header}
        <Text key="stats" dimColor>
          {state.playing ? stats.fps.toFixed(0).padStart(2) : ' 0'} fps | {columns}x{rows} = {columns * rows} cells |{' '}
          {frameKb(columns, rows).toFixed(0)} KB/frame
        </Text>
        <Raster key={KEY} columns={columns} rows={rows} cells={cells} />
      </Box>
    )
  })
}
