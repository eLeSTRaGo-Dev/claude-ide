import type { ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

import { THUMB, scrollbar } from './scrollbar'

type Props = {
  total: number
  visible: number
  offset: number
  height: number
  color: string
}

// Mutable cells shared by the module's calls and its pointer listener: the
// latest props, and the offset under a drag (`undefined` when none).
type Cells = { props: Props; held?: number; grab: number }
type State = { cells: Cells }

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max))

const thumbOf = (props: Props, rows: number): number =>
  Math.min(rows, Math.max(1, Math.round((rows * props.visible) / props.total)))

// Offset that puts the thumb's top row at `top`.
const offsetAt = (props: Props, rows: number, top: number): number => {
  const free = rows - thumbOf(props, rows)
  const span = props.total - props.visible
  if (free <= 0) return 0

  return clamp(Math.round((top / free) * span), span)
}

const topOf = (props: Props, rows: number, offset: number): number => {
  const free = rows - thumbOf(props, rows)
  const span = props.total - props.visible

  return Math.round(free * clamp(offset / span, 1))
}

const ScrollBar: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const rows = surface.rows > 0 ? surface.rows : props.height
  if (surface.state === undefined) {
    const cells: Cells = { props, grab: 0 }
    surface.onPointer(event => point(surface, cells, event))
    surface.setState({ cells })
  } else {
    surface.state.cells.props = props
  }
  const held = surface.state?.cells.held
  const bar = scrollbar(props.total, props.visible, held ?? props.offset, rows)

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
  const rows = surface.rows > 0 ? surface.rows : props.height
  if (props.total <= props.visible || rows <= 0) return
  const thumb = thumbOf(props, rows)
  const top = topOf(props, rows, cells.held ?? props.offset)
  const isDragging = cells.held !== undefined
  if (event.type === 'down' && event.button === 'left') {
    const isThumb = event.y >= top && event.y < top + thumb
    cells.grab = isThumb ? event.y - top : Math.floor(thumb / 2)
    cells.held = offsetAt(props, rows, event.y - cells.grab)
    surface.post({ offset: cells.held })
    surface.setState({ cells })
  } else if (event.type === 'move' && isDragging) {
    cells.held = offsetAt(props, rows, event.y - cells.grab)
    surface.post({ offset: cells.held })
    surface.setState({ cells })
  } else if (event.type === 'up' && isDragging) {
    const offset = offsetAt(props, rows, event.y - cells.grab)
    cells.held = undefined
    surface.post({ offset })
    surface.setState({ cells })
  }
}

export default ScrollBar
