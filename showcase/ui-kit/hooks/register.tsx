import type { Register } from 'claude-code'

import { register as registerChrome } from './chrome'
import { register as registerComponents } from './components'
import { register as registerForms } from './forms'
import { register as registerOverlays } from './overlays'
import { register as registerWeb } from './web'
import { register as registerWidgets } from './widgets'

// One pane per demo, opened together as tabs by `/ui-kit`.
export const PANES = [
  { id: 'uik-components', title: 'Components' },
  { id: 'uik-forms', title: 'Forms' },
  { id: 'uik-overlays', title: 'Overlays' },
  { id: 'uik-widgets', title: 'Widgets' },
  { id: 'uik-chrome', title: 'Chrome' },
  { id: 'uik-web', title: 'Web' },
] as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ui-kit', description: 'Open the web-like UI kit showcase panes' })

    return next(e)
  })

  on('command.run', { command: 'ui-kit' }, async $ => {
    for (const pane of PANES) await $.ui.open({ id: pane.id, title: pane.title })
    await $.ui.open({ id: PANES[0].id, title: PANES[0].title, focus: true })

    return { text: 'UI kit opened.' }
  })

  registerComponents(on)
  registerForms(on)
  registerOverlays(on)
  registerWidgets(on)
  registerChrome(on)
  registerWeb(on)
}
