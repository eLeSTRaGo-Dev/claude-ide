import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const props = {
  title: 'Web',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 34 },
  view: {},
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: Engine) =>
    $.ui.mount({ plugin: 'ui-kit', surface, component: 'Pane', props, requestId: 'uik-web', viewport: { columns: 100, rows: 34 } })

  test(`${surface}: draws the header (terminal) or a note and a Link (other surfaces)`, async $ => {
    const ui = await mount($)
    if (surface === 'terminal') {
      expect(await ui.find({ key: 'reload' })).toBeDefined()
      expect(await ui.find({ key: 'back' })).toBeDefined()
      expect(await ui.find({ key: 'path:raster' })).toBeDefined()
    } else {
      expect(await ui.find(surface === 'desktop' ? { type: 'Text', text: /demo\.html/ } : { type: 'Link' })).toBeDefined()
      expect(await ui.find({ key: 'reload' })).toBeUndefined()
    }
  })
}
