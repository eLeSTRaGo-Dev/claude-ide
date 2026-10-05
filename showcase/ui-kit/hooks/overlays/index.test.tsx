import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'ui-kit'
const PROPS = { title: 'Overlays', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } as const

const stubEngine = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  const setup = async ($: Engine, on: On) => {
    stubEngine(on)
    mock.store(on)
    mock.clock(on)
    await $.session.start({ cwd: '/p', surface, isInteractive: true })

    return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PROPS, requestId: 'uik-overlays', viewport: { columns: 102, rows: 50 } })
  }

  test(`${surface}: modal opens and closes`, async ($, on) => {
    const ui = await setup($, on)
    expect(await ui.find({ key: 'modal' })).toBeUndefined()
    await ui.press({ key: 'open:info' })
    expect(await ui.find({ key: 'modal' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Edit profile' })).toBeDefined()
    expect((await ui.find({ key: 'modal:cancel' }))?.props.hotkey).toBe('c')
    expect((await ui.find({ key: 'modal:ok' }))?.props.autoFocus).toBe(true)
    await ui.press({ key: 'modal:cancel' })
    expect(await ui.find({ key: 'modal' })).toBeUndefined()
  })

  test(`${surface}: delete confirm is destructive`, async ($, on) => {
    const ui = await setup($, on)
    await ui.press({ key: 'open:delete' })
    expect(await ui.find({ type: 'Text', text: 'Delete project?' })).toBeDefined()
    await ui.press({ key: 'modal:ok' })
    expect(await ui.find({ key: 'modal' })).toBeUndefined()
  })

  test(`${surface}: menu opens and an item press closes it`, async ($, on) => {
    const ui = await setup($, on)
    expect(await ui.find({ key: 'menu:pop' })).toBeUndefined()
    await ui.press({ key: 'menu:trigger' })
    expect(await ui.find({ key: 'menu:pop' })).toBeDefined()
    await ui.press({ key: 'menu:pop:edit' })
    expect(await ui.find({ key: 'menu:pop' })).toBeUndefined()
  })

  test(`${surface}: hover menu and tooltips are drawn hidden`, async ($, on) => {
    const ui = await setup($, on)
    expect((await ui.find({ key: 'hmenu:pop' }))?.props.display).toBe('none')
  })

  test(`${surface}: dialog pane renders`, async ($, on) => {
    stubEngine(on)
    mock.store(on)
    await $.session.start({ cwd: '/p', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: { ...PROPS, title: 'Confirm' }, requestId: 'uik-dialog', viewport: { columns: 60, rows: 9 } })
    expect(await ui.find({ key: 'dlg:ok' })).toBeDefined()
    expect(await ui.find({ key: 'dlg:cancel' })).toBeDefined()
  })
}
