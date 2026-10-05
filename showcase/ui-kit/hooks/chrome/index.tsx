import { atom, read, update } from 'claude-code'
import type { On, RenderChildren } from 'claude-code'

import { encode } from '../shared/raster'
import { themeOf } from '../shared/theme'
import type { ChromeState, KitState } from '../../types'
import { MIN_COLUMNS, ROWS, cellColor, layoutOf, paintScene, parseHex, readable, hex } from './chrome'
import type { ButtonKey, Rect } from './chrome'

const PANE = 'uik-chrome'
const KEY = 'chrome-bg'
const TOGGLE_KEY = 'chrome.toggle'

const chrome = atom<'ui-kit', 'chrome'>({ plugin: 'ui-kit', key: 'chrome' } as const, {} satisfies ChromeState)
const kit = atom<'ui-kit', 'kit'>({ plugin: 'ui-kit', key: 'kit' } as const, { theme: 'claude' } satisfies KitState)

const LABELS: Record<ButtonKey, string> = { primary: 'Get started', secondary: 'Learn more', danger: 'Delete', icon: '★' }
const NAMES: Record<string, string> = {
  primary: 'Get started',
  secondary: 'Learn more',
  danger: 'Delete',
  icon: 'star icon',
  toggle: 'toggle',
}

export function register(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, chrome)
    const theme = themeOf((await read($, kit)).theme)
    const toggleOn = (await $.store.get(TOGGLE_KEY)) !== false
    const press = (key: string) => update($, chrome, s => ({ ...s, pressed: key }))
    const last = state.pressed === undefined ? 'nothing yet' : NAMES[state.pressed] ?? state.pressed

    if (e.surface !== 'terminal') {
      return (
        <Box flexDirection="column">
          <Text dimColor>The pixel chrome (gradients, rounded corners, shadows) draws on the terminal surface only.</Text>
          <Box gap={1}>
            {(['primary', 'secondary', 'danger'] as const).map(k => (
              <Button key={k} label={LABELS[k]} variant={k === 'primary' ? 'primary' : 'secondary'} onPress={() => press(k)} />
            ))}
            <Button key="toggle" label={toggleOn ? 'Toggle: on' : 'Toggle: off'} onPress={async () => {
              await $.store.set(TOGGLE_KEY, !toggleOn)
              await press('toggle')
            }} />
          </Box>
          <Text key="last">{`last pressed: ${last}`}</Text>
        </Box>
      )
    }

    const { Raster } = $.ui.resolve(e)
    const props = e.props as { bodyColumns?: number }
    const columns = Math.max(1, Math.min(512, props.bodyColumns ?? e.viewport?.columns ?? 80))
    if (columns < MIN_COLUMNS) {
      return <Text dimColor>Widen the pane to at least {MIN_COLUMNS} columns for the chrome demo.</Text>
    }

    const L = layoutOf(columns)
    const frame = paintScene(columns, theme, { pressed: state.pressed, toggle: toggleOn })
    const cells = encode(frame, 'quad', L.columns, ROWS)
    const bgAt = (cx: number, cy: number) => cellColor(frame, cx, cy)

    // Text and Buttons paint their own background over the Raster's cells (a plain
    // Text shows the pane colour); a Box background is inherited by what it holds.
    // So each label sits in a Box filled with the colour of the cell under it.
    const at = (cx: number, cy: number, width: number, node: RenderChildren, key?: string) => (
      <Box key={key} position="absolute" left={cx} top={cy} width={width} height={1} backgroundColor={bgAt(cx, cy)}>
        {node}
      </Box>
    )
    const centered = (r: Rect, label: string) => {
      const w = label.length + 2

      return { cx: r.x + Math.floor((r.w - w) / 2), cy: r.y + Math.floor(r.h / 2), w }
    }

    const buttons = (['primary', 'secondary', 'danger', 'icon'] as const).map(k => {
      const label = ` ${LABELS[k]} `
      const p = centered(L.buttons[k], LABELS[k])
      const cx = p.cx

      return (
        <Box key={`box:${k}`} position="absolute" left={cx} top={p.cy} width={p.w} height={1} backgroundColor={bgAt(cx, p.cy)}>
          <Button
            key={k}
            plain
            label={label}
            hover={{ underline: true }}
            onPress={() => press(k)}
          />
        </Box>
      )
    })

    // Toggle: the label sits on the side the knob is not on.
    const t = L.toggle
    const tcx = toggleOn ? t.x + 1 : t.x + 4
    const tlabel = toggleOn ? 'ON' : 'OFF'

    // Hero subtitle: one Text per character, each on its own cell's colour.
    const sub = 'raster pixels, real buttons'
    const subRow = L.hero.y + 6
    const subX = L.hero.x + 3

    const cardColor = (cy: number) => bgAt(L.card.x + 3, cy)
    const line = (cy: number, node: RenderChildren, key: string) => (
      <Box key={key} position="absolute" left={L.card.x + 3} top={cy} height={1} backgroundColor={cardColor(cy)}>
        {node}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box position="relative" width={L.columns} height={ROWS}>
          <Raster key={KEY} columns={L.columns} rows={ROWS} cells={cells} />
          <Box key="sub" position="absolute" left={subX} top={subRow} flexDirection="row" height={1}>
            {[...sub].map((ch, i) => (
              <Box key={`s${i}`} backgroundColor={bgAt(subX + i, subRow)}>
                <Text color={hex(readable(parseHex(bgAt(subX + i, subRow))))}>{ch}</Text>
              </Box>
            ))}
          </Box>
          {line(L.card.y + 1, <Text bold color={theme.text}>Glass card</Text>, 'card:title')}
          <Box key="box:toggle" position="absolute" left={tcx} top={t.y} width={tlabel.length + 1} height={1} backgroundColor={bgAt(tcx, t.y)}>
            <Button key="toggle" plain label={` ${tlabel}`} hover={{ underline: true }} onPress={async () => {
              await $.store.set(TOGGLE_KEY, !toggleOn)
              await press('toggle')
            }} />
          </Box>
          {at(t.x + t.w + 2, t.y, 14, <Text color={theme.text}>Notifications</Text>, 'card:label')}
          {line(L.card.y + 5, <Text key="last" color={theme.text}>{`last pressed: ${last}`}</Text>, 'card:last')}
          {line(L.card.y + 6, <Text color={theme.muted}>hover underlines a label; the pixels do not change</Text>, 'card:note')}
          {buttons}
        </Box>
      </Box>
    )
  })
}
