import type { ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

import { rowHit } from './tree'
import type { Entry, RowHit } from './tree'

// One tree row as the Files section draws it: the selection mark, a rail per
// depth level, the dir arrow, then the name (already cut to the room). The
// keyboard ring sits on the blank Button after the region, so `isCursor`
// underlines the name to show where it is.
//
// Pointer: a left down and up on one part of the row posts `{ hit }` (`arrow`
// on a dir's arrow, `mark` on the mark cell, `name` elsewhere) with the
// `ctrl`/`shift` flags of the down; a second left down within DOUBLE_MS of
// the first posts `{ hit: 'double' }` instead, and its up posts nothing.
type Props = {
  depth: number
  kind: Entry['kind']
  isExpanded: boolean
  isSelected: boolean
  isMarked?: boolean // in the multi-selection: drawn as the selected row
  isCursor: boolean
  isIgnored: boolean
  label: string
  colors: { accent: string; border: string; muted: string; selection: string }
}

const DOUBLE_MS = 400

// Mutable cells shared by the module's calls and its pointer listener: the
// latest props, the part a left button went down on (and its flags), whether
// a first click's window is still open (and what closes it), and whether the
// gesture under way is a double-click's second down.
type Cells = {
  props: Props
  down?: RowHit
  ctrl?: true
  shift?: true
  isArmed: boolean
  disarm?: () => void
  isDouble: boolean
}
type State = { cells: Cells }

const RowClient: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    const cells: Cells = { props, isArmed: false, isDouble: false }
    surface.onPointer(event => point(surface, cells, event))
    surface.setState({ cells })
  } else {
    surface.state.cells.props = props
  }
  const { colors } = props
  const isLit = props.isSelected || props.isMarked === true

  return (
    <Box flexDirection="row" width="100%" backgroundColor={isLit ? colors.selection : undefined}>
      <Text color={colors.accent}>{isLit ? '▌' : ' '}</Text>
      {props.depth > 0 && <Text color={colors.border}>{'│ '.repeat(props.depth)}</Text>}
      <Text color={props.isIgnored ? colors.muted : colors.accent}>
        {props.kind === 'dir' ? (props.isExpanded ? '▾ ' : '▸ ') : '  '}
      </Text>
      <Text dimColor={props.isIgnored} underline={props.isCursor} wrap="truncate-end">
        {props.label}
      </Text>
    </Box>
  )
}

const hitAt = (surface: ClientSurface<State>, cells: Cells, x: number, y: number): RowHit | undefined => {
  if (y !== 0 || x < 0 || (surface.columns > 0 && x >= surface.columns)) return undefined

  return rowHit(cells.props.depth, cells.props.kind, x)
}

// The first click's window: open for DOUBLE_MS after its down, then shut by
// a one-shot timer (no ticking while the row sits idle).
const arm = (surface: ClientSurface<State>, cells: Cells): void => {
  cells.disarm?.()
  cells.isArmed = true
  const stop = surface.every(DOUBLE_MS, () => {
    cells.isArmed = false
    cells.disarm = undefined
    stop()
  })
  cells.disarm = () => {
    cells.isArmed = false
    stop()
  }
}

const point = (surface: ClientSurface<State>, cells: Cells, event: ClientPointerEvent): void => {
  if (event.type === 'down') {
    if (event.button !== 'left') {
      cells.down = undefined

      return
    }
    cells.down = hitAt(surface, cells, event.x, event.y)
    cells.ctrl = event.ctrl
    cells.shift = event.shift
    if (cells.down === undefined) return
    // The arrow only toggles: two quick clicks on it open and close the dir.
    if (cells.down === 'arrow') {
      cells.disarm?.()
      cells.disarm = undefined
      cells.isDouble = false

      return
    }
    if (cells.isArmed) {
      cells.disarm?.()
      cells.disarm = undefined
      cells.isDouble = true
      surface.post({ hit: 'double' })

      return
    }
    cells.isDouble = false
    arm(surface, cells)
  } else if (event.type === 'up') {
    const down = cells.down
    cells.down = undefined
    if (event.button !== 'left' || down === undefined) return
    if (cells.isDouble) {
      cells.isDouble = false

      return
    }
    // Released off the row, or across the arrow edge: no click.
    const up = hitAt(surface, cells, event.x, event.y)
    if (up === undefined || (up === 'arrow') !== (down === 'arrow')) return
    const flags = { ...(cells.ctrl ? { ctrl: true } : {}), ...(cells.shift ? { shift: true } : {}) }
    surface.post({ hit: down, ...flags })
  }
}

export default RowClient
