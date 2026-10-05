import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { sliceCols } from '../shared/hscroll'
import { BRANCHES, LOG, MERGE_NAME_STATUS, MERGE_PATCH, MULTI_PATCH, NAME_STATUS, STAT } from './fixtures'

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

// untracked + staged add, modified, deleted
const STATUS = ['?? a.txt', ' M b.txt', ' D c.txt', ''].join('\0')

const MOD_DIFF =
  'diff --git a/b.txt b/b.txt\nindex 111..222 100644\n--- a/b.txt\n+++ b/b.txt\n@@ -1,2 +1,2 @@\n keep\n-old line\n+new line\n'
const NEW_DIFF =
  'diff --git a/a.txt b/a.txt\nnew file mode 100644\nindex 0000000..333\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+brand new\n'

const result = (stdout: string, exitCode = 0, stderr = '') => ({
  value: {
    exitCode,
    stdout,
    stderr,
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

// `isRepo` false answers every git call with exit 128; the first `rootFails`
// root lookups throw, as when the engine aborts a superseded render's call.
// `answer` may answer a call first (undefined: the defaults below).
const fake = (
  on: On,
  calls: string[][],
  isRepo = true,
  log = LOG,
  head: { name: string } = { name: 'main' },
  status = STATUS,
  rootFails = 0,
  answer: (argv: readonly string[]) => ReturnType<typeof result> | undefined = () => undefined,
): void => {
  let failsLeft = rootFails
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (!isRepo) return result('', 128)
    const answered = answer(e.argv)
    if (answered !== undefined) return answered
    if (failsLeft > 0 && e.argv.includes('--show-toplevel')) {
      failsLeft -= 1
      throw new Error('aborted')
    }
    const sub = e.argv[1] === '-c' ? e.argv[3] : e.argv[1]
    if (sub === 'rev-parse') {
      if (e.argv.includes('--abbrev-ref')) return result(head.name + '\n')
      if (e.argv.includes('--short')) return result('abc1234\n')

      return result(CWD + '\n')
    }
    if (sub === 'status') return result(status)
    if (sub === 'for-each-ref') return result(BRANCHES)
    if (sub === 'fetch') return result('')
    if (sub === 'pull') return result('', 128, 'fatal: Not possible to fast-forward, aborting.\n')
    if (sub === 'log') return result(log)
    if (sub === 'diff') {
      return e.argv.includes('--no-index')
        ? result(NEW_DIFF, 1)
        : result(e.argv.includes('c.txt') ? '' : MOD_DIFF)
    }
    if (sub === 'show') {
      const merge = (e.argv.at(-1) ?? '').startsWith('352e0cc')
      if (e.argv.includes('--name-status')) return result(merge ? MERGE_NAME_STATUS : NAME_STATUS)
      if (e.argv.includes('--stat')) return result(STAT)

      return result(merge ? MERGE_PATCH : MULTI_PATCH)
    }

    return result('', 1)
  })
  on('env.get', () => ({ value: '/home/u' }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: CWD }))
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

    test(`${surface}/${columns}: header lines: panel tabs, then actions`, async ($, on) => {
      mock.store(on)
      fake(on, [])
      await $.session.start(start(surface))
      const ui = await mount($)

      const boxes = await ui.findAll({ type: 'Box' })
      const lines = boxes.map(box => box.key ?? '').filter(key => key.startsWith('header:'))
      expect(lines).toEqual(['header:tabs', 'header:actions'])
      const keysOf = (key: string) =>
        ((boxes.find(box => box.key === key)?.children ?? []) as { props?: { key?: string }; key?: string }[])
          .map(child => child.key ?? child.props?.key)
          .filter(k => k !== undefined)
      expect(keysOf('header:tabs')).toEqual(['tab:overview', 'tab:graph', 'tab:changelog'])
      expect(keysOf('header:actions')).toEqual(['refresh', 'fetch', 'pull'])
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

    test(`${surface}/${columns}: sections are titled, footer shows dir and counts`, async ($, on) => {
      mock.store(on)
      fake(on, [])
      await $.session.start(start(surface))
      const ui = await mount($)

      expect((await ui.find({ key: 'title:branches' }))?.props.label).toBe(' Branches ')
      expect((await ui.find({ key: 'title:commits' }))?.props.label).toBe(' Commits ')
      expect((await ui.find({ key: 'title:info' }))?.props.label).toBe(' Info ')
      expect(await ui.find({ type: 'Text', text: '/repo (develop)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '+1 ~1 -1' })).toBeDefined()
      // the full path is not in the header any more
      expect(await ui.find({ type: 'Text', text: '/home/u' })).toBeUndefined()
    })

    test(`${surface}/${columns}: pressing a title copies its name`, async ($, on) => {
      mock.store(on)
      fake(on, [])
      const copied: string[] = []
      const toasts: string[] = []
      on('ui.copy', (_$, e) => {
        copied.push(e.text)

        return { value: { isCopied: true } }
      })
      on('ui.toast', (_$, e) => {
        toasts.push(e.text)

        return { value: undefined }
      })
      await $.session.start(start(surface))
      const ui = await mount($)

      await ui.press({ key: 'title:info' })
      expect(copied).toEqual(['Git › Info'])
      expect(toasts.at(-1)).toBe('Copied: Git › Info')
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

    test(`${surface}/${columns}: pressing a commit shows its info, no diff`, async ($, on) => {
      mock.store(on)
      fake(on, [])
      await $.session.start(start(surface))
      const ui = await mount($)

      await ui.press({ key: 'commit:908022ab43fb9bc599342842219a42dfd653f899' })
      expect(
        await ui.find({ type: 'Text', text: /oh-my-project v0.7.1/ }),
      ).toBeDefined()
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /eLeSTRaGo/ })).toBeDefined()
    })

    test(`${surface}/${columns}: each commit row draws a lane glyph before its button`, async ($, on) => {
      mock.store(on)
      fake(on, [])
      await $.session.start(start(surface))
      const ui = await mount($)

      const sha = '908022ab43fb9bc599342842219a42dfd653f899'
      const rows = await ui.findAll({ type: 'Box' })
      const row = rows.find(box => box.key === 'row:' + sha)
      expect(row).toBeDefined()
      const kids = (row?.children ?? []) as {
        type: string
        props?: { key?: string }
        children?: string[]
      }[]
      const glyph = kids.findIndex(
        kid => kid.type === 'Text' && (kid.children ?? []).join('').includes('●'),
      )
      const button = kids.findIndex(kid => kid.props?.key === 'commit:' + sha)
      expect(glyph).toBeGreaterThanOrEqual(0)
      expect(glyph).toBeLessThan(button)
      // the merge is drawn as ○, and one row exists per commit
      expect(await ui.find({ type: 'Text', text: /○/ })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('commit:')).length).toBe(9)
      // info head: author, date, parents
      await ui.press({ key: 'commit:' + sha })
      expect(await ui.find({ type: 'Text', text: /eLeSTRaGo/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^parents 06615e2/ })).toBeDefined()
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

  test(`${surface}: a real not-a-repo does not look again on its own`, async ($, on) => {
    mock.store(on)
    const clock = mock.clock(on)
    const calls: string[][] = []
    fake(on, calls, false)
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
    const lookups = () => calls.filter(a => a.includes('--show-toplevel')).length
    const seen = lookups()
    await clock.advance(5000)
    expect(lookups()).toBe(seen)
  })

  test(`${surface}: an aborted root lookup is not cached, a retry recovers`, async ($, on) => {
    mock.store(on)
    const clock = mock.clock(on)
    fake(on, [], true, LOG, { name: 'main' }, STATUS, 1)
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
    await clock.advance(1000)
    expect(
      await ui.find({ type: 'Text', text: /Not a git repository/ }),
    ).toBeUndefined()
    expect(await ui.find({ key: 'branch:develop' })).toBeDefined()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  const bash = (command: string) => ({ tool: 'Bash', command }) as const

  test(`${surface}: status shows the branch, follows Bash, clears outside a repo`, async ($, on) => {
    mock.store(on)
    const head = { name: 'main' }
    fake(on, [], true, LOG, head)
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

  test(`${surface}: a clean tree shows +0 ~0 -0; an Edit re-runs git status`, async ($, on) => {
    mock.store(on)
    const calls: string[][] = []
    fake(on, calls, true, LOG, { name: 'main' }, '')
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
    const statuses = () => calls.filter(a => a[1] === 'status').length
    expect(await ui.find({ type: 'Text', text: '+0 ~0 -0' })).toBeDefined()
    expect(statuses()).toBe(1)
    expect(calls.find(a => a[1] === 'status')).toEqual([
      'git',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ])

    await $.tool.call({ tool: 'Edit', file_path: '/repo/x', old_string: 'a', new_string: 'b' } as never)
    await ui.find({ key: 'all' })
    expect(statuses()).toBe(2)
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
  [
    String(i).padStart(40, '0'),
    String(i).padStart(7, '0'),
    String(i + 1).padStart(40, '0'),
    '',
    'a',
    '2026-01-01',
    `c${i}`,
  ].join('\x1f'),
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

  test(`${surface}: wheel over Info scrolls its lines, over Commits the list`, async ($, on) => {
    mock.store(on)
    fake(on, [], true, LOG)
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
    const subject = () => ui.find({ type: 'Text', text: /^908022ab43fb/ })
    expect(await subject()).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    const scroll = (by: number, pointer: { column: number; row: number }) =>
      $.ui.scroll({
        component: 'Pane',
        requestId: 'ide-git',
        plugin: PLUGIN,
        offset: 0,
        by,
        bodyRows: 14,
        contentRows: 14,
        origin: { kind: 'person' },
        pointer,
      } as never)
    // bodyRows 14: Commits rows 2-8, Info below; Info is the right column
    await scroll(1, { column: 150, row: 3 })
    expect(await subject()).toBeDefined()
    await scroll(1, { column: 150, row: 12 })
    expect(await subject()).toBeUndefined()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  for (const columns of [100, 160]) {
    const open = async ($: Engine, on: On, calls: string[][] = [], status = STATUS) => {
      mock.store(on)
      fake(on, calls, true, LOG, { name: 'main' }, status)
      on('ui.focus', () => ({}))
      on('ui.scroll', () => ({}))
      await $.session.start(start(surface))

      return $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        props: props(columns),
        requestId: 'ide-git',
        viewport: VIEWPORT,
      })
    }
    const keys = async (ui: Awaited<ReturnType<typeof open>>, prefix: string) =>
      (await ui.findAll({ type: 'Button' }))
        .map(b => b.key ?? '')
        .filter(key => key.startsWith(prefix))

    test(`${surface}/${columns}: tabs switch the panel between Overview, Graph and Change Log`, async ($, on) => {
      const ui = await open($, on)

      expect((await ui.find({ key: 'tab:overview' }))?.props.hotkey).toBe('o')
      expect((await ui.find({ key: 'tab:graph' }))?.props.hotkey).toBe('g')
      expect((await ui.find({ key: 'tab:changelog' }))?.props.hotkey).toBe('c')
      expect((await ui.find({ key: 'tab:changelog' }))?.props.label).toContain('Change Log 3')
      expect((await ui.find({ key: 'tab:overview' }))?.props.label).toMatch(/^▌/)
      // Overview: Branches, Commits, Info; no Files
      expect((await ui.find({ key: 'title:branches' }))?.props.label).toBe(' Branches ')
      expect((await ui.find({ key: 'title:commits' }))?.props.label).toBe(' Commits ')
      expect((await ui.find({ key: 'title:info' }))?.props.label).toBe(' Info ')
      expect(await ui.find({ key: 'title:files' })).toBeUndefined()
      expect(await ui.find({ key: 'change:b.txt' })).toBeUndefined()

      await ui.press({ key: 'tab:changelog' })
      expect((await ui.find({ key: 'tab:changelog' }))?.props.label).toMatch(/^▌/)
      expect((await ui.find({ key: 'title:files' }))?.props.label).toBe(' Files ')
      expect((await ui.find({ key: 'title:diff' }))?.props.label).toBe(' Diff Preview ')
      expect(await ui.find({ key: 'title:branches' })).toBeUndefined()
      expect(await ui.find({ key: 'title:commits' })).toBeUndefined()
      expect(await keys(ui, 'change:')).toEqual(['change:a.txt', 'change:b.txt', 'change:c.txt'])
      expect(await keys(ui, 'commit:')).toEqual([])

      await ui.press({ key: 'tab:graph' })
      expect((await ui.find({ key: 'title:graph' }))?.props.label).toBe(' Graph ')
      expect(await ui.find({ key: 'title:commits' })).toBeUndefined()
      expect(await ui.find({ key: 'title:info' })).toBeUndefined()
      expect(await ui.find({ key: 'title:branches' })).toBeUndefined()
      expect((await keys(ui, 'commit:')).length).toBeGreaterThan(0)

      await ui.press({ key: 'tab:overview' })
      expect((await ui.find({ key: 'title:info' }))?.props.label).toBe(' Info ')
    })

    test(`${surface}/${columns}: an old persisted tab 'changes' opens Change Log`, async ($, on) => {
      mock.store(on)
      fake(on, [], true, LOG, { name: 'main' }, STATUS)
      on('ui.focus', () => ({}))
      on('ui.scroll', () => ({}))
      // the value a previous version persisted
      on('state.get', (_$, e) =>
        e.key === 'git'
          ? {
              value: {
                value: { ref: 'all', offset: 0, limit: 200, branchOffset: 0, detailOffset: 0, tab: 'changes' },
                version: 1,
              },
            }
          : { value: { value: undefined, version: 0 } },
      )
      await $.session.start(start(surface))
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        props: props(columns),
        requestId: 'ide-git',
        viewport: VIEWPORT,
      })

      expect((await ui.find({ key: 'title:files' }))?.props.label).toBe(' Files ')
      expect((await ui.find({ key: 'tab:changelog' }))?.props.label).toMatch(/^▌/)
    })

    test(`${surface}/${columns}: a change shows its diff; untracked uses --no-index`, async ($, on) => {
      const calls: string[][] = []
      const ui = await open($, on, calls)
      await ui.press({ key: 'tab:changelog' })

      // the first file (untracked) is selected: diffed against /dev/null, exit 1 accepted
      let code = await ui.find({ type: 'Code' })
      expect(code?.props.format).toBe('diff')
      expect(code?.text).toContain('+brand new')
      expect(calls).toContainEqual([
        'git', 'diff', '--no-index', '--color=never', '--', '/dev/null', 'a.txt',
      ])
      expect(await ui.find({ type: 'Text', text: 'untracked' })).toBeDefined()

      await ui.press({ key: 'change:b.txt' })
      code = await ui.find({ type: 'Code' })
      expect(code?.text).toContain('+new line')
      expect(await ui.find({ type: 'Text', text: 'modified' })).toBeDefined()
      expect(calls).toContainEqual([
        'git', 'diff', 'HEAD', '--color=never', '-M', '--', 'b.txt',
      ])

      // empty diff: a dim note, no Code
      await ui.press({ key: 'change:c.txt' })
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'No textual changes.' })).toBeDefined()
    })

    test(`${surface}/${columns}: view toggles list and tree; folders collapse`, async ($, on) => {
      const ui = await open($, on, [], ['?? src/a.ts', ' M src/ui/b.ts', ' M top.txt', ''].join('\0'))
      await ui.press({ key: 'tab:changelog' })

      expect((await ui.find({ key: 'view' }))?.props.hotkey).toBe('v')
      expect(await keys(ui, 'cdir:')).toEqual([])
      expect(await ui.find({ type: 'Text', text: 'src/' })).toBeDefined()
      await ui.press({ key: 'view' })
      expect(await keys(ui, 'cdir:')).toEqual(['cdir:c:src', 'cdir:c:src/ui'])
      expect(await keys(ui, 'change:')).toEqual([
        'change:top.txt',
        'change:src/a.ts',
        'change:src/ui/b.ts',
      ])
      await ui.press({ key: 'cdir:c:src' })
      expect(await keys(ui, 'change:')).toEqual(['change:top.txt'])
      await ui.press({ key: 'cdir:c:src' })
      expect((await keys(ui, 'change:')).length).toBe(3)
      await ui.press({ key: 'view' })
      expect(await keys(ui, 'cdir:')).toEqual([])
    })

    test(`${surface}/${columns}: clean tree says so`, async ($, on) => {
      const ui = await open($, on, [], '')
      await ui.press({ key: 'tab:changelog' })

      expect(await ui.find({ type: 'Text', text: 'Working tree clean' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Select a change.' })).toBeDefined()
    })

    test(`${surface}/${columns}: arrows move the selected change, wheel and scrollbar scroll`, async ($, on) => {
      const status = Array.from({ length: 40 }, (_, i) => ` M f${String(i).padStart(2, '0')}.txt`)
      const ui = await open($, on, [], [...status, ''].join('\0'))
      await ui.press({ key: 'tab:changelog' })
      const scroll = (by: number, pointer?: { column: number; row: number }) =>
        $.ui.scroll({
          component: 'Pane',
          requestId: 'ide-git',
          plugin: PLUGIN,
          offset: 0,
          by,
          bodyRows: 30,
          contentRows: 30,
          origin: { kind: 'person' },
          ...(pointer === undefined ? {} : { pointer }),
        } as never)

      expect((await keys(ui, 'change:'))[0]).toBe('change:f00.txt')
      expect(await ui.find({ key: 'sb:changes' })).toBeDefined()
      await scroll(1)
      expect((await ui.find({ type: 'Text', text: 'f01.txt' }))).toBeDefined()
      const info = await ui.find({ type: 'Text', text: 'f01.txt' })
      expect(info).toBeDefined()
      // wheel over Files moves the window, not the selection
      await scroll(5, { column: 10, row: 3 })
      expect((await keys(ui, 'change:'))[0]).toBe('change:f05.txt')
    })
  }
}

for (const surface of ['terminal', 'desktop'] as const) {
  for (const columns of [100, 160]) {
    test(`${surface}/${columns}: Graph shows author and date, and shares the selection with Overview`, async ($, on) => {
      mock.store(on)
      fake(on, [], true, LOG, { name: 'main' }, STATUS)
      on('ui.focus', () => ({}))
      on('ui.scroll', () => ({}))
      await $.session.start(start(surface))
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        props: props(columns),
        requestId: 'ide-git',
        viewport: VIEWPORT,
      })
      const sha = '908022ab43fb9bc599342842219a42dfd653f899'

      // Overview's compact list has neither column
      expect(await ui.find({ type: 'Text', text: /2026-07-09/ })).toBeUndefined()
      await ui.press({ key: 'tab:graph' })
      expect((await ui.find({ type: 'Text', text: / eLeSTRaGo/ }))).toBeDefined()
      expect((await ui.find({ type: 'Text', text: / 2026-07-08/ }))).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /2026-07-09/ })).toBeDefined()

      await ui.press({ key: 'commit:' + sha })
      expect((await ui.find({ key: 'commit:' + sha }))?.props.label).toMatch(/^>/)
      await ui.press({ key: 'tab:overview' })
      expect((await ui.find({ key: 'commit:' + sha }))?.props.label).toMatch(/^>/)
      expect(await ui.find({ type: 'Text', text: /^parents 06615e2/ })).toBeDefined()
    })
  }
}

const HEAD_SHA = '908022ab43fb9bc599342842219a42dfd653f899'
const MERGE_SHA = '352e0ccfcf8783cb444ee15822e54c65deb6da05'

for (const surface of ['terminal', 'desktop'] as const) {
  for (const columns of [100, 160]) {
    const open = async ($: Engine, on: On, calls: string[][] = []) => {
      mock.store(on)
      fake(on, calls, true, LOG, { name: 'main' }, STATUS)
      on('ui.focus', () => ({}))
      on('ui.scroll', () => ({}))
      await $.session.start(start(surface))

      return $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        props: props(columns),
        requestId: 'ide-git',
        viewport: VIEWPORT,
      })
    }
    const keys = async (ui: Awaited<ReturnType<typeof open>>, prefix: string) =>
      (await ui.findAll({ type: 'Button' }))
        .map(b => b.key ?? '')
        .filter(key => key.startsWith(prefix))

    test(`${surface}/${columns}: every commit row has a diff button, the selected one holds d`, async ($, on) => {
      const ui = await open($, on)

      for (const tab of ['tab:overview', 'tab:graph']) {
        await ui.press({ key: tab })
        expect((await keys(ui, 'diff:')).length).toBe(9)
        expect((await ui.find({ key: 'diff:' + HEAD_SHA }))?.props.label).toContain('⧉')
        await ui.press({ key: 'commit:' + HEAD_SHA })
        const moved = (await ui.findAll({ type: 'Button' })).filter(b => b.props.hotkey === 'd')
        expect(moved.map(b => b.key)).toEqual(['diff:' + HEAD_SHA])
      }
    })

    test(`${surface}/${columns}: a diff button opens Files | Diff Preview for that commit; a file shows only its hunks`, async ($, on) => {
      const calls: string[][] = []
      const ui = await open($, on, calls)

      await ui.press({ key: 'diff:' + HEAD_SHA })
      expect(calls).toContainEqual([
        'git', '-c', 'core.quotePath=false', 'show', '--name-status', '-M', '--diff-merges=first-parent', '--format=', HEAD_SHA,
      ])
      expect(calls.some(a => a.includes('show') && a.includes('--patch') && a.includes('--diff-merges=first-parent'))).toBe(true)
      expect((await ui.find({ key: 'title:files' }))?.props.label).toMatch(/^ Files · 9/)
      expect((await ui.find({ key: 'title:diff' }))?.props.label).toBe(' Diff Preview ')
      expect(await ui.find({ key: 'title:branches' })).toBeUndefined()
      expect(await ui.find({ key: 'title:commits' })).toBeUndefined()
      expect(await keys(ui, 'commit:')).toEqual([])
      expect(await keys(ui, 'dfile:')).toEqual([
        'dfile:CHANGELOG.md',
        'dfile:docs/read me.md',
        'dfile:old.txt',
        'dfile:plugin/package.json',
        'dfile:src/b.ts',
      ])
      expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('b')
      // the first file is shown
      let code = await ui.find({ type: 'Code' })
      expect(code?.text).toContain('+changelog line')
      expect(code?.text).not.toContain('0.7.1')

      await ui.press({ key: 'dfile:plugin/package.json' })
      code = await ui.find({ type: 'Code' })
      expect(code?.text).toContain('0.7.1')
      expect(code?.text).not.toContain('changelog line')

      await ui.press({ key: 'dfile:docs/read me.md' })
      expect((await ui.find({ type: 'Code' }))?.text).toContain('+spaced path')
      // the patch was fetched once
      expect(calls.filter(a => a.includes('show') && a.includes('--patch')).length).toBe(1)
    })

    test(`${surface}/${columns}: a merge commit lists its first-parent files`, async ($, on) => {
      const calls: string[][] = []
      const ui = await open($, on, calls)

      await ui.press({ key: 'diff:' + MERGE_SHA })
      expect(await keys(ui, 'dfile:')).toEqual(['dfile:from-develop.txt'])
      expect((await ui.find({ type: 'Code' }))?.text).toContain('+merged in')
      expect(calls.filter(a => a.includes('show') && a.includes('--diff-merges=first-parent')).length).toBe(2)
    })

    test(`${surface}/${columns}: back returns to the tab it came from, selection kept`, async ($, on) => {
      const ui = await open($, on)

      await ui.press({ key: 'tab:graph' })
      await ui.press({ key: 'diff:' + HEAD_SHA })
      expect(await ui.find({ key: 'title:graph' })).toBeUndefined()
      await ui.press({ key: 'back' })
      expect(await ui.find({ key: 'back' })).toBeUndefined()
      expect((await ui.find({ key: 'title:graph' }))?.props.label).toBe(' Graph ')
      expect((await ui.find({ key: 'commit:' + HEAD_SHA }))?.props.label).toMatch(/^>/)
      expect(await keys(ui, 'dfile:')).toEqual([])

      // from Overview, and a tab press closes the view too
      await ui.press({ key: 'tab:overview' })
      await ui.press({ key: 'diff:' + MERGE_SHA })
      expect(await keys(ui, 'dfile:')).toEqual(['dfile:from-develop.txt'])
      await ui.press({ key: 'back' })
      expect((await ui.find({ key: 'title:info' }))?.props.label).toBe(' Info ')
      expect((await ui.find({ key: 'commit:' + MERGE_SHA }))?.props.label).toMatch(/^>/)
      await ui.press({ key: 'diff:' + MERGE_SHA })
      await ui.press({ key: 'tab:graph' })
      expect(await ui.find({ key: 'back' })).toBeUndefined()
      expect((await ui.find({ key: 'title:graph' }))?.props.label).toBe(' Graph ')
    })

    test(`${surface}/${columns}: in the diff view the view button toggles a tree, arrows move the file`, async ($, on) => {
      const ui = await open($, on)
      await ui.press({ key: 'diff:' + HEAD_SHA })

      await ui.press({ key: 'view' })
      expect(await keys(ui, 'cdir:')).toEqual(['cdir:c:docs', 'cdir:c:plugin', 'cdir:c:src'])
      await ui.press({ key: 'view' })
      const scroll = (by: number) =>
        $.ui.scroll({
          component: 'Pane',
          requestId: 'ide-git',
          plugin: PLUGIN,
          offset: 0,
          by,
          bodyRows: 30,
          contentRows: 30,
          origin: { kind: 'person' },
        } as never)
      await scroll(1)
      expect((await ui.find({ type: 'Code' }))?.text).toContain('+spaced path')
    })
  }
}

// `$.store` from a Map the test reads back.
const memoryStore = (on: On, store: Map<string, unknown>) => {
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  const open = async ($: Engine, on: On, columns: number, bodyRows: number, store?: Map<string, unknown>) => {
    if (store === undefined) mock.store(on)
    else memoryStore(on, store)
    fake(on, [], true, LOG, { name: 'main' }, STATUS)
    on('ui.focus', () => ({}))
    on('ui.scroll', () => ({}))
    await $.session.start(start(surface))

    return $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: { ...props(columns), scroll: { offset: 0, bodyRows } },
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })
  }
  const cellsOf = async (ui: Awaited<ReturnType<typeof open>>, key: string) => {
    const props = (await ui.find({ key }))?.props.props as { cells?: number } | undefined

    return props?.cells
  }
  const scrollAt = ($: Engine, bodyRows: number, by: number, column: number, row: number) =>
    $.ui.scroll({
      component: 'Pane',
      requestId: 'ide-git',
      plugin: PLUGIN,
      offset: 0,
      by,
      bodyRows,
      contentRows: bodyRows,
      origin: { kind: 'person' },
      pointer: { column, row },
    } as never)

  test(`${surface}: switching Overview/Graph keeps the selected commit in view and holding d`, async ($, on) => {
    const ui = await open($, on, 160, 14)
    const keys = async () =>
      (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('commit:'))
    const all = await keys()
    await scrollAt($, 14, 20, 60, 3)
    const last = (await keys()).at(-1) ?? ''
    expect(all.includes(last)).toBe(false)
    await ui.press({ key: last })
    for (const tab of ['tab:graph', 'tab:overview']) {
      await ui.press({ key: tab })
      const held = (await ui.findAll({ type: 'Button' })).filter(b => b.props.hotkey === 'd')
      expect(held.map(b => b.key)).toEqual(['diff:' + last.slice('commit:'.length)])
    }
  })

  test(`${surface}: dragging the Branches seam widens Branches and wheel routing follows`, async ($, on) => {
    const ui = await open($, on, 160, 14)
    const commits = async () =>
      (await ui.findAll({ type: 'Button' }))
        .map(b => b.key ?? '')
        .filter(key => key.startsWith('commit:'))
    expect(await cellsOf(ui, 'split:side')).toBe(32)

    await ui.pointer({ type: 'down', button: 'left', x: 0, y: 5, in: 'split:side' })
    await ui.pointer({ type: 'move', button: 'left', x: 10, y: 5, in: 'split:side' })
    expect(await cellsOf(ui, 'split:side')).toBe(42)
    // the seam moved under the pointer: the same pointer now reads 0 again
    await ui.pointer({ type: 'move', button: 'left', x: 0, y: 5, in: 'split:side' })
    expect(await cellsOf(ui, 'split:side')).toBe(42)
    await ui.pointer({ type: 'up', button: 'left', x: 0, y: 5, in: 'split:side' })
    expect(await cellsOf(ui, 'split:side')).toBe(42)

    // column 40 was Commits, now Branches: the wheel no longer moves the list
    const first = (await commits())[0]
    await scrollAt($, 14, 6, 40, 3)
    expect((await commits())[0]).toBe(first)
    await scrollAt($, 14, 6, 60, 3)
    expect((await commits())[0]).not.toBe(first)

    // a drag far left stops at the minimum
    await ui.pointer({ type: 'down', button: 'left', x: 0, y: 5, in: 'split:side' })
    await ui.pointer({ type: 'move', button: 'left', x: -100, y: 5, in: 'split:side' })
    expect(await cellsOf(ui, 'split:side')).toBe(12)
    await ui.pointer({ type: 'up', button: 'left', x: 0, y: 5, in: 'split:side' })
  })

  test(`${surface}: a stored layout:git sizes Branches; a drag's release writes it`, async ($, on) => {
    const store = new Map<string, unknown>([['layout:git', { side: 0.4, files: 0.5 }]])
    const ui = await open($, on, 160, 14, store)
    // 40% of 160 body columns
    expect(await cellsOf(ui, 'split:side')).toBe(64)

    await ui.pointer({ type: 'down', button: 'left', x: 0, y: 5, in: 'split:side' })
    await ui.pointer({ type: 'move', button: 'left', x: -10, y: 5, in: 'split:side' })
    expect(await cellsOf(ui, 'split:side')).toBe(54)
    // mid-drag moves don't write
    expect(store.get('layout:git')).toEqual({ side: 0.4, files: 0.5 })
    await ui.pointer({ type: 'up', button: 'left', x: 0, y: 5, in: 'split:side' })
    const saved = store.get('layout:git') as { side?: number; info?: number; files?: number }
    expect(Math.round((saved.side ?? 0) * 160)).toBe(54)
    expect(saved.info).toBeUndefined()
    // the stored Files width rides along
    expect(saved.files).toBe(0.5)
  })

  for (const value of ['x', { side: 7, info: -1, files: 'a' }])
    test(`${surface}: a garbage layout:git (${JSON.stringify(value)}) falls back to the default`, async ($, on) => {
      const ui = await open($, on, 160, 14, new Map<string, unknown>([['layout:git', value]]))
      expect(await cellsOf(ui, 'split:side')).toBe(32)
    })

  test(`${surface}: dragging the Commits/Info seam moves the Info boundary`, async ($, on) => {
    const ui = await open($, on, 160, 30)
    const before = (await cellsOf(ui, 'split:info')) ?? 0
    expect(before).toBe(Math.floor(28 * 0.6))

    await ui.pointer({ type: 'down', button: 'left', x: 3, y: 0, in: 'split:info' })
    await ui.pointer({ type: 'move', button: 'left', x: 3, y: 4, in: 'split:info' })
    await ui.pointer({ type: 'up', button: 'left', x: 3, y: 0, in: 'split:info' })
    expect(await cellsOf(ui, 'split:info')).toBe(before + 4)
  })

  test(`${surface}: the Branches seam takes a grab on Commits' border too`, async ($, on) => {
    const ui = await open($, on, 160, 14)
    const seam = await ui.find({ key: 'split:side' })
    expect(seam?.props.width).toBe(2)
    expect((seam?.props.props as { span?: number } | undefined)?.span).toBe(2)
    expect(await cellsOf(ui, 'split:side')).toBe(32)

    await ui.pointer({ type: 'down', button: 'left', x: 1, y: 5, in: 'split:side' })
    await ui.pointer({ type: 'move', button: 'left', x: 11, y: 5, in: 'split:side' })
    expect(await cellsOf(ui, 'split:side')).toBe(42)
    await ui.pointer({ type: 'up', button: 'left', x: 1, y: 5, in: 'split:side' })
    expect(await cellsOf(ui, 'split:side')).toBe(42)
  })

  test(`${surface}: the Branches seam keeps Commits' and Info's left corners`, async ($, on) => {
    const ui = await open($, on, 160, 14)
    const topRows = (await cellsOf(ui, 'split:info')) ?? 0
    const marks = ((await ui.find({ key: 'split:side' }))?.props.props as { marks?: unknown } | undefined)?.marks
    expect(marks).toEqual([
      { row: topRows - 2, text: '╰' },
      { row: topRows - 1, text: '╭' },
    ])
    // one outer Text per seam row; a marked row nests its corner Text
    const rows = (await ui.findAll({ type: 'Text', in: 'split:side' }))
      .map(text => text.text)
      .filter(text => text.length === 2)
    expect(rows[topRows - 3]).toBe('││')
    expect(rows[topRows - 2]).toBe('│╰')
    expect(rows[topRows - 1]).toBe('│╭')
    expect(rows[topRows]).toBe('││')
    // held, the corners stay
    await ui.pointer({ type: 'down', button: 'left', x: 0, y: 1, in: 'split:side' })
    const held = (await ui.findAll({ type: 'Text', in: 'split:side' })).map(text => text.text)
    expect(held).toContain('│╰')
    expect(held).toContain('│╭')
    await ui.pointer({ type: 'up', button: 'left', x: 0, y: 1, in: 'split:side' })
  })

  test(`${surface}: the Commits/Info seam takes a grab on Info's border too`, async ($, on) => {
    const ui = await open($, on, 160, 40)
    const seam = await ui.find({ key: 'split:info' })
    expect(seam?.props.height).toBe(2)
    const before = (await cellsOf(ui, 'split:info')) ?? 0

    await ui.pointer({ type: 'down', button: 'left', x: 3, y: 1, in: 'split:info' })
    await ui.pointer({ type: 'move', button: 'left', x: 3, y: 11, in: 'split:info' })
    // the seam moved under the pointer: the same spot reads y 1 again
    await ui.pointer({ type: 'up', button: 'left', x: 3, y: 1, in: 'split:info' })
    expect(await cellsOf(ui, 'split:info')).toBe(before + 10)
    // Info keeps its title over the seam
    expect(await ui.find({ key: 'title:info' })).toBeDefined()
  })

  test(`${surface}: dragging the Files seam resizes Files in Change Log`, async ($, on) => {
    const ui = await open($, on, 100, 30)
    await ui.press({ key: 'tab:changelog' })
    expect(await cellsOf(ui, 'split:files')).toBe(30)
    await ui.pointer({ type: 'down', button: 'left', x: 0, y: 3, in: 'split:files' })
    await ui.pointer({ type: 'move', button: 'left', x: -8, y: 3, in: 'split:files' })
    await ui.pointer({ type: 'up', button: 'left', x: 0, y: 3, in: 'split:files' })
    expect(await cellsOf(ui, 'split:files')).toBe(22)
  })
}

