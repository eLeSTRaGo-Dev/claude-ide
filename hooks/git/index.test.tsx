import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BRANCHES, GRAPH, PATCH, STAT } from './fixtures'

const CWD = '/repo'
const PLUGIN = 'ide-panes'
const VIEWPORT = { columns: 120, rows: 30 }
const props = (bodyColumns: number) =>
  ({
    title: 'Git',
    isFocused: true,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  }) as const

const result = (stdout: string, exitCode = 0) => ({
  value: {
    exitCode,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

// `isRepo` false answers every git call with exit 128.
const fake = (
  on: On,
  calls: string[][],
  isRepo = true,
  log = GRAPH,
): void => {
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (!isRepo) return result('', 128)
    const sub = e.argv[1]
    if (sub === 'rev-parse') return result(CWD + '\n')
    if (sub === 'for-each-ref') return result(BRANCHES)
    if (sub === 'log') return result(log)
    if (sub === 'show') {
      return result(e.argv.includes('--stat') ? STAT : PATCH)
    }

    return result('', 1)
  })
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

const start = (surface: 'terminal' | 'desktop') => ({
  cwd: CWD,
  surface,
  isInteractive: true,
})

for (const surface of ['terminal', 'desktop'] as const) {
  for (const columns of [100, 160]) {
    const mount = ($: Engine) =>
      $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        props: props(columns),
        requestId: 'ide-git',
        viewport: VIEWPORT,
      })

    test(`${surface}/${columns}: branches listed, current marked`, async ($, on) => {
      mock.store(on)
      fake(on, [])
      await $.session.start(start(surface))
      const ui = await mount($)

      const current = await ui.find({ key: 'branch:develop' })
      expect(current?.props.label).toContain('*')
      expect(await ui.find({ key: 'branch:origin/main' })).toBeDefined()
      expect(await ui.find({ key: 'branch:origin/HEAD' })).toBeUndefined()
      const remote = await ui.find({ key: 'branch:origin/main' })
      expect(remote?.props.dimColor).toBe(true)
    })

    test(`${surface}/${columns}: pressing a branch re-runs log with that ref`, async ($, on) => {
      mock.store(on)
      const calls: string[][] = []
      fake(on, calls)
      await $.session.start(start(surface))
      const ui = await mount($)

      expect(calls.some(a => a[1] === 'log' && a.includes('--all'))).toBe(true)
      await ui.press({ key: 'branch:origin/main' })
      expect(
        calls.some(a => a[1] === 'log' && a[a.length - 1] === 'origin/main'),
      ).toBe(true)
    })

    test(`${surface}/${columns}: pressing a commit shows its subject and a diff`, async ($, on) => {
      mock.store(on)
      fake(on, [])
      await $.session.start(start(surface))
      const ui = await mount($)

      await ui.press({ key: 'commit:908022ab43fb9bc599342842219a42dfd653f899' })
      expect(
        await ui.find({ type: 'Text', text: /oh-my-project v0.7.1/ }),
      ).toBeDefined()
      const code = await ui.find({ type: 'Code' })
      expect(code?.props.format).toBe('diff')
      expect(code?.text).toContain('diff --git')
    })

    test(`${surface}/${columns}: more raises the limit`, async ($, on) => {
      mock.store(on)
      const calls: string[][] = []
      // the fixture has 9 commits, below the page size: fake a full page
      const many = Array.from({ length: 200 }, (_, i) =>
        `* \x1f${String(i).padStart(40, '0')}\x1f${String(i).padStart(7, '0')}\x1f\x1fa\x1f2026-01-01\x1fc${i}`,
      ).join('\n')
      fake(on, calls, true, many)
      await $.session.start(start(surface))
      const ui = await mount($)

      await ui.press({ key: 'more' })
      expect(
        calls.some(a => a[1] === 'log' && a[a.indexOf('-n') + 1] === '400'),
      ).toBe(true)
    })
  }

  test(`${surface}: not a repo shows the message`, async ($, on) => {
    mock.store(on)
    fake(on, [], false)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: props(120),
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })

    expect(
      await ui.find({ type: 'Text', text: /Not a git repository/ }),
    ).toBeDefined()
  })
}
