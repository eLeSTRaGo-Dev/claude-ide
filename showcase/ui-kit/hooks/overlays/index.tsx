import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { THEMES } from '../shared/theme'
import { Btn, Card, DropdownMenu, Header, Modal, ModalBtn, Page, Tooltip, TooltipTrigger } from '../shared/ui'
import type { MenuItem } from '../shared/ui'
import type { ThemeName } from '../../types'
import { menuSize } from './overlay'

const PANE = 'uik-overlays'
const DIALOG = 'uik-dialog'
// Declared per pane: the validator reads atoms from the file that uses them.
const kit = atom({ plugin: 'ui-kit', key: 'kit' } as const, { theme: 'claude' as ThemeName })
const overlays = atom({ plugin: 'ui-kit', key: 'overlays' } as const, {} as { modal?: 'info' | 'delete'; menu?: string })

const MENU: readonly MenuItem[] = [
  { key: 'edit', label: 'Edit', icon: '✎', kbd: 'ctrl+e' },
  { key: 'copy', label: 'Duplicate', icon: '⧉', kbd: 'ctrl+d' },
  { key: 'share', label: 'Share', icon: '↗' },
  { key: 'sep', label: '', separator: true },
  { key: 'delete', label: 'Delete', icon: '✕', destructive: true },
]
const MENU_H = menuSize(MENU).height
const TIPS = [
  { id: 'info', icon: 'ⓘ', text: 'Shows project info' },
  { id: 'star', icon: '★', text: 'Add to favourites' },
  { id: 'cog', icon: '⚙', text: 'Open settings' },
] as const

const without = <T extends object>(s: T, key: keyof T): T => {
  const { [key]: _drop, ...rest } = s

  return rest as T
}

const openDialog = ($: EngineInterface) => $.ui.open({ id: DIALOG, title: 'Confirm', focus: true, closeOnEscape: true, holdToasts: true, rows: 9 })

