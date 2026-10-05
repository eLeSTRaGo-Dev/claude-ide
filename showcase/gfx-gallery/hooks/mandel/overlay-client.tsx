import type { ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

// An invisible pointer layer over the picture: draws an empty Box (no glyph, no
// background) and posts what the pointer did, in cell coordinates of its region
// (fractions where the terminal reports them).
//   { zoom: { dir: 1 | -1, x, y } }      a left (in) or right (out) click
//   { drag: { dx, dy, done? } }          a left drag, cells moved since the press
// A press that stays within DRAG_CELLS of where it went down is a click.
type Props = { label?: string }
type Cells = { down?: { x: number; y: number; button: 'left' | 'right' | 'middle' }; isDrag: boolean }
type State = { cells: Cells }

const DRAG_CELLS = 1

const at = (e: ClientPointerEvent): { x: number; y: number } => ({
  x: e.fine?.x ?? e.x + 0.5,
  y: e.fine?.y ?? e.y + 0.5,
})

const point = (surface: ClientSurface<State>, cells: Cells, e: ClientPointerEvent): void => {
  const p = at(e)
  if (e.type === 'down') {
    cells.down = { ...p, button: e.button ?? 'left' }
    cells.isDrag = false
    return
  }
  const down = cells.down
  if (down === undefined) return
  const dx = p.x - down.x
  const dy = p.y - down.y
  if (e.type === 'move') {
    if (down.button !== 'left') return
    if (!cells.isDrag && Math.hypot(dx, dy) < DRAG_CELLS) return
    cells.isDrag = true
    surface.post({ drag: { dx, dy } })
  } else if (e.type === 'up') {
    if (cells.isDrag) surface.post({ drag: { dx, dy, done: true } })
    else if (down.button === 'left' || down.button === 'right') {
      surface.post({ zoom: { dir: down.button === 'left' ? 1 : -1, x: down.x, y: down.y } })
    }
    cells.down = undefined
    cells.isDrag = false
  }
}

const Overlay: ClientModule<Props, State> = (_props, surface) => {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    const cells: Cells = { isDrag: false }
    surface.onPointer(event => point(surface, cells, event))
    surface.setState({ cells })
  }

  return <Box />
}

export default Overlay
