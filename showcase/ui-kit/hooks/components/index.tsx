import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import { THEMES } from '../shared/theme'
import { Alert, Avatar, Badge, Btn, Card, Chip, Header, Kbd, Page, Progress, Separator, Skeleton, Tabs } from '../shared/ui'
import type { ThemeName } from '../../types'
import type { BadgeVariant } from '../shared/ui'

const PANE = 'uik-components'
// Declared per pane: the validator reads atoms from the file that uses them.
const kit = atom({ plugin: 'ui-kit', key: 'kit' } as const, { theme: 'claude' as ThemeName })
const components = atom({ plugin: 'ui-kit', key: 'components' } as const, { tab: 'overview', progress: 0.35 })

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
] as const
const TAB_TEXT: Record<string, string> = {
  overview: 'Overview: the numbers at a glance.',
  analytics: 'Analytics: charts live here.',
  settings: 'Settings: switch the theme above.',
}
const BADGES: BadgeVariant[] = ['default', 'secondary', 'outline', 'destructive', 'success']
const PEOPLE = ['Ada Lovelace', 'Grace Hopper', 'Linus T', 'Margaret H']

// The progress animation; module-level, so a reload starts over (the pane redraws it).
let timer: Timer | undefined

const stop = () => {
  timer?.cancel()
  timer = undefined
}

const start = ($: EngineInterface) => {
  if (timer !== undefined) return
  timer = $.clock.every(250, () => {
    void update($, components, s => ({ ...s, progress: (s.progress ?? 0) >= 1 ? 0 : Math.min(1, (s.progress ?? 0) + 0.03) }))
  })
}

export function register(on: On) {
  on('ui.close', { id: PANE }, (_$, e, next) => {
    stop()

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const surface = e.surface
    const k = await read($, kit)
    const state = await read($, components)
    const t = THEMES[k.theme]
    const cols = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    start($)

    const two = cols >= 96
    const cardW = two ? Math.floor((cols - 2 - 2 - 1) / 2) : cols - 2
    const inner = cardW - 6
    const barW = Math.max(8, Math.min(30, inner - 12))
    const tab = state.tab ?? 'overview'
    const progress = state.progress ?? 0
    const press = (id: string) => () => void update($, components, s => ({ ...s, tab: id }))
    const bump = (d: number) => () => void update($, components, s => ({ ...s, progress: Math.min(1, Math.max(0, (s.progress ?? 0) + d)) }))
    const btn = (key: string, label: string, variant: Parameters<typeof Btn>[2]['variant'], more: object = {}) =>
      Btn(el, t, { key, label, variant, surface, onPress: () => void $.ui.toast(`pressed ${label}`), ...more })

    return Page(
      el,
      t,
      <>
        {Header(el, t, {
          title: 'Components',
          themeName: k.theme,
          surface,
          onTheme: name => void update($, kit, s => ({ ...s, theme: name })),
        })}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {Card(el, t, {
            key: 'card:buttons',
            title: 'Buttons',
            description: 'Hover a button: the chrome lights, no hook runs.',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {btn('b:primary', 'Primary', 'primary')}
                  {btn('b:secondary', 'Secondary', 'secondary')}
                  {btn('b:outline', 'Outline', 'outline')}
                </Box>
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {btn('b:ghost', 'Ghost', 'ghost', { size: 'sm' })}
                  {btn('b:danger', 'Delete', 'danger', { size: 'sm', icon: '✕' })}
                  {btn('b:link', 'Link', 'link', { size: 'sm' })}
                  {btn('b:pill', 'Pill', 'primary', { size: 'sm', pill: true })}
                  {btn('b:icon', 'Star', 'outline', { size: 'sm', icon: '★' })}
                </Box>
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:badges',
            title: 'Badges',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {BADGES.map(v => Badge(el, t, { key: 'badge:' + v, label: v, variant: v }))}
                </Box>
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {['all', 'open', 'closed'].map(c => Chip(el, t, { key: 'chip:' + c, label: c, selected: c === tab || (c === 'all' && tab === 'overview'), surface, onPress: press(c === 'all' ? 'overview' : c === 'open' ? 'analytics' : 'settings') }))}
                </Box>
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:tabs',
            title: 'Tabs',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                {Tabs(el, t, { tabs: TABS, selected: tab, onSelect: id => press(id)(), style: 'underline', surface })}
                <Text color={t.muted}>{TAB_TEXT[tab] ?? ''}</Text>
                {Tabs(el, t, { tabs: TABS, selected: tab, onSelect: id => press(id)(), style: 'pill', keyPrefix: 'ptab', surface })}
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:progress',
            title: 'Progress',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                {Progress(el, t, { key: 'p:main', value: progress, width: barW })}
                {Progress(el, t, { key: 'p:ok', value: 0.8, width: barW, color: t.success })}
                {Progress(el, t, { key: 'p:warn', value: 0.45, width: barW, color: t.warning })}
                <Box flexDirection="row" gap={1}>
                  {btn('p:minus', '-10%', 'outline', { size: 'sm', onPress: bump(-0.1) })}
                  {btn('p:plus', '+10%', 'outline', { size: 'sm', onPress: bump(0.1) })}
                </Box>
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:alerts',
            title: 'Alerts',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                {Alert(el, t, { key: 'a:info', tone: 'info', title: 'Heads up', description: 'A new version is available.' })}
                {Alert(el, t, { key: 'a:ok', tone: 'success', title: 'Saved', description: 'Your changes are live.' })}
                {Alert(el, t, { key: 'a:warn', tone: 'warning', title: 'Careful' })}
                {Alert(el, t, { key: 'a:err', tone: 'destructive', title: 'Failed', description: 'Could not reach the server.' })}
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:team',
            title: 'Team',
            description: 'People with access to this project.',
            width: cardW,
            footer: <Text color={t.muted}>4 members</Text>,
            children: (
              <Box flexDirection="column" gap={1}>
                {PEOPLE.map(n => (
                  <Box key={'person:' + n} flexDirection="row" gap={1}>
                    {Avatar(el, t, { name: n })}
                    <Text color={t.text}>{n}</Text>
                  </Box>
                ))}
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:misc',
            title: 'Kbd, Separator, Skeleton',
            width: cardW,
            children: (
              <Box flexDirection="column" gap={1}>
                <Box flexDirection="row" gap={1}>
                  <Text color={t.muted}>Search</Text>
                  {Kbd(el, t, { keys: 'ctrl' })}
                  {Kbd(el, t, { keys: 'k' })}
                </Box>
                {Separator(el, t)}
                {Skeleton(el, t, { key: 'sk', width: Math.min(inner, 32), rows: 2 })}
              </Box>
            ),
          })}
        </Box>
      </>,
      rows,
    )
  })
}
