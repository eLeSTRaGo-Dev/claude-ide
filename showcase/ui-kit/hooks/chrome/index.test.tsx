import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'ui-kit'
const PANE = 'uik-chrome'
const PROPS = { title: 'Chrome', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const mount = ($: Engine, surface: 'terminal' | 'desktop', columns = 90) =>
  $.ui.mount({
    plugin: PLUGIN, surface, component: 'Pane', props: { ...PROPS, bodyColumns: columns }, requestId: PANE,
    viewport: { columns: columns + 2, rows: 32 },
  })

const stubEngine = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: draws, and a press sets "last pressed"`, async ($, on) => {
    stubEngine(on)
    mock.store(on)
    await $.session.start({ cwd: '/p', surface, isInteractive: true })
    const ui = await mount($, surface)
    if (surface === 'terminal') {
      const raster = await ui.find({ type: 'Raster', key: 'chrome-bg' })
      expect(raster?.props.columns).toBe(90)
      expect(raster?.props.rows).toBe(25)
      expect((await ui.find({ key: 'primary' }))?.props.label).toBe(' Get started ')
      expect(await ui.find({ key: 'icon' })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(await ui.find({ key: 'primary' })).toBeDefined()
    }
    expect((await ui.find({ text: /last pressed/ , type: 'Text' }))?.text).toContain('nothing yet')
    await ui.press({ key: 'danger' })
    expect((await ui.find({ text: /last pressed/ , type: 'Text' }))?.text).toContain('Delete')
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ text: /last pressed/ , type: 'Text' }))?.text).toContain('toggle')
  })
}

test('terminal: pressing swaps the Raster to the pressed variant', async ($, on) => {
  stubEngine(on)
  mock.store(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const ui = await mount($, 'terminal')
  const before = (await ui.find({ key: 'chrome-bg' }))?.props.cells
  await ui.press({ key: 'primary' })
  const pressed = (await ui.find({ key: 'chrome-bg' }))?.props.cells
  expect(pressed).not.toBe(before)
  await ui.press({ key: 'secondary' })
  expect((await ui.find({ key: 'chrome-bg' }))?.props.cells).not.toBe(pressed)
})

test('terminal: the toggle flips its pill and label', async ($, on) => {
  stubEngine(on)
  mock.store(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const ui = await mount($, 'terminal')
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe(' ON')
  const before = (await ui.find({ key: 'chrome-bg' }))?.props.cells
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe(' OFF')
  expect((await ui.find({ key: 'chrome-bg' }))?.props.cells).not.toBe(before)
})

test('terminal: a narrow pane asks for width', async ($, on) => {
  stubEngine(on)
  mock.store(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const ui = await mount($, 'terminal', 40)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})
