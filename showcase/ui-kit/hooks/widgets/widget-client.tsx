import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

import { clamp, hsvToHex, nearerThumb, pointerX, readable, snap, starsFromX, thumbCell, toggleCell, toggleStep, valueFromX } from './widgets'

// One module draws every widget of the pane (`kind`); each keeps local state for instant
// feedback and posts `{ set: { key: value } }`, the hook writes it to $.state and the
// value comes back through `vals`.
export type Kind = 'slider' | 'range' | 'toggle' | 'stepper' | 'stars' | 'color' | 'segmented'
type Val = number | boolean | string
type Colors = { accent: string; border: string; muted: string; text: string; onAccent: string }
type Props = {
  kind: Kind
  keys: string[]
  vals: Val[]
  colors: Colors
  width?: number // slider/range track, color bar length
  min?: number
  max?: number
  step?: number
  options?: string[] // segmented labels
}

type Cells = {
  props: Props
  local?: Val[] // the values drawn until the hook's props catch up
  drag?: number // slider/range thumb index, color bar row under a drag
  active: number // range thumb / color bar the keys move
  hover?: number // stars preview
  hold?: { dir: number; ticks: number } // stepper auto-repeat
  progress: number // toggle thumb animation 0..1
}
type State = { cells: Cells }
type Surf = ClientSurface<State>

const TOGGLE_INNER = 4
const STEPPER_HOLD_TICKS = 5
const STARS = 5
const COLOR_CELLS = 36

const same = (a: Val[], b: Val[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])
const cur = (c: Cells): Val[] => c.local ?? c.props.vals
const num = (c: Cells, i: number): number => {
  const v = cur(c)[i]

  return typeof v === 'number' ? v : 0
}

function commit(surface: Surf, c: Cells, vals: Val[]): void {
  if (same(vals, cur(c))) return
  c.local = vals
  const set: Record<string, Val> = {}
  c.props.keys.forEach((k, i) => (set[k] = vals[i] as Val))
  surface.post({ set })
  surface.setState({ cells: c })
}

const range = (p: Props): { min: number; max: number; step: number } => ({ min: p.min ?? 0, max: p.max ?? 100, step: p.step ?? 1 })

// ---- input ----

function key(surface: Surf, c: Cells, ev: ClientKeyEvent): void {
  const p = c.props
  const { min, max, step } = range(p)
  const dir = ev.key === 'left' || ev.key === 'down' ? -1 : ev.key === 'right' || ev.key === 'up' ? 1 : 0
  const jump = ev.shift === true ? 10 : 1
  if (p.kind === 'slider') {
    if (ev.key === 'home') return commit(surface, c, [min])
    if (ev.key === 'end') return commit(surface, c, [max])
    if (dir !== 0) commit(surface, c, [snap(num(c, 0) + dir * step * jump, min, max, step)])
  } else if (p.kind === 'range') {
    const [lo, hi] = [num(c, 0), num(c, 1)]
    if (ev.key === 'tab') {
      c.active = 1 - c.active
      surface.setState({ cells: c })
    } else if (dir !== 0) {
      // left/right move the active thumb; up/down swap which one is active
      if (ev.key === 'up' || ev.key === 'down') {
        c.active = ev.key === 'up' ? 1 : 0
        surface.setState({ cells: c })
      } else if (c.active === 0) commit(surface, c, [clamp(snap(lo + dir * step * jump, min, max, step), min, hi), hi])
      else commit(surface, c, [lo, clamp(snap(hi + dir * step * jump, min, max, step), lo, max)])
    }
  } else if (p.kind === 'toggle') {
    if (ev.key === ' ' || ev.key === 'return') commit(surface, c, [cur(c)[0] !== true])
  } else if (p.kind === 'stepper') {
    if (dir !== 0) commit(surface, c, [clamp(num(c, 0) + dir * step, min, max)])
  } else if (p.kind === 'stars') {
    if (dir !== 0) commit(surface, c, [clamp(num(c, 0) + dir, 0, STARS)])
    else if (/^[0-5]$/.test(ev.key)) commit(surface, c, [Number(ev.key)])
  } else if (p.kind === 'segmented') {
    const n = (p.options ?? []).length
    if (dir !== 0 && n > 0) commit(surface, c, [clamp(num(c, 0) + dir, 0, n - 1)])
  } else {
    const maxes = [359, 100, 100]
    if (ev.key === 'up' || ev.key === 'down') {
      c.active = clamp(c.active + (ev.key === 'down' ? 1 : -1), 0, 2)
      surface.setState({ cells: c })
    } else if (dir !== 0) {
      const vals = cur(c).map(Number)
      vals[c.active] = clamp((vals[c.active] ?? 0) + dir * 5 * jump, 0, maxes[c.active] as number)
      commit(surface, c, vals)
    }
  }
}

// `[ - ]` + ' ' + value (4 cells) + ' ' + `[ + ]`
const STEPPER_PLUS_AT = 10

