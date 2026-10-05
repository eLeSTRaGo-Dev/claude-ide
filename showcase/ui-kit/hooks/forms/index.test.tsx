import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'ui-kit'
const PROPS = { title: 'Forms', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

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

    return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PROPS, requestId: 'uik-forms', viewport: { columns: 112, rows: 40 } })
  }
  const text = async (ui: Awaited<ReturnType<typeof setup>>, s: string) => (await ui.find({ type: 'Text', text: s })) !== undefined

  test(`${surface}: invalid email then submit shows errors`, async ($, on) => {
    const ui = await setup($, on)
    await ui.input({ key: 'email', text: 'not-an-email', kind: 'change' })
    await ui.press({ key: 'submit' })
    expect(await text(ui, '✕ Enter a valid email address')).toBe(true)
    expect(await text(ui, '✕ Name is required')).toBe(true)
    expect(await text(ui, '✕ You must accept the terms')).toBe(true)
  })

  test(`${surface}: valid form shows success`, async ($, on) => {
    const ui = await setup($, on)
    await ui.input({ key: 'name', text: 'Ada', kind: 'change' })
    await ui.input({ key: 'email', text: 'ada@example.com', kind: 'change' })
    await ui.input({ key: 'password', text: 'Abcdef12!xyz', kind: 'change' })
    await ui.press({ key: 'terms' })
    await ui.press({ key: 'submit' })
    expect(await ui.find({ key: 'success' })).toBeDefined()
    expect(await ui.find({ key: 'failure' })).toBeUndefined()
  })

  test(`${surface}: reset clears`, async ($, on) => {
    const ui = await setup($, on)
    await ui.press({ key: 'submit' })
    expect(await ui.find({ key: 'failure' })).toBeDefined()
    await ui.press({ key: 'reset' })
    expect(await ui.find({ key: 'failure' })).toBeUndefined()
  })
}

test('mobile: read-only summary, no Input', async ($, on) => {
  stubEngine(on)
  mock.store(on)
  mock.clock(on)
  await $.session.start({ cwd: '/p', surface: 'mobile', isInteractive: true })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'mobile', component: 'Pane', props: PROPS, requestId: 'uik-forms', viewport: { columns: 60, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: 'This surface has no Input or Select: read-only summary.' })).toBeDefined()
})
