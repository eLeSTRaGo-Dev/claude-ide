import { atom, read, update } from 'claude-code'
import type { On, RenderChildren } from 'claude-code'

import type { ThemeName } from '../../types'
import { THEMES } from '../shared/theme'
import type { Theme } from '../shared/theme'
import { Card, Header, Page } from '../shared/ui'
import { hsvToHex, snap } from './widgets'

const PANE = 'uik-widgets'
// Declared per pane: the validator reads atoms from the file that uses them.
const kit = atom({ plugin: 'ui-kit', key: 'kit' } as const, { theme: 'claude' as ThemeName })
const widgets = atom({ plugin: 'ui-kit', key: 'widgets' } as const, { values: {} as Record<string, number | boolean | string> })

type Val = number | boolean | string

// Every widget value, with its default; the only keys a message may set.
const DEFAULTS: Record<string, Val> = {
  volume: 40,
  'price.lo': 25,
  'price.hi': 70,
  notify: false,
  qty: 3,
  rating: 3,
  'color.h': 20,
  'color.s': 70,
  'color.v': 90,
  period: 1,
}
const PERIODS = ['Day', 'Week', 'Month']
const HUES = [
  { value: '0', label: 'Red' },
  { value: '30', label: 'Orange' },
  { value: '60', label: 'Yellow' },
  { value: '120', label: 'Green' },
  { value: '200', label: 'Cyan' },
  { value: '240', label: 'Blue' },
  { value: '300', label: 'Magenta' },
]
const RATINGS = [0, 1, 2, 3, 4, 5].map(n => ({ value: String(n), label: n === 0 ? 'No rating' : '★'.repeat(n) }))
const TRACK = 28