function pointer(surface: Surf, c: Cells, ev: ClientPointerEvent): void {
  const p = c.props
  const { min, max, step } = range(p)
  const width = p.width ?? 20
  const px = pointerX(ev)
  const isDown = ev.type === 'down' && ev.button === 'left'
  const dragging = c.drag !== undefined && (ev.type === 'move' || ev.type === 'up')
  if (p.kind === 'slider') {
    if (isDown) c.drag = 0
    if (isDown || dragging) commit(surface, c, [valueFromX(px, width, min, max, step)])
  } else if (p.kind === 'range') {
    const v = valueFromX(px, width, min, max, step)
    const [lo, hi] = [num(c, 0), num(c, 1)]
    if (isDown) {
      c.drag = nearerThumb(v, lo, hi) === 'lo' ? 0 : 1
      c.active = c.drag
    }
    if (isDown || dragging) commit(surface, c, c.drag === 0 ? [clamp(v, min, hi), hi] : [lo, clamp(v, lo, max)])
  } else if (p.kind === 'toggle') {
    if (isDown) commit(surface, c, [cur(c)[0] !== true])
  } else if (p.kind === 'stepper') {
    if (isDown) {
      const dir = ev.x < 5 ? -1 : ev.x >= STEPPER_PLUS_AT ? 1 : 0
      if (dir !== 0) {
        c.hold = { dir, ticks: 0 }
        commit(surface, c, [clamp(num(c, 0) + dir * step, min, max)])
      }
    } else if (ev.type === 'up' || ev.type === 'leave') {
      c.hold = undefined
    }
  } else if (p.kind === 'stars') {
    const n = ev.x < 0 || ev.x >= STARS * 2 - 1 ? undefined : starsFromX(ev.x, STARS)
    if (isDown && n !== undefined) commit(surface, c, [n === num(c, 0) ? 0 : n])
    else if (ev.type === 'move' && !dragging) {
      c.hover = n
      surface.setState({ cells: c })
    } else if (ev.type === 'leave') {
      c.hover = undefined
      surface.setState({ cells: c })
    }
  } else if (p.kind === 'segmented') {
    if (isDown) {
      let at = 0
      const labels = p.options ?? []
      for (let i = 0; i < labels.length; i++) {
        const w = (labels[i] as string).length + 2
        if (ev.x >= at && ev.x < at + w) return commit(surface, c, [i])
        at += w + 1
      }
    }
  } else {
    if (isDown) {
      c.drag = clamp(ev.y, 0, 2)
      c.active = c.drag
    }
    if ((isDown || dragging) && c.drag !== undefined) {
      const vals = cur(c).map(Number)
      vals[c.drag] = valueFromX(px, COLOR_CELLS, 0, c.drag === 0 ? 359 : 100, 1)
      commit(surface, c, vals)
    }
  }
  if (ev.type === 'up') c.drag = undefined
}

// ---- drawing ----

