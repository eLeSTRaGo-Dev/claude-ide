import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BRANCHES, LOG, PATCH, STAT } from './fixtures'

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

// `isRepo` false answers every git call with exit 128.
const fake = (
  on: On,
  calls: string[][],
  isRepo = true,
  log = LOG,
  head: { name: string } = { name: 'main' },
  status = STATUS,
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
      return result(e.argv.includes('--stat') ? STAT : PATCH)
    }

    return result('', 1)
  })
  on('env.get', () => ({ value: '/home/u' }))
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

    test(`${surface}/${columns}: blocks are titled, footer shows dir and counts`, async ($, on) => {
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

  test(`${surface}: wheel over the details scrolls the diff, valid hunks`, async ($, on) => {
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

    test(`${surface}/${columns}: tabs switch the middle block between commits and changes`, async ($, on) => {
      const ui = await open($, on)

      expect((await ui.find({ key: 'tab:graph' }))?.props.hotkey).toBe('g')
      expect((await ui.find({ key: 'tab:changes' }))?.props.hotkey).toBe('c')
      expect((await ui.find({ key: 'tab:changes' }))?.props.label).toContain('Changes 3')
      expect(await ui.find({ key: 'change:b.txt' })).toBeUndefined()
      await ui.press({ key: 'tab:changes' })
      expect((await ui.find({ key: 'title:changes' }))?.props.label).toBe(' Changes ')
      expect(await keys(ui, 'change:')).toEqual(['change:a.txt', 'change:b.txt', 'change:c.txt'])
      expect(await keys(ui, 'commit:')).toEqual([])
      await ui.press({ key: 'tab:graph' })
      expect((await ui.find({ key: 'title:commits' }))?.props.label).toBe(' Commits ')
      expect((await keys(ui, 'commit:')).length).toBeGreaterThan(0)
    })

    test(`${surface}/${columns}: a change shows its diff; untracked uses --no-index`, async ($, on) => {
      const calls: string[][] = []
      const ui = await open($, on, calls)
      await ui.press({ key: 'tab:changes' })

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
      await ui.press({ key: 'tab:changes' })

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
      await ui.press({ key: 'tab:changes' })

      expect(await ui.find({ type: 'Text', text: 'Working tree clean' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Select a change.' })).toBeDefined()
    })

    test(`${surface}/${columns}: arrows move the selected change, wheel and scrollbar scroll`, async ($, on) => {
      const status = Array.from({ length: 40 }, (_, i) => ` M f${String(i).padStart(2, '0')}.txt`)
      const ui = await open($, on, [], [...status, ''].join('\0'))
      await ui.press({ key: 'tab:changes' })
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
      // wheel over the list (middle column) moves the window, not the selection
      const middle = columns >= 140 ? 60 : 50
      await scroll(5, { column: middle, row: 3 })
      expect((await keys(ui, 'change:'))[0]).toBe('change:f05.txt')
    })
  }
}