export function register(on: On) {
  // A widget committed a value (`{ set: { key: value } }`): keep the ones that are known and
  // of the right type; the new values come back to the Client as props.
  on('ui.message', { requestId: PANE }, async ($, e) => {
    const set = (e.data as { set?: Record<string, unknown> } | null)?.set
    if (set === undefined || set === null || typeof set !== 'object') return {}
    const clean: Record<string, Val> = {}
    for (const [k, v] of Object.entries(set)) if (k in DEFAULTS && typeof v === typeof DEFAULTS[k]) clean[k] = v as Val
    if (Object.keys(clean).length > 0) await update($, widgets, s => ({ ...s, values: { ...s.values, ...clean } }))

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const Select = e.surface !== 'mobile' && 'Select' in el ? el.Select : undefined
    // Client on terminal and desktop only (`'Client' in el` is not a reliable probe on vscode).
    const Client = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in el ? el.Client : undefined
    const k = await read($, kit)
    const state = await read($, widgets)
    const t: Theme = THEMES[k.theme]
    const cols = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    const value = { ...DEFAULTS, ...state.values }
    const num = (key: string): number => Number(value[key])
    const set = (key: string, v: Val) => void update($, widgets, s => ({ ...s, values: { ...s.values, [key]: v } }))
    const colors = { accent: t.accent, border: t.borderStrong, muted: t.muted, text: t.text, onAccent: t.accentText }
    const cardW = cols >= 96 ? Math.floor((cols - 2 - 2 - 1) / 2) : cols - 2

    // The Client (terminal, desktop) or a fallback of Buttons/Select (vscode, mobile).
    const widget = (key: string, props: object, width: number, height: number, fallback: () => RenderChildren) =>
      Client !== undefined ? <Client key={key} module="./widget-client.tsx" props={{ colors, ...props }} width={width} height={height} /> : fallback()
    const stepBtns = (key: string, v: number, min: number, max: number, step: number, label: string, valueKey: string) => (
      <Box key={key} flexDirection="row" gap={1}>
        <Text color={t.text}>{label}</Text>
        <Button key={key + ':dec'} label="−" onPress={() => set(valueKey, snap(v - step, min, max, step))} />
        <Text color={t.text} bold>{String(v)}</Text>
        <Button key={key + ':inc'} label="+" onPress={() => set(valueKey, snap(v + step, min, max, step))} />
      </Box>
    )
    // A Select where the surface has one (mobile: none), else a Button stepping through the options.
    const choice = (key: string, label: string, options: { value: string; label: string }[], current: string, onSelect: (v: string) => void) => {
      if (Select !== undefined) return <Select key={key} label={label} options={options} value={current} onSelect={onSelect} />
      const i = Math.max(0, options.findIndex(o => o.value === current))

      return <Button key={key} label={`${label}: ${options[i]?.label ?? ''} ▸`} onPress={() => onSelect((options[(i + 1) % options.length] as { value: string }).value)} />
    }
    const row = (label: string, body: RenderChildren) => (
      <Box flexDirection="column">
        <Text color={t.muted}>{label}</Text>
        {body}
      </Box>
    )
    const hex = hsvToHex(num('color.h'), num('color.s'), num('color.v'))
    const segW = PERIODS.reduce((n, p) => n + p.length + 2, 0) + PERIODS.length - 1

    return Page(
      el,
      t,
      <>
        {Header(el, t, { title: 'Widgets', themeName: k.theme, surface: e.surface, onTheme: name => void update($, kit, s => ({ ...s, theme: name })) })}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {Card(el, t, {
            key: 'card:sliders',
            title: 'Sliders',
            description: 'Drag, click the track, or use the arrows (shift: ×10).',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                {row(
                  'Volume 0–100',
                  widget('volume', { kind: 'slider', keys: ['volume'], vals: [num('volume')], width: TRACK, min: 0, max: 100, step: 1 }, TRACK + 4, 1, () =>
                    stepBtns('volume', num('volume'), 0, 100, 5, 'Volume', 'volume'),
                  ),
                )}
                {row(
                  'Price range 10–90',
                  widget('price', { kind: 'range', keys: ['price.lo', 'price.hi'], vals: [num('price.lo'), num('price.hi')], width: TRACK, min: 10, max: 90, step: 5 }, TRACK + 7, 1, () => (
                    <Box flexDirection="column">
                      {stepBtns('price-lo', num('price.lo'), 10, Math.min(90, num('price.hi')), 5, 'Min', 'price.lo')}
                      {stepBtns('price-hi', num('price.hi'), Math.max(10, num('price.lo')), 90, 5, 'Max', 'price.hi')}
                    </Box>
                  )),
                )}
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:toggles',
            title: 'Toggle, stepper, rating',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                {row(
                  'Notifications (click or space)',
                  widget('notify', { kind: 'toggle', keys: ['notify'], vals: [value.notify === true] }, 10, 1, () => (
                    <Button key="notify:btn" label={value.notify === true ? 'Notifications: On' : 'Notifications: Off'} onPress={() => set('notify', value.notify !== true)} />
                  )),
                )}
                {row(
                  'Quantity 0–10 (hold + or −)',
                  widget('qty', { kind: 'stepper', keys: ['qty'], vals: [num('qty')], min: 0, max: 10, step: 1 }, 15, 1, () => stepBtns('qty', num('qty'), 0, 10, 1, 'Qty', 'qty')),
                )}
                {row(
                  'Rating (hover, click)',
                  widget('rating', { kind: 'stars', keys: ['rating'], vals: [num('rating')] }, 14, 1, () => (
                    choice('rating:select', 'Rating', RATINGS, String(num('rating')), v => set('rating', Number(v)))
                  )),
                )}
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:color',
            title: 'Color picker',
            description: 'Hue, saturation and value bars; click, drag or use the arrows.',
            width: cardW,
            children: widget('color', { kind: 'color', keys: ['color.h', 'color.s', 'color.v'], vals: [num('color.h'), num('color.s'), num('color.v')] }, 42, 4, () => (
              <Box flexDirection="column" gap={1}>
                {choice('color:hue', 'Hue', HUES, String(HUES.find(h2 => Number(h2.value) === num('color.h'))?.value ?? '0'), v => set('color.h', Number(v)))}
                <Text color={t.text} bold>{`Color ${hex}`}</Text>
              </Box>
            )),
          })}
          {Card(el, t, {
            key: 'card:segmented',
            title: 'Segmented control',
            description: 'Click a segment or use the left and right arrows.',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                {widget('period', { kind: 'segmented', keys: ['period'], vals: [num('period')], min: 0, max: PERIODS.length - 1, options: PERIODS }, segW, 1, () => (
                  choice('period:select', 'Period', PERIODS.map((p, i) => ({ value: String(i), label: p })), String(num('period')), v => set('period', Number(v)))
                ))}
                <Text color={t.muted}>{`Showing: ${PERIODS[num('period')] ?? '?'}`}</Text>
              </Box>
            ),
          })}
        </Box>
      </>,
      rows,
    )
  })
}
