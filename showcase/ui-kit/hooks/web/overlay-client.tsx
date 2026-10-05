import type { ClientKeyEvent, ClientModule, ClientPointerEvent } from 'claude-code'

// An invisible layer over the page picture. Posts, in cells of its region
// (fractional where the terminal reports pixels):
//   { mouse: { type: 'down' | 'up' | 'move', x, y, button? } }
//   { key: ClientKeyEvent }          keys, once a click has given it the focus
// Hover moves are thinned to ones that cross MOVE_CELLS.
type State = { last?: { x: number; y: number } }

const MOVE_CELLS = 0.4

const Overlay: ClientModule<{ label?: string }, State> = (_props, surface) => {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    const mem: State = {}
    surface.onPointer((e: ClientPointerEvent) => {
      if (e.type === 'enter' || e.type === 'leave') return
      const x = e.fine?.x ?? e.x + 0.5
      const y = e.fine?.y ?? e.y + 0.5
      if (e.type === 'move') {
        const l = mem.last
        if (l !== undefined && Math.hypot(x - l.x, y - l.y) < MOVE_CELLS) return
        mem.last = { x, y }
      }
      surface.post({ mouse: { type: e.type, x, y, ...(e.button !== undefined ? { button: e.button } : {}) } })
    })
    surface.onKey((k: ClientKeyEvent) => {
      surface.post({ key: { key: k.key, ...(k.ctrl ? { ctrl: true } : {}), ...(k.shift ? { shift: true } : {}), ...(k.meta ? { meta: true } : {}) } })
    })
    surface.setState(mem)
  }

  return <Box />
}

export default Overlay
