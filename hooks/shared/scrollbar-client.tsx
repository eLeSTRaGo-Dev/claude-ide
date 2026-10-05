import type { ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

import { H_THUMB, H_TRACK, THUMB, scrollbar } from './scrollbar'

// `axis` 'y' (the default) draws one column of `height` rows; 'x' draws one
// row, `height` then read as the bar's length in columns. The laid-out size
// (`surface.rows` / `surface.columns`) wins over `height` once known.
type Props = {
  total: number
  visible: number
  offset: number
  height: number
  color: string
  axis?: 'x' | 'y'
}

// Mutable cells shared by the module's calls and its pointer listener: the
// latest props, and the offset under a drag (`undefined` when none).
type Cells = { props: Props; held?: number; grab: number }
type State = { cells: Cells }

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max))

// The bar's length in cells along its axis.
const lengthOf = (surface: ClientSurface<State>, props: Props): number =>
  props.axis === 'x'
    ? surface.columns > 0 ? surface.columns : props.height
    : surface.rows > 0 ? surface.rows : props.height

const thumbOf = (props: Props, length: number): number =>
  Math.min(length, Math.max(1, Math.round((length * props.visible) / props.total)))

// Offset that puts the thumb's first cell at `top`.
const offsetAt = (props: Props, length: number, top: number): number => {
  const free = length - thumbOf(props, length)
  const span = props.total - props.visible
  if (free <= 0) return 0

  return clamp(Math.round((top / free) * span), span)
}

const topOf = (props: Props, length: number, offset: number): number => {
  const free = length - thumbOf(props, length)
  const span = props.total - props.visible

  return Math.round(free * clamp(offset / span, 1))
}

const ScrollBar: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const length = lengthOf(surface, props)
  if (surface.state === undefined) {
    const cells: Cells = { props, grab: 0 }
    surface.onPointer(event => point(surface, cells, event))
    surface.setState({ cells })
  } else {
    surface.state.cells.props = props
  }
  const held = surface.state?.cells.held
  const offset = held ?? props.offset

  if (props.axis === 'x') {
    const bar = scrollbar(props.total, props.visible, offset, length, {
      thumb: H_THUMB,
      track: H_TRACK,
    })

    return (
      <Box flexDirection="row" height={1} flexShrink={0}>
        {bar.map((cell, i) =>
          cell === H_THUMB ? (
            <Text key={'bar:' + i} color={props.color}>
              {cell}
            </Text>
          ) : (
            <Text key={'bar:' + i} dimColor>
              {cell}
            </Text>
          ),
        )}
      </Box>
    )
  }

  const bar = scrollbar(props.total, props.visible, offset, length)

  return (
    <Box flexDirection="column" width={1} flexShrink={0}>
      {bar.map((cell, i) =>
        cell === THUMB ? (
          <Text key={'bar:' + i} color={props.color}>
            {cell}
          </Text>
        ) : (
          <Text key={'bar:' + i} dimColor>
            {cell}
          </Text>
        ),
      )}
    </Box>
  )
}

const point = (
  surface: ClientSurface<State>,
  cells: Cells,
  event: ClientPointerEvent,
): void => {
  const { props } = cells
  const length = lengthOf(surface, props)
  if (props.total <= props.visible || length <= 0) return
  const at = props.axis === 'x' ? event.x : event.y
  const thumb = thumbOf(props, length)
  const top = topOf(props, length, cells.held ?? props.offset)
  const isDragging = cells.held !== undefined
  if (event.type === 'down' && event.button === 'left') {
    const isThumb = at >= top && at < top + thumb
    cells.grab = isThumb ? at - top : Math.floor(thumb / 2)
    cells.held = offsetAt(props, length, at - cells.grab)
    surface.post({ offset: cells.held })
    surface.setState({ cells })
  } else if (event.type === 'move' && isDragging) {
    cells.held = offsetAt(props, length, at - cells.grab)
    surface.post({ offset: cells.held })
    surface.setState({ cells })
  } else if (event.type === 'up' && isDragging) {
    const offset = offsetAt(props, length, at - cells.grab)
    cells.held = undefined
    surface.post({ offset })
    surface.setState({ cells })
  }
}

export default ScrollBar
