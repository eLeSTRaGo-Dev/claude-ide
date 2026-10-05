import type { Register } from 'claude-code'

import { register as registerCharts } from './charts'
import { register as registerHost } from './host'
import { register as registerMandel } from './mandel'
import { register as registerPlasma } from './plasma'

// One pane per demo, opened together as tabs by `/gfx`.
export const PANES = [
  { id: 'gfx-plasma', title: 'Plasma' },
  { id: 'gfx-charts', title: 'Charts' },
  { id: 'gfx-mandel', title: 'Mandelbrot' },
  { id: 'gfx-host', title: 'Host render' },
] as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gfx', description: 'Open the graphics gallery panes' })

    return next(e)
  })

  on('command.run', { command: 'gfx' }, async $ => {
    for (const pane of PANES) await $.ui.open({ id: pane.id, title: pane.title })
    await $.ui.open({ id: PANES[0].id, title: PANES[0].title, focus: true })

    return { text: 'Graphics gallery opened.' }
  })

  registerPlasma(on)
  registerCharts(on)
  registerMandel(on)
  registerHost(on)
}