export function register(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const surface = e.surface
    const k = await read($, kit)
    const state = await read($, overlays)
    const t = THEMES[k.theme]
    const cols = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    const cardW = Math.max(24, cols - 2)

    const set = (patch: { modal?: 'info' | 'delete'; menu?: string }) => () => void update($, overlays, s => ({ ...s, ...patch }))
    const clear = (key: 'modal' | 'menu') => () => void update($, overlays, s => without(s, key))
    const toast = (text: string) => () => void $.ui.toast(text)
    const btn = (key: string, label: string, variant: Parameters<typeof Btn>[2]['variant'], onPress: () => void, more: object = {}) =>
      Btn(el, t, { key, label, variant, size: 'sm', surface, onPress, ...more })
    const pick = (key: string) => {
      void update($, overlays, s => without(s, 'menu'))
      void $.ui.toast(`Menu: ${MENU.find(i => i.key === key)?.label ?? key}`)
    }
    const modal = state.modal

    const content = (
      <>
        {Header(el, t, { title: 'Overlays', themeName: k.theme, surface, onTheme: name => void update($, kit, s => ({ ...s, theme: name })) })}
        {Card(el, t, {
          key: 'card:modal',
          title: 'In-pane modal',
          description: 'Backdrop + centered card + shadow, drawn last. Cancel: hotkey c or Escape-less dismiss Button.',
          width: cardW,
          children: (
            <Box flexDirection="row" gap={2}>
              {btn('open:info', 'Open dialog', 'primary', set({ modal: 'info' }), { hotkey: 'o' })}
              {btn('open:delete', 'Delete project…', 'danger', set({ modal: 'delete' }), { hotkey: 'x' })}
            </Box>
          ),
        })}
        {Card(el, t, {
          key: 'card:dialogs',
          title: 'Dialogs',
          description: 'A real pane (closeOnEscape, holdToasts) and the engine ask dialog.',
          width: cardW,
          children: (
            <Box flexDirection="row" gap={2}>
              {btn('dlg:pane', 'Open as pane', 'outline', () => void openDialog($))}
              {btn('dlg:ask', 'Ask (engine)', 'outline', () => void $.ui.ask('Pick a framework', ['React', 'Svelte', 'Solid']).then(a => $.ui.toast(`Picked ${a}`)))}
            </Box>
          ),
        })}
        {Card(el, t, {
          key: 'card:menus',
          title: 'Dropdown menus',
          description: 'Left: press-to-open (state). Right: hover-revealed (display + scope, no hook).',
          width: cardW,
          children: (
            <Box flexDirection="row" gap={6}>
              <Box key="menu:wrap" flexDirection="column" minHeight={MENU_H + 1} minWidth={24}>
                {btn('menu:trigger', 'Options ▾', 'outline', () => void update($, overlays, s => (s.menu === 'options' ? without(s, 'menu') : { ...s, menu: 'options' })))}
                {state.menu === 'options' ? DropdownMenu(el, t, { key: 'menu:pop', items: MENU, onSelect: pick, top: 1, left: 0, surface }) : null}
              </Box>
              <Box key="hmenu:wrap" flexDirection="column" minHeight={MENU_H + 1} minWidth={24}>
                {TooltipTrigger(el, t, { scope: 'hm', children: <Text color={t.text}> Hover me ▾ </Text> })}
                {DropdownMenu(el, t, { key: 'hmenu:pop', items: MENU, onSelect: pick, top: 1, left: 0, surface, scope: 'hm' })}
              </Box>
            </Box>
          ),
        })}
        {Card(el, t, {
          key: 'card:tips',
          title: 'Tooltips',
          description: 'Hover an icon: a display:none card is revealed by hover of the same scope.',
          width: cardW,
          children: (
            <Box flexDirection="row" gap={8}>
              {TIPS.map(tip => (
                <Box key={'tip:' + tip.id} flexDirection="column" minHeight={4} minWidth={5}>
                  {TooltipTrigger(el, t, { scope: 'tip:' + tip.id, children: <Text color={t.text}> {tip.icon} </Text> })}
                  {Tooltip(el, t, { scope: 'tip:' + tip.id, text: tip.text, top: 1, left: 0 })}
                </Box>
              ))}
            </Box>
          ),
        })}
        {Card(el, t, {
          key: 'card:toasts',
          title: 'Toasts',
          width: cardW,
          children: (
            <Box flexDirection="row" gap={2}>
              {btn('toast:ok', 'Success', 'outline', toast('✓ Saved successfully'))}
              {btn('toast:err', 'Error', 'outline', toast('✕ Could not save: network error'))}
              {btn('toast:info', 'Info', 'outline', toast('ℹ A new version is available'))}
            </Box>
          ),
        })}
      </>
    )

    // The overlay goes after the page, in an unbordered wrapper: draw order is z-order.
    const isDelete = modal === 'delete'
    const done = (text: string) => () => {
      void update($, overlays, s => without(s, 'modal'))
      void $.ui.toast(text)
    }

    return (
      <Box key="overlays:root" flexDirection="column" width="100%">
        {Page(el, t, content, rows)}
        {modal !== undefined
          ? Modal(el, t, {
              key: 'modal',
              title: isDelete ? 'Delete project?' : 'Edit profile',
              body: isDelete ? 'This permanently removes the project and all of its files. This cannot be undone.' : 'Make changes to your profile here. Click continue when you are done.',
              cols,
              rows,
              destructive: isDelete,
              footer: [
                ModalBtn(el, t, { key: 'modal:cancel', label: 'Cancel', variant: 'ghost', hotkey: 'c', dismiss: true, surface, onPress: clear('modal') }),
                ModalBtn(el, t, { key: 'modal:ok', label: isDelete ? 'Delete' : 'Continue', variant: isDelete ? 'danger' : 'primary', autoFocus: true, surface, onPress: done(isDelete ? 'Project deleted' : 'Profile saved') }),
              ],
            })
          : null}
      </Box>
    )
  })

  // The dialog pane: opened on demand by "Open as pane".
  on('ui.render', { component: 'Pane', requestId: DIALOG }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const k = await read($, kit)
    const t = THEMES[k.theme]
    const choose = (text: string) => () => {
      void $.ui.close({ id: DIALOG })
      void $.ui.toast(text)
    }

    return (
      <Box key="dialog" flexDirection="column" backgroundColor={t.bg} paddingX={2} paddingY={1} gap={1} width="100%">
        <Text bold color={t.text}>Apply changes?</Text>
        <Text color={t.muted}>Escape cancels. This pane holds toasts until it closes.</Text>
        <Box flexDirection="row" gap={1}>
          {ModalBtn(el, t, { key: 'dlg:cancel', label: 'Cancel', variant: 'ghost', dismiss: true, surface: e.surface, onPress: choose('Dialog: cancelled') })}
          {ModalBtn(el, t, { key: 'dlg:ok', label: 'Apply', variant: 'primary', autoFocus: true, surface: e.surface, onPress: choose('Dialog: applied') })}
        </Box>
      </Box>
    )
  })
}