// Horizontal bars: a line wider than Info or Diff Preview draws one on the
// section's bottom border; a drag moves the first column shown.
// 300 columns, column 5k starting `w<k>`, so a slice shows where it starts.
const WIDE_LINE = Array.from({ length: 60 }, (_, i) => ('w' + i).padEnd(5, '.')).join('')
const WIDE_STAT = STAT.replace('oh-my-project v0.7.1', WIDE_LINE)
const WIDE_DIFF =
  'diff --git a/b.txt b/b.txt\nindex 111..222 100644\n--- a/b.txt\n+++ b/b.txt\n' +
  '@@ -1,2 +1,2 @@\n keep\n-old line\n+' + WIDE_LINE + '\n' +
  '@@ -40,2 +40,2 @@\n tail\n-gone\n+came\n'
const WIDE_PATCH =
  'diff --git a/CHANGELOG.md b/CHANGELOG.md\nindex 2ab3741..af8640a 100644\n--- a/CHANGELOG.md\n+++ b/CHANGELOG.md\n' +
  '@@ -1 +1,2 @@\n keep\n+' + WIDE_LINE + '\n'

const wide = (argv: readonly string[]) => {
  const sub = argv[1] === '-c' ? argv[3] : argv[1]
  if (sub === 'show' && argv.includes('--stat')) return result(WIDE_STAT)
  if (sub === 'show' && !argv.includes('--name-status') && !(argv.at(-1) ?? '').startsWith('352e0cc')) {
    return result(WIDE_PATCH)
  }
  if (sub === 'diff' && argv.includes('b.txt')) return result(WIDE_DIFF)

  return undefined
}

