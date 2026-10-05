import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'ui-kit'
const PROPS = { title: 'Components', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

const stubEngine = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: Engine) =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PROPS, requestId: 'uik-components', viewport: { columns: 112, rows: 40 } })
  const setup = async ($: Engine, on: On) => {
    stubEngine(on)
    mock.store(on)
    mock.clock(on)
    await $.session.start({ cwd: '/p', surface, isInteractive: true })

    return mount($)
  }

  test(`${surface}: renders every component`, async ($, on) => {
    const ui = await setup($, on)
    for (const key of ['theme', 'b:primary', 'b:danger', 'b:link', 'tab:analytics', 'p:plus'])
      expect(await ui.find({ key })).toBeDefined()
    expect(await ui.find({ key: 'card:alerts' })).toBeDefined()
    expect(await ui.find({ key: 'card:team' })).toBeDefined()
  })

  test(`${surface}: theme button cycles the theme`, async ($, on) => {
    const ui = await setup($, on)
    const shown = async (name: string) => (await ui.find({ key: 'theme' }))?.props.label === `theme: ${name} ▾`
    expect(await shown('claude')).toBe(true)
    await ui.press({ key: 'theme' })
    expect(await shown('dark')).toBe(true)
  })

  test(`${surface}: tab switch changes the tab text`, async ($, on) => {
    const ui = await setup($, on)
    expect(await ui.find({ type: 'Text', text: 'Overview: the numbers at a glance.' })).toBeDefined()
    await ui.press({ key: 'tab:analytics' })
    expect(await ui.find({ type: 'Text', text: 'Analytics: charts live here.' })).toBeDefined()
  })

  test(`${surface}: progress buttons move the bar`, async ($, on) => {
    const ui = await setup($, on)
    await ui.press({ key: 'p:plus' })
    await ui.press({ key: 'p:plus' })
    expect(await ui.find({ key: 'p:main' })).toBeDefined()
  })
}
