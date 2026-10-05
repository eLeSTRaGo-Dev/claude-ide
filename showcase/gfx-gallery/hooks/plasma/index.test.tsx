import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'gfx-gallery'
const PANE = 'gfx-plasma'
const PROPS = { title: 'Plasma', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 22 }, view: {} } as const

const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PROPS, requestId: PANE, viewport: { columns: 82, rows: 24 } })

// The engine's session.start and command.register, which the kit leaves unanswered.
const stubEngine = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: draws the effect surface`, async ($, on) => {
    stubEngine(on)
    mock.store(on)
    mock.clock(on)
    await $.session.start({ cwd: '/p', surface, isInteractive: true })
    const ui = await mount($, surface)
    if (surface === 'terminal') {
      const raster = await ui.find({ key: 'raster' })
      expect(raster?.props.columns).toBe(80)
      expect(raster?.props.rows).toBe(20)
      expect(await ui.find({ key: 'enc:braille' })).toBeDefined()
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(await ui.find({ key: 'enc:braille' })).toBeUndefined()
    }
    expect(await ui.find({ key: 'play' })).toBeDefined()
    expect(await ui.find({ key: 'effect:fire' })).toBeDefined()
  })

  test(`${surface}: play/pause toggles`, async ($, on) => {
    stubEngine(on)
    mock.store(on)
    mock.clock(on)
    await $.session.start({ cwd: '/p', surface, isInteractive: true })
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'play' }))?.props.label).toBe('pause (p)')
    expect((await ui.find({ key: 'play' }))?.props.hotkey).toBe('p')
    await ui.press({ key: 'play' })
    expect((await ui.find({ key: 'play' }))?.props.label).toBe('play (p)')
    await ui.press({ key: 'play' })
    expect((await ui.find({ key: 'play' }))?.props.label).toBe('pause (p)')
  })
}

test('terminal: effect switch redraws the Raster', async ($, on) => {
  stubEngine(on)
  mock.store(on)
  mock.clock(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const ui = await mount($, 'terminal')
  const before = (await ui.find({ key: 'raster' }))?.props.cells
  await ui.press({ key: 'effect:fire' })
  const after = (await ui.find({ key: 'raster' }))?.props.cells
  expect(after).not.toBe(before)
  await ui.press({ key: 'enc:braille' })
  expect((await ui.find({ key: 'raster' }))?.props.columns).toBe(80)
})

test('terminal: the loop blits while playing and stops when paused', async ($, on) => {
  stubEngine(on)
  mock.store(on)
  const clock = mock.clock(on)
  let blits = 0
  on('ui.blit', () => {
    blits += 1

    return { value: {} }
  })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const ui = await mount($, 'terminal')
  await clock.advance(330)
  expect(blits).toBeGreaterThanOrEqual(8)
  await ui.press({ key: 'play' })
  const seen = blits
  await clock.advance(500)
  expect(blits).toBe(seen)
})