for (const surface of ['terminal', 'desktop'] as const) {
  const open = async ($: Engine, on: On, isWide = true) => {
    mock.store(on)
    fake(on, [], true, LOG, { name: 'main' }, STATUS, 0, isWide ? wide : undefined)
    on('ui.focus', () => ({}))
    on('ui.scroll', () => ({}))
    await $.session.start(start(surface))

    return $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: props(100),
      requestId: 'ide-git',
      viewport: VIEWPORT,
    })
  }
  type Ui = Awaited<ReturnType<typeof open>>
  const drag = async (ui: Ui, key: string, to: number) => {
    await ui.pointer({ type: 'down', button: 'left', x: 0, y: 0, in: key })
    await ui.pointer({ type: 'move', button: 'left', x: to, y: 0, in: key })
    await ui.pointer({ type: 'up', button: 'left', x: to, y: 0, in: key })
  }
  const barOf = async (ui: Ui, key: string) =>
    (await ui.find({ key }))?.props.props as { axis?: string; offset: number; total: number; visible: number } | undefined
  // what every Text shows (a found Text carries no key)
  const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(text => text.text)
  const hunks = (source: string) => source.split('\n').filter(line => line.startsWith('@@'))

  test(`${surface}: a wide Info line draws hb:info; a drag shifts Info's lines`, async ($, on) => {
    const ui = await open($, on)
    await ui.press({ key: 'commit:' + HEAD_SHA })
    const before = ['eLeSTRaGo <elestrago63@gmail.com>', WIDE_LINE]
    for (const line of before) expect(await texts(ui)).toContain(line)
    const bar = await barOf(ui, 'hb:info')
    expect(bar?.axis).toBe('x')
    expect(bar?.offset).toBe(0)
    expect(bar?.total).toBe(300)

    await drag(ui, 'hb:info', 20)
    const left = (await barOf(ui, 'hb:info'))?.offset ?? 0
    expect(left).toBeGreaterThan(0)
    const shown = await texts(ui)
    // a line scrolled past its end draws a space
    for (const line of before) expect(shown).toContain(sliceCols(line, left) || ' ')
    expect(shown).not.toContain(WIDE_LINE)

    // another commit: back to column 0
    const other = (await ui.findAll({ type: 'Button' }))
      .map(b => b.key ?? '')
      .find(key => key.startsWith('commit:') && key !== 'commit:' + HEAD_SHA)
    await ui.press({ key: other ?? '' })
    expect((await barOf(ui, 'hb:info'))?.offset).toBe(0)
  })

  test(`${surface}: Info scrolled past its short lines keeps one Text row per line`, async ($, on) => {
    const ui = await open($, on)
    await ui.press({ key: 'commit:' + HEAD_SHA })
    await drag(ui, 'hb:info', 1000)
    const left = (await barOf(ui, 'hb:info'))?.offset ?? 0
    expect(left).toBeGreaterThan('eLeSTRaGo <elestrago63@gmail.com>'.length)
    const shown = await texts(ui)
    // a line shorter than `left` draws a space, not an empty Text (zero rows)
    expect(shown).not.toContain('')
    expect(shown).toContain(' ')
    expect(shown).toContain(sliceCols(WIDE_LINE, left))
  })

  test(`${surface}: short Info and Diff Preview lines draw no bar`, async ($, on) => {
    const ui = await open($, on, false)
    await ui.press({ key: 'commit:' + HEAD_SHA })
    expect(await ui.find({ key: 'hb:info' })).toBeUndefined()
    await ui.press({ key: 'tab:changelog' })
    await ui.press({ key: 'change:b.txt' })
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    expect(await ui.find({ key: 'hb:details' })).toBeUndefined()
  })

  test(`${surface}: a wide change draws hb:details; a drag slices the diff and head, @@ kept`, async ($, on) => {
    const ui = await open($, on)
    await ui.press({ key: 'tab:changelog' })
    await ui.press({ key: 'change:b.txt' })
    const source = () => ui.find({ type: 'Code' }).then(code => String(code?.props.source ?? ''))
    const whole = await source()
    expect(whole).toContain('+' + WIDE_LINE)
    expect(await texts(ui)).toContain('modified')
    const bar = await barOf(ui, 'hb:details')
    expect(bar?.offset).toBe(0)
    // the body line's marker and the diff gutter (" 41 ") count
    expect(bar?.total).toBe(301 + 4)

    // a short drag, so the head line `modified` is cut, not gone
    await drag(ui, 'hb:details', 1)
    const left = (await barOf(ui, 'hb:details'))?.offset ?? 0
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(8)
    const sliced = await source()
    expect(hunks(sliced)).toEqual(hunks(whole))
    expect(sliced).toContain('\n+' + sliceCols(WIDE_LINE, left) + '\n')
    expect(sliced).not.toContain('+' + WIDE_LINE)
    expect(await texts(ui)).toContain(sliceCols('modified', left))
    expect(await texts(ui)).not.toContain('modified')

    // another file: column 0, and its short diff draws no bar
    await ui.press({ key: 'change:a.txt' })
    expect(await ui.find({ key: 'hb:details' })).toBeUndefined()
    await ui.press({ key: 'change:b.txt' })
    expect((await barOf(ui, 'hb:details'))?.offset).toBe(0)
    expect(await source()).toBe(whole)
  })

  test(`${surface}: the diff view's Diff Preview scrolls sideways too`, async ($, on) => {
    const ui = await open($, on)
    await ui.press({ key: 'diff:' + HEAD_SHA })
    await ui.press({ key: 'dfile:CHANGELOG.md' })
    const source = () => ui.find({ type: 'Code' }).then(code => String(code?.props.source ?? ''))
    const whole = await source()
    expect(whole).toContain('+' + WIDE_LINE)
    expect(await barOf(ui, 'hb:details')).toBeDefined()

    await drag(ui, 'hb:details', 30)
    const left = (await barOf(ui, 'hb:details'))?.offset ?? 0
    expect(left).toBeGreaterThan(0)
    const sliced = await source()
    expect(hunks(sliced)).toEqual(hunks(whole))
    expect(sliced).toContain('+' + sliceCols(WIDE_LINE, left))

    // back closes the view: column 0 again
    await ui.press({ key: 'back' })
    await ui.press({ key: 'diff:' + HEAD_SHA })
    expect((await barOf(ui, 'hb:details'))?.offset).toBe(0)
  })
}
