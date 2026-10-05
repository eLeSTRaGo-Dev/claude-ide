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

const result = (stdout: string, exitCode = 0, stderr = '') => ({
  value: {
    exitCode,
    stdout,
    stderr,
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
  head: { name: string } = { name: 'main' },
): void => {
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (!isRepo) return result('', 128)
    const sub = e.argv[1]
    if (sub === 'rev-parse') {
      if (e.argv.includes('--abbrev-ref')) return result(head.name + '\n')
      if (e.argv.includes('--short')) return result('abc1234\n')

      return result(CWD + '\n')
    }
    if (sub === 'for-each-ref') return result(BRANCHES)
    if (sub === 'fetch') return result('')
    if (sub === 'pull') return result('', 128, 'fatal: Not possible to fast-forward, aborting.\n')
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

for (const surface of ['terminal', 'desktop'] as const) {
  const bash = (command: string) => ({ tool: 'Bash', command }) as const

  test(`${surface}: status shows the branch, follows Bash, clears outside a repo`, async ($, on) => {
    mock.store(on)
    const head = { name: 'main' }
    fake(on, [], true, GRAPH, head)
    const statuses: unknown[] = []
    on('ui.status', (_$, e) => {
      statuses.push(e.text)

      return { value: undefined }
    })
    on('prompt.submit', (_$, e) => e)
    on('tool.call', () => ({ result: {}, text: '' }) as never)
    await $.session.start(start(surface))
    // the explorer owns session.start; the git view sets status on first prompt
    await $.prompt.submit({ text: 'hi' } as never)
    expect(statuses).toEqual(['⎇ main'])

    head.name = 'feature'
    await $.tool.call(bash('git switch feature'))
    expect(statuses).toEqual(['⎇ main', '⎇ feature'])

    await $.tool.call(bash('ls'))
    expect(statuses.length).toBe(2)

    head.name = 'HEAD'
    await $.tool.call(bash('git checkout abc'))
    expect(statuses[2]).toBe('⎇ abc1234')
  })

  test(`${surface}: status is cleared outside a repo`, async ($, on) => {
    mock.store(on)
    fake(on, [], false)
    const statuses: unknown[] = []
    on('ui.status', (_$, e) => {
      statuses.push(e.text)

      return { value: undefined }
    })
    on('prompt.submit', (_$, e) => e)
    await $.session.start(start(surface))
    await $.prompt.submit({ text: 'hi' } as never)

    expect(statuses).toEqual([undefined])
  })

  test(`${surface}: a Bash call re-runs git log on the next render`, async ($, on) => {
    mock.store(on)
    const calls: string[][] = []
    fake(on, calls)
    on('tool.call', () => ({ result: {}, text: '' }) as never)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: props(120),
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })
    const logs = () => calls.filter(a => a[1] === 'log').length
    expect(logs()).toBe(1)

    await $.tool.call(bash('git commit -m x'))
    await ui.find({ key: 'all' })
    expect(logs()).toBe(2)
  })

  test(`${surface}: hotkeys a and r are set; r reloads`, async ($, on) => {
    mock.store(on)
    const calls: string[][] = []
    fake(on, calls)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: props(120),
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })

    expect((await ui.find({ key: 'all' }))?.props.hotkey).toBe('a')
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    await ui.press({ key: 'branch:origin/main' })
    const before = calls.filter(a => a[1] === 'log').length
    await ui.press({ key: 'all' })
    expect(
      calls.filter(a => a[1] === 'log' && a.includes('--all')).length,
    ).toBeGreaterThan(0)
    await ui.press({ key: 'refresh' })
    expect(calls.filter(a => a[1] === 'log').length).toBeGreaterThan(before)
  })

  test(`${surface}: fetch and pull run git and report in a toast`, async ($, on) => {
    mock.store(on)
    const calls: string[][] = []
    const toasts: string[] = []
    fake(on, calls)
    on('ui.toast', (_$, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: props(120),
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })

    expect((await ui.find({ key: 'fetch' }))?.props.hotkey).toBe('f')
    expect((await ui.find({ key: 'pull' }))?.props.hotkey).toBe('p')
    await ui.press({ key: 'fetch' })
    expect(calls).toContainEqual(['git', 'fetch', '--all'])
    expect(toasts.at(-1)).toBe('git fetch: done')
    await ui.press({ key: 'pull' })
    expect(calls).toContainEqual(['git', 'pull', '--ff-only'])
    expect(toasts.at(-1)).toBe('git pull: failed: fatal: Not possible to fast-forward, aborting.')
  })
}

const many = Array.from({ length: 40 }, (_, i) =>
  `* \x1f${String(i).padStart(40, '0')}\x1f${String(i).padStart(7, '0')}\x1f\x1fa\x1f2026-01-01\x1fc${i}`,
).join('\n')

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: wheel scrolls graph and details, keys move the commit`, async ($, on) => {
    mock.store(on)
    fake(on, [], true, many)
    on('ui.focus', () => ({}))
    on('ui.scroll', () => ({}))
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: { ...props(160), scroll: { offset: 0, bodyRows: 14 } },
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })
    const commits = async () =>
      (await ui.findAll({ type: 'Button' }))
        .map(b => b.key ?? '')
        .filter(key => key.startsWith('commit:'))
    const scroll = (by: number, pointer?: { column: number; row: number }) =>
      $.ui.scroll({
        component: 'Pane',
        requestId: 'ide-git',
        plugin: PLUGIN,
        offset: 0,
        by,
        bodyRows: 14,
        contentRows: 14,
        origin: { kind: 'person' },
        ...(pointer === undefined ? {} : { pointer }),
      } as never)
    const first = (await commits())[0]
    expect(await ui.find({ type: 'Text', text: '┃', in: 'sb:graph' })).toBeDefined()

    // wide layout: columns 32-95 are the graph
    await scroll(6, { column: 60, row: 3 })
    const after = await commits()
    expect(after[0]).not.toBe(first)
    expect(after[0]).toBe('commit:' + String(6).padStart(40, '0'))

    // an arrow key selects the next commit
    await ui.press({ key: after[0] ?? '' })
    await scroll(1)
    const next = await ui.find({ key: 'commit:' + String(7).padStart(40, '0') })
    expect(next?.props.label).toMatch(/^>/)
  })

  test(`${surface}: wheel over the details scrolls the diff, valid hunks`, async ($, on) => {
    mock.store(on)
    fake(on, [], true, GRAPH)
    on('ui.focus', () => ({}))
    on('ui.scroll', () => ({}))
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: { ...props(160), scroll: { offset: 0, bodyRows: 14 } },
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })
    await ui.press({ key: 'commit:908022ab43fb9bc599342842219a42dfd653f899' })
    const before = (await ui.find({ type: 'Code' }))?.text ?? ''
    await $.ui.scroll({
      component: 'Pane',
      requestId: 'ide-git',
      plugin: PLUGIN,
      offset: 0,
      by: 6,
      bodyRows: 14,
      contentRows: 14,
      origin: { kind: 'person' },
      pointer: { column: 150, row: 3 },
    } as never)
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.text).not.toBe(before)
    expect(code?.text).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/)
  })
}
