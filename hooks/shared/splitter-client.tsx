import type { ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

type Props = {
  axis: 'x' | 'y' // x: a vertical seam dragged sideways; y: a horizontal seam dragged up and down
  length: number // cells along the seam
  cells: number // size of the section before the seam, as drawn now
  span?: number // cells across the seam (default 1): 2 covers both borders of the gap
  color: string
  // x axis only: the seam's last column takes `text` at these rows (from the
  // region's top) instead of `│`, e.g. a frame corner the seam would cover;
  // drawn in `color` here, never the held highlight. Default: none.
  marks?: readonly { row: number; text: string }[]
}

// The latest props, and the drag: `start` is the section's size at `down`
// (`undefined` when none), `grab` where the pointer took hold.
type Cells = { props: Props; start?: number; grab: number }
type State = { cells: Cells }

const Splitter: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    const cells: Cells = { props, grab: 0 }
    surface.onPointer(event => point(surface, cells, event))
    surface.setState({ cells })
  } else {
    surface.state.cells.props = props
  }
  const isHeld = surface.state?.cells.start !== undefined
  const color = isHeld ? 'white' : props.color
  const length = Math.max(1, props.length)
  const span = Math.max(1, props.span ?? 1)

  return props.axis === 'y' ? (
    <Box flexDirection="column" height={span} flexShrink={0}>
      {Array.from({ length: span }, (_, i) => (
        <Text key={'seam:' + i} color={color} bold={isHeld}>
          {'─'.repeat(length)}
        </Text>
      ))}
    </Box>
  ) : (
    <Box flexDirection="column" width={span} flexShrink={0}>
      {Array.from({ length }, (_, i) => {
        const mark = props.marks?.find(m => m.row === i)

        return mark === undefined ? (
          <Text key={'seam:' + i} color={color} bold={isHeld}>
            {'│'.repeat(span)}
          </Text>
        ) : (
          <Text key={'seam:' + i} color={color} bold={isHeld}>
            {'│'.repeat(span - 1)}
            <Text color={props.color} bold={false}>
              {mark.text}
            </Text>
          </Text>
        )
      })}
    </Box>
  )
}

const point = (
  surface: ClientSurface<State>,
  cells: Cells,
  event: ClientPointerEvent,
): void => {
  const { props } = cells
  const at = props.axis === 'x' ? event.x : event.y
  if (event.type === 'down' && event.button === 'left') {
    cells.start = props.cells
    cells.grab = at
    surface.setState({ cells })
  } else if ((event.type === 'move' || event.type === 'up') && cells.start !== undefined) {
    // The region moves with the seam, so its cells are relative to where the
    // seam is now: add the distance it has already travelled.
    const delta = at - cells.grab + (props.cells - cells.start)
    const start = cells.start
    const isDone = event.type === 'up'
    if (isDone) cells.start = undefined
    surface.post(isDone ? { start, delta, done: true } : { start, delta })
    surface.setState({ cells })
  }
}

export default Splitter
