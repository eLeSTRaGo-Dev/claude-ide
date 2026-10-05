import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { LOG, NOW } from './fixtures'

const PLUGIN = 'gfx-gallery'
const ROOT = '/repo'

const fake = (on: On, calls: string[][], isRepo = true): void => {
  on('process.run', (_$, e) => {
    calls.push([...e.argv])

    return {
      value: {
        exitCode: isRepo ? 0 : 128,
        stdout: isRepo ? LOG : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: Engine) =>
    $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: {
        title: 'Charts',
        isFocused: true,
        bodyColumns: 100,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
      requestId: 'gfx-charts',
      viewport: { columns: 120, rows: 40 },
    })

  test(`${surface}: draws ${surface === 'terminal' ? 'three Rasters' : 'three Svgs'} from git log`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NOW })
    const calls: string[][] = []
    fake(on, calls)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mount($)

    const git = calls.find(c => c[0] === 'git')
    expect(git?.slice(0, 2)).toEqual(['git', 'log'])
    expect(git).toContain('--shortstat')
    const kind = surface === 'terminal' ? 'Raster' : 'Svg'
    const other = surface === 'terminal' ? 'Svg' : 'Raster'
    expect((await ui.findAll({ type: kind })).length).toBe(3)
    expect((await ui.findAll({ type: other })).length).toBe(0)
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
  })

  test(`${surface}: outside a repo a dim message, no charts`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NOW })
    fake(on, [], false)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mount($)

    expect(await ui.find({ type: 'Text', text: 'Not a git repository: nothing to chart.' })).toBeDefined()
    expect((await ui.findAll({ type: 'Raster' })).length + (await ui.findAll({ type: 'Svg' })).length).toBe(0)
  })
}

test('terminal: the heat map Raster is 7 rows, weeks fit the width', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  fake(on, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Charts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    requestId: 'gfx-charts',
    viewport: { columns: 60, rows: 40 },
  })
  const heat = await ui.find({ key: 'heat' })
  expect(heat?.props.rows).toBe(7)
  expect(heat?.props.columns).toBe(56) // (60 - 4) / 2 = 28 weeks x 2
})
