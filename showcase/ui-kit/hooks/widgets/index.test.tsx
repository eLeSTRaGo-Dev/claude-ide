import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'ui-kit'
const PROPS = { title: 'Widgets', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

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
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PROPS, requestId: 'uik-widgets', viewport: { columns: 112, rows: 40 } })
    // Client regions start at the size the viewport gives; lay each out at its drawn width.
    for (const [key, columns, rows] of [['volume', 32, 1], ['price', 35, 1], ['notify', 10, 1], ['qty', 15, 1], ['rating', 14, 1], ['color', 42, 4], ['period', 20, 1]] as const)
      await ui.resize({ columns, rows, in: key })

    return ui
  }
  // The values a Client was last given, as the hook passed them.
  const valsOf = async (ui: Awaited<ReturnType<typeof setup>>, key: string) =>
    ((await ui.find({ type: 'Client', key }))?.props.props as { vals: (number | boolean)[] }).vals
  const texts = async (ui: Awaited<ReturnType<typeof setup>>, key: string) =>
    (await ui.findAll({ type: 'Text', in: key })).map(t => t.text ?? '').join('')

  test(`${surface}: slider click and drag set the value, arrows step it`, async ($, on) => {
    const ui = await setup($, on)
    expect(await valsOf(ui, 'volume')).toEqual([40])
    // track of 28 cells: the last cell is 100, the first 0
    await ui.pointer({ type: 'down', x: 27, y: 0, button: 'left', in: 'volume' })
    expect(await valsOf(ui, 'volume')).toEqual([100])
    await ui.pointer({ type: 'move', x: 0, y: 0, button: 'left', in: 'volume' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'volume' })
    expect(await valsOf(ui, 'volume')).toEqual([0])
    await ui.key({ key: 'right', in: 'volume' })
    await ui.key({ key: 'right', shift: true, in: 'volume' })
    expect(await valsOf(ui, 'volume')).toEqual([11])
    expect(await texts(ui, 'volume')).toContain(' 11')
  })

  test(`${surface}: slider without fine.x uses the cell center`, async ($, on) => {
    // The kit's pointer act does not appear to forward `fine`, so only the cell-center path is asserted.
    const ui = await setup($, on)
    await ui.pointer({ type: 'down', x: 13, y: 0, button: 'left', in: 'volume' })
    await ui.pointer({ type: 'up', x: 13, y: 0, button: 'left', in: 'volume' })
    expect(await valsOf(ui, 'volume')).toEqual([48])
  })

  test(`${surface}: range slider moves the nearer thumb`, async ($, on) => {
    const ui = await setup($, on)
    expect(await valsOf(ui, 'price')).toEqual([25, 70])
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'price' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'price' })
    expect(await valsOf(ui, 'price')).toEqual([10, 70])
    await ui.pointer({ type: 'down', x: 27, y: 0, button: 'left', in: 'price' })
    await ui.pointer({ type: 'move', x: 2, y: 0, button: 'left', in: 'price' })
    await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left', in: 'price' })
    const [lo, hi] = await valsOf(ui, 'price')
    expect(lo).toBe(10)
    expect(hi as number).toBeGreaterThanOrEqual(lo as number)
    expect(hi as number).toBeLessThan(30)
  })

  test(`${surface}: toggle flips on click and space, sliding over ~150 ms`, async ($, on) => {
    const ui = await setup($, on)
    expect(await valsOf(ui, 'notify')).toEqual([false])
    await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'notify' })
    await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left', in: 'notify' })
    expect(await valsOf(ui, 'notify')).toEqual([true])
    expect(await texts(ui, 'notify')).toContain('●   ')
    await ui.advance(200)
    expect(await texts(ui, 'notify')).toContain('On')
    expect(await texts(ui, 'notify')).toContain('   ●')
    await ui.key({ key: ' ', in: 'notify' })
    expect(await valsOf(ui, 'notify')).toEqual([false])
  })

  test(`${surface}: stepper presses once and auto-repeats while held`, async ($, on) => {
    const ui = await setup($, on)
    await ui.pointer({ type: 'down', x: 12, y: 0, button: 'left', in: 'qty' })
    expect(await valsOf(ui, 'qty')).toEqual([4])
    await ui.advance(800)
    const held = (await valsOf(ui, 'qty'))[0] as number
    expect(held).toBeGreaterThan(4)
    await ui.pointer({ type: 'up', x: 12, y: 0, button: 'left', in: 'qty' })
    await ui.advance(800)
    expect((await valsOf(ui, 'qty'))[0]).toBe(held)
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'qty' })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'qty' })
    expect((await valsOf(ui, 'qty'))[0]).toBe(held - 1)
  })

  test(`${surface}: stars preview on hover, commit on click`, async ($, on) => {
    const ui = await setup($, on)
    await ui.pointer({ type: 'move', x: 6, y: 0, in: 'rating' })
    expect(await texts(ui, 'rating')).toContain('★ ★ ★ ★')
    expect(await valsOf(ui, 'rating')).toEqual([3])
    await ui.pointer({ type: 'leave', x: 6, y: 0, in: 'rating' })
    expect(await texts(ui, 'rating')).not.toContain('★ ★ ★ ★')
    await ui.pointer({ type: 'down', x: 8, y: 0, button: 'left', in: 'rating' })
    expect(await valsOf(ui, 'rating')).toEqual([5])
    await ui.key({ key: '2', in: 'rating' })
    expect(await valsOf(ui, 'rating')).toEqual([2])
  })

  test(`${surface}: color picker bars set h, s, v; hex follows`, async ($, on) => {
    const ui = await setup($, on)
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'color' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'color' })
    expect((await valsOf(ui, 'color'))[0]).toBe(0)
    await ui.pointer({ type: 'down', x: 35, y: 1, button: 'left', in: 'color' })
    await ui.pointer({ type: 'up', x: 35, y: 1, button: 'left', in: 'color' })
    await ui.pointer({ type: 'down', x: 35, y: 2, button: 'left', in: 'color' })
    await ui.pointer({ type: 'up', x: 35, y: 2, button: 'left', in: 'color' })
    expect(await valsOf(ui, 'color')).toEqual([0, 100, 100])
    expect(await texts(ui, 'color')).toContain('#ff0000')
    await ui.key({ key: 'up', in: 'color' }) // active bar: saturation (row 1)
    await ui.key({ key: 'left', in: 'color' })
    expect(await valsOf(ui, 'color')).toEqual([0, 95, 100])
  })

  test(`${surface}: segmented control: click and arrows`, async ($, on) => {
    const ui = await setup($, on)
    expect(await valsOf(ui, 'period')).toEqual([1])
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'period' })
    expect(await valsOf(ui, 'period')).toEqual([0])
    await ui.key({ key: 'right', in: 'period' })
    await ui.key({ key: 'right', in: 'period' })
    await ui.key({ key: 'right', in: 'period' })
    expect(await valsOf(ui, 'period')).toEqual([2])
    expect(await ui.find({ type: 'Text', text: 'Showing: Month' })).toBeDefined()
  })
}

for (const surface of ['vscode', 'mobile'] as const) {
  test(`${surface}: no Client, Buttons and Select instead`, async ($, on) => {
    stubEngine(on)
    mock.store(on)
    mock.clock(on)
    await $.session.start({ cwd: '/p', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PROPS, requestId: 'uik-widgets', viewport: { columns: 112, rows: 40 } })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.press({ key: 'volume:inc' })
    expect(await ui.find({ type: 'Text', text: '45' })).toBeDefined()
    await ui.press({ key: 'notify:btn' })
    expect((await ui.find({ key: 'notify:btn' }))?.props.label).toBe('Notifications: On')
    if (surface === 'vscode') await (ui as unknown as { select: (t: { key: string; value: string }) => Promise<unknown> }).select({ key: 'period:select', value: '2' })
    else await ui.press({ key: 'period:select' }) // mobile: no Select, the Button steps
    expect(await ui.find({ type: 'Text', text: 'Showing: Month' })).toBeDefined()
  })
}
