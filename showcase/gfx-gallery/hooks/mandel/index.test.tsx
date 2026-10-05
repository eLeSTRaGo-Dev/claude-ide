import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { HOME } from './mandel'

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)) + 1e-9)

const PLUGIN = 'gfx-gallery'
const COLUMNS = 80
const ROWS = 24
const props = {
  title: 'Mandelbrot',
  isFocused: true,
  bodyColumns: COLUMNS,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

// Read back through the info line the pane draws: `c = <re> <+|-> <im>i   <scale>/col`.
const viewOf = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text?: string } | undefined> }) => {
  const text = (await ui.find({ type: 'Text', text: /^c = / }))?.text ?? ''
  const m = /c = (\S+) ([+-]) (\S+)i\s+(\S+)\/col/.exec(text)
  if (m === null) throw new Error('no info line: ' + text)

  return { cx: Number(m[1]), cy: Number(m[3]) * (m[2] === '-' ? -1 : 1), scale: Number(m[4]) }
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: Engine) =>
    $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props,
      requestId: 'gfx-mandel',
      viewport: { columns: COLUMNS, rows: 30 },
    })

  test(`${surface}: draws a Raster (terminal) or an Svg (desktop) with the pointer overlay`, async ($, on) => {
    const ui = await mount($)
    if (surface === 'terminal') expect(await ui.find({ type: 'Raster', key: 'mandel' })).toBeDefined()
    else expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Client', key: 'mandel-pointer' })).toBeDefined()
    expect(await ui.find({ key: 'zoom-in' })).toBeDefined()
  })

  test(`${surface}: left click zooms in at the pointer, right click out, reset restores`, async ($, on) => {
    const ui = await mount($)
    await ui.resize({ columns: COLUMNS, rows: ROWS - 6, in: 'mandel-pointer' })

    await ui.pointer({ type: 'down', x: 10, y: 4, button: 'left' })
    await ui.pointer({ type: 'up', x: 10, y: 4, button: 'left' })
    let s = await viewOf(ui)
    near(s.scale, HOME.scale / 2)
    // clicked left of the middle: the center moved left
    expect(s.cx).toBeLessThan(HOME.cx)

    await ui.pointer({ type: 'down', x: 10, y: 4, button: 'right' })
    await ui.pointer({ type: 'up', x: 10, y: 4, button: 'right' })
    s = await viewOf(ui)
    near(s.scale, HOME.scale)

    await ui.press({ key: 'zoom-in' })
    near((await viewOf(ui)).scale, HOME.scale / 2)
    await ui.press({ key: 'reset' })
    s = await viewOf(ui)
    near(s.scale, HOME.scale)
    near(s.cx, HOME.cx)
  })

  test(`${surface}: a drag pans the view`, async ($, on) => {
    const blits: string[] = []
    on('ui.blit', (_$, e) => {
      blits.push(e.key)

      return { value: {} }
    })
    const ui = await mount($)
    await ui.pointer({ type: 'down', x: 30, y: 5, button: 'left' })
    await ui.pointer({ type: 'move', x: 36, y: 5, button: 'left' })
    if (surface === 'terminal') expect(blits).toEqual(['mandel'])
    await ui.pointer({ type: 'up', x: 40, y: 5, button: 'left' })
    const s = await viewOf(ui)
    near(s.scale, HOME.scale)
    near(s.cx, HOME.cx - 10 * HOME.scale)
  })
}

test('terminal: encoder button cycles half, quad, braille', async ($, on) => {
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'Pane', props, requestId: 'gfx-mandel',
    viewport: { columns: COLUMNS, rows: 30 },
  })
  const label = async () => (await ui.find({ key: 'encoder' }))?.props.label
  expect(await label()).toContain('half')
  await ui.press({ key: 'encoder' })
  expect(await label()).toContain('quad')
  await ui.press({ key: 'encoder' })
  expect(await label()).toContain('braille')
})