const Widget: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const col = props.colors
  if (surface.state === undefined) {
    const cells: Cells = { props, active: 1, progress: props.kind === 'toggle' && props.vals[0] === true ? 1 : 0 }
    surface.onPointer(ev => pointer(surface, cells, ev))
    surface.onKey(ev => key(surface, cells, ev))
    // One frame clock for the toggle's slide and the stepper's auto-repeat.
    surface.every(props.kind === 'stepper' ? 80 : 50, () => {
      const c = cells
      if (c.props.kind === 'toggle') {
        const to = toggleStep(c.progress, cur(c)[0] === true, 50, 150)
        if (to !== c.progress) {
          c.progress = to
          surface.setState({ cells: c })
        }
      } else if (c.hold !== undefined) {
        c.hold.ticks++
        if (c.hold.ticks >= STEPPER_HOLD_TICKS) {
          const { min, max, step } = range(c.props)
          commit(surface, c, [clamp(num(c, 0) + c.hold.dir * step, min, max)])
        }
      }
    })
    surface.setState({ cells })
  }
  const c = surface.state?.cells ?? { props, active: 1, progress: 0 }
  c.props = props
  // The hook's props caught up with what this instance posted: drop the local value.
  if (c.local !== undefined && c.drag === undefined && same(c.local, props.vals)) c.local = undefined
  const vals = cur(c)
  const { min, max } = range(props)
  const width = props.width ?? 20

  if (props.kind === 'slider') {
    const v = Number(vals[0])
    const at = thumbCell(v, min, max, width)

    return (
      <Box flexDirection="row" height={1}>
        <Text color={col.accent}>{'━'.repeat(at)}</Text>
        <Text color={col.accent} bold>●</Text>
        <Text color={col.border}>{'━'.repeat(width - at - 1)}</Text>
        <Text color={col.text}>{' ' + String(v).padStart(3)}</Text>
      </Box>
    )
  }

  if (props.kind === 'range') {
    const [lo, hi] = [Number(vals[0]), Number(vals[1])]
    const a = thumbCell(lo, min, max, width)
    const b = Math.max(a, thumbCell(hi, min, max, width))
    const thumb = (i: number) => (c.active === i ? col.text : col.accent)

    return (
      <Box flexDirection="row" height={1}>
        <Text color={col.border}>{'━'.repeat(a)}</Text>
        <Text color={thumb(0)} bold>●</Text>
        <Text color={col.accent}>{'━'.repeat(Math.max(0, b - a - 1))}</Text>
        {b > a ? <Text color={thumb(1)} bold>●</Text> : null}
        <Text color={col.border}>{'━'.repeat(width - b - 1)}</Text>
        <Text color={col.text}>{` ${lo}–${hi}`}</Text>
      </Box>
    )
  }

  if (props.kind === 'toggle') {
    // ▐ ▌ are the pill's half-block caps; the thumb slides over the inner cells.
    const on = vals[0] === true
    const fill = c.progress >= 0.5 ? col.accent : col.border
    const at = toggleCell(c.progress, TOGGLE_INNER)

    return (
      <Box flexDirection="row" height={1}>
        <Text color={fill}>▐</Text>
        {Array.from({ length: TOGGLE_INNER }, (_, i) => (
          <Text key={'cell:' + i} backgroundColor={fill} color={col.onAccent}>
            {i === at ? '●' : ' '}
          </Text>
        ))}
        <Text color={fill}>▌</Text>
        <Text color={on ? col.text : col.muted}>{on ? ' On' : ' Off'}</Text>
      </Box>
    )
  }

  if (props.kind === 'stepper') {
    const v = Number(vals[0])

    return (
      <Box flexDirection="row" height={1}>
        <Text color={v <= min ? col.muted : col.accent}>[ − ]</Text>
        <Text color={col.text} bold>{' ' + String(v).padStart(2).padEnd(3) + ' '}</Text>
        <Text color={v >= max ? col.muted : col.accent}>[ + ]</Text>
      </Box>
    )
  }

  if (props.kind === 'stars') {
    const lit = c.hover ?? Number(vals[0])
    const preview = c.hover !== undefined

    return (
      <Box flexDirection="row" height={1}>
        {Array.from({ length: STARS }, (_, i) => (
          <Text key={'star:' + i} color={i < lit ? (preview ? col.text : col.accent) : col.muted}>
            {(i < lit ? '★' : '☆') + (i < STARS - 1 ? ' ' : '')}
          </Text>
        ))}
        <Text color={col.muted}>{`  ${Number(vals[0])}/${STARS}`}</Text>
      </Box>
    )
  }

  if (props.kind === 'segmented') {
    const labels = props.options ?? []
    const sel = Number(vals[0])

    return (
      <Box flexDirection="row" height={1}>
        {labels.map((label, i) => [
          i > 0 ? (
            <Text key={'sep:' + i} color={col.border}>
              │
            </Text>
          ) : null,
          <Text key={'seg:' + i} backgroundColor={i === sel ? col.accent : undefined} color={i === sel ? col.onAccent : col.text} bold={i === sel}>
            {` ${label} `}
          </Text>,
        ])}
      </Box>
    )
  }

  // color picker: hue, saturation and value bars, then the swatch
  const [hue, sat, val] = [Number(vals[0]), Number(vals[1]), Number(vals[2])]
  const bars: { name: string; at: number; cell: (i: number) => string }[] = [
    { name: 'h', at: thumbCell(hue, 0, 359, COLOR_CELLS), cell: i => hsvToHex((i / (COLOR_CELLS - 1)) * 359, 100, 100) },
    { name: 's', at: thumbCell(sat, 0, 100, COLOR_CELLS), cell: i => hsvToHex(hue, (i / (COLOR_CELLS - 1)) * 100, val) },
    { name: 'v', at: thumbCell(val, 0, 100, COLOR_CELLS), cell: i => hsvToHex(hue, sat, (i / (COLOR_CELLS - 1)) * 100) },
  ]
  const hex = hsvToHex(hue, sat, val)

  return (
    <Box flexDirection="column">
      {bars.map((bar, row) => (
        <Box key={'bar:' + bar.name} flexDirection="row" height={1}>
          {Array.from({ length: COLOR_CELLS }, (_, i) => {
            const bg = bar.cell(i)

            return (
              <Text key={'c:' + i} backgroundColor={bg} color={readable(bg)}>
                {i === bar.at ? (c.active === row ? '◆' : '◇') : ' '}
              </Text>
            )
          })}
          <Text color={c.active === row ? col.text : col.muted}>{' ' + bar.name + ' ' + [hue, sat, val][row]}</Text>
        </Box>
      ))}
      <Box flexDirection="row" height={1}>
        <Text backgroundColor={hex} color={readable(hex)}>{'      '}</Text>
        <Text color={col.text} bold>{' ' + hex}</Text>
      </Box>
    </Box>
  )
}

export default Widget
