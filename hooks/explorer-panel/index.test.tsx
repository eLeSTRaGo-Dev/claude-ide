import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { draftFile } from './edit'

const CWD = '/proj'
const PLUGIN = 'ide-panes'
const VIEWPORT = { columns: 120, rows: 30 }
const PROPS = {
  title: 'Explorer',
  isFocused: true,
  bodyColumns: 118,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const entry = (name: string, kind: 'file' | 'dir', size = 10) => ({
  name,
  kind,
  size,
  mtimeMs: 1_700_000_000_000,
  isLink: false,
})

const TREE: Record<string, ReturnType<typeof entry>[]> = {
  '/proj': [
    entry('src', 'dir'),
    entry('.git', 'dir'),
    entry('notes.txt', 'file'),
    entry('out.log', 'file'),
    entry('app.bin', 'file', 64),
  ],
  '/proj/src': [entry('main.ts', 'file', 40)],
}

const FILES: Record<string, string> = {
  '/proj/src/main.ts': 'export const answer = 42\n',
  '/proj/notes.txt': 'hello notes\n',
  '/proj/app.bin': 'MZ\0\0binary',
}

// mtimes `fs.write` set; a path not here has the fixed one.
const MTIMES: Record<string, number> = {}
let clock = 1_800_000_000_000

// `grep` output per cwd, for the Unity GUID index.
const GREP: Record<string, string> = {}

// Paths the fake `rm` refuses (its exit 1 and stderr).
const FAIL_RM = new Set<string>()

// The fake `rm -rf`: the path, everything under it and its row in its dir.
const removePath = (path: string): void => {
  const under = (at: string) => at === path || at.startsWith(path + '/')
  for (const at of Object.keys(FILES)) if (under(at)) delete FILES[at]
  for (const at of Object.keys(TREE)) if (under(at)) delete TREE[at]
  const dir = path.slice(0, path.lastIndexOf('/'))
  const name = path.slice(dir.length + 1)
  if (TREE[dir] !== undefined) TREE[dir] = TREE[dir]!.filter(item => item.name !== name)
}

const descendants = (dir: string): number =>
  (TREE[dir] ?? []).reduce(
    (sum, item) => sum + 1 + (item.kind === 'dir' ? descendants(dir + '/' + item.name) : 0),
    0,
  )

// Answers fs, git, session and command plumbing beneath the plugin.
const fake = (
  on: On,
  calls: string[][] = [],
  opened: unknown[] = [],
  names: string[] = [],
  root = (): string => CWD,
): void => {
  on('fs.list', (_$, e) => ({ value: TREE[e.path] ?? [] }))
  on('fs.write', (_$, e) => {
    FILES[e.path] = e.text
    MTIMES[e.path] = ++clock
    // As the real write: the file, and its dirs where missing, are listed.
    for (let path = e.path, kind: 'file' | 'dir' = 'file'; path.lastIndexOf('/') > 0; kind = 'dir') {
      const dir = path.slice(0, path.lastIndexOf('/'))
      const name = path.slice(dir.length + 1)
      const listed = TREE[dir] ?? []
      if (!listed.some(item => item.name === name)) TREE[dir] = [...listed, entry(name, kind, e.text.length)]
      path = dir
    }

    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error('ENOENT ' + e.path)

    return {
      value: {
        kind: 'file' as const,
        size: text.length,
        mtimeMs: MTIMES[e.path] ?? 1_700_000_000_000,
        isLink: false,
      },
    }
  })
  on('fs.exists', (_$, e) => ({
    value: FILES[e.path] !== undefined || TREE[e.path] !== undefined,
  }))
  on('fs.read', (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error('ENOENT ' + e.path)

    return { value: text }
  })
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (e.argv[0] === 'rm') {
      // The operands: after `--`, else every non-flag argument.
      const dash = e.argv.indexOf('--')
      const paths = dash >= 0 ? e.argv.slice(dash + 1) : e.argv.slice(1).filter(arg => !arg.startsWith('-'))
      const refused = paths.find(path => FAIL_RM.has(path))
      if (refused !== undefined) {
        return {
          value: {
            exitCode: 1,
            stdout: '',
            stderr: `rm: cannot remove '${refused}': Permission denied\n`,
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        }
      }
      for (const path of paths) removePath(path)

      return {
        value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
      }
    }
    // `find "$1" -mindepth 1 | head | wc -l`: the entries under a dir.
    if (e.argv[0] === 'sh' && (e.argv[2] ?? '').includes('find')) {
      return {
        value: {
          exitCode: 0,
          stdout: `${descendants(e.argv[4] ?? '')}\n`,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    // a repo on `main` with one untracked, two modified and one deleted file
    if (e.argv[0] === 'git' && (e.argv[1] === 'rev-parse' || e.argv[1] === 'status')) {
      return {
        value: {
          exitCode: 0,
          stdout: e.argv[1] === 'rev-parse' ? 'main\n' : '?? new.ts\0 M a.ts\0 D b.ts\0 M c.ts\0',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    if (e.argv[0] === 'grep') {
      return {
        value: {
          exitCode: 0,
          stdout: GREP[e.init?.cwd ?? ''] ?? '',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    const stdin = e.init?.stdin ?? ''
    const hit = stdin.split('\0').filter(name => name === 'out.log')

    return {
      value: {
        exitCode: hit.length > 0 ? 0 : 1,
        stdout: hit.map(name => name + '\0').join(''),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('env.get', () => ({ value: '/home/u' }))
  let cwd = CWD
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: root() }))
  on('session.start', (_$, e) => {
    cwd = e.cwd

    return { cwd: e.cwd }
  })
  on('command.register', (_$, e) => {
    names.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, focus: e.focus })

    return { value: { isPlaced: true } }
  })
}

const PRESENTATION = { isFullscreen: true, columns: 120 }

const start = (surface: 'terminal' | 'desktop') => ({
  cwd: CWD,
  surface,
  isInteractive: true,
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: tree expands a dir and previews a file`, async ($, on) => {
    mock.store(on)
    fake(on)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    expect(await ui.find({ key: 'row:/proj/src' })).toBeDefined()
    expect(await ui.find({ key: 'row:/proj/.git' })).toBeUndefined()
    expect(await ui.find({ key: 'row:/proj/src/main.ts' })).toBeUndefined()

    await ui.press({ key: 'row:/proj/src' })
    expect(await ui.find({ key: 'row:/proj/src/main.ts' })).toBeDefined()

    await ui.press({ key: 'row:/proj/src/main.ts' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.text).toContain('answer = 42')
    expect(code?.props.language).toBe('typescript')
  })

  test(`${surface}: footer shows dir, branch and change counts`, async ($, on) => {
    mock.store(on)
    fake(on)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    expect(await ui.find({ type: 'Text', text: CWD + ' (main)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+1 ~2 -1' })).toBeDefined()
  })

  test(`${surface}: sections are titled, pressing a title copies its name`, async ($, on) => {
    mock.store(on)
    fake(on)
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
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    expect((await ui.find({ key: 'title:files' }))?.props.label).toBe(' Files ')
    expect((await ui.find({ key: 'title:preview' }))?.props.label).toBe(' Preview ')
    await ui.press({ key: 'title:preview' })
    expect(copied).toEqual(['Explorer › Preview'])
    expect(toasts.at(-1)).toBe('Copied: Explorer › Preview')
  })

  test(`${surface}: binary shows metadata, ignored entry is dimmed`, async ($, on) => {
    mock.store(on)
    const calls: string[][] = []
    fake(on, calls)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    await ui.press({ key: 'row:/proj/app.bin' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /10 B/ })).toBeDefined()

    expect(calls.some(argv => argv[1] === 'check-ignore')).toBe(true)
    const log = await ui.find({ key: 'row:/proj/out.log' })
    expect(log?.props.dimColor).toBe(true)
    const notes = await ui.find({ key: 'row:/proj/notes.txt' })
    expect(notes?.props.dimColor).toBeFalsy()
  })

  test(`${surface}: dir preview counts entries`, async ($, on) => {
    mock.store(on)
    fake(on)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    await ui.press({ key: 'row:/proj/src' })
    expect(await ui.find({ type: 'Text', text: /1 entries/ })).toBeDefined()
  })

  test(`${surface}: a shell cd keeps the root and the expanded dirs`, async ($, on) => {
    mock.store(on)
    fake(on)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })
    await ui.press({ key: 'row:/proj/src' })

    await $.session.start({ ...start(surface), cwd: CWD + '/src' })
    expect(await ui.find({ key: 'row:/proj/src' })).toBeDefined()
    expect(await ui.find({ key: 'row:/proj/notes.txt' })).toBeDefined()
    expect(await ui.find({ key: 'row:/proj/src/main.ts' })).toBeDefined()
  })

  test(`${surface}: mode toggle writes the store and session.start restores it`, async ($, on) => {
    const store = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e) => {
      store.set(e.key, e.value)

    return { value: undefined }
    })
    fake(on)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    expect((await ui.find({ key: 'tab:files' }))?.props.label).toBe('▌Files')
    expect((await ui.find({ key: 'tab:files' }))?.props.hotkey).toBe('f')
    expect((await ui.find({ key: 'tab:unity' }))?.props.hotkey).toBe('u')
    await ui.press({ key: 'tab:unity' })
    expect(store.get('explorer.mode:' + CWD)).toBe('unity')
    expect((await ui.find({ key: 'tab:unity' }))?.props.label).toBe('▌Unity')

    await $.session.start(start(surface))
    expect((await ui.find({ key: 'tab:unity' }))?.props.label).toBe('▌Unity')
  })

  test(`${surface}: unity mode hints when the root is not a Unity project`, async ($, on) => {
    TREE['/game'] = [entry('Assets', 'dir'), entry('ProjectSettings', 'dir')]
    TREE['/game/ProjectSettings'] = [entry('ProjectVersion.txt', 'file')]
    FILES['/game/ProjectSettings/ProjectVersion.txt'] = 'm_EditorVersion: 6000.0.0f1\n'
    TREE['/plain'] = [entry('Assets', 'dir')]
    const store = new Map<string, unknown>([
      ['explorer.mode:/game', 'unity'],
      ['explorer.mode:/plain', 'unity'],
    ])
    on('store.get', (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e) => {
      store.set(e.key, e.value)

      return { value: undefined }
    })
    let root = '/plain'
    fake(on, [], [], [], () => root)
    await $.session.start({ ...start(surface), cwd: '/plain' })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    expect((await ui.find({ key: 'tab:unity' }))?.props.label).toBe('▌Unity')
    expect(
      await ui.find({ type: 'Text', text: /not a Unity project/ }),
    ).toBeDefined()

    root = '/game'
    await $.session.start({ ...start(surface), cwd: '/game' })
    expect((await ui.find({ key: 'tab:unity' }))?.props.label).toBe('▌Unity')
    expect(
      await ui.find({ type: 'Text', text: /not a Unity project/ }),
    ).toBeUndefined()
  })

  test(`${surface}: files mode shows no Unity hint`, async ($, on) => {
    mock.store(on)
    fake(on)
    await $.session.start(start(surface))
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    expect(
      await ui.find({ type: 'Text', text: /not a Unity project/ }),
    ).toBeUndefined()
  })
}

const GUID_A = 'a'.repeat(32)
const GUID_B = 'b'.repeat(32)
const BUILTIN = '0000000000000000e000000000000000'
const GUID_X = 'c'.repeat(32)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: unity preview lists references and jumps to a resolved one`, async ($, on) => {
    TREE['/uni'] = [entry('Assets', 'dir'), entry('ProjectSettings', 'dir')]
    TREE['/uni/ProjectSettings'] = [entry('ProjectVersion.txt', 'file')]
    TREE['/uni/Assets'] = [entry('Prefabs', 'dir'), entry('Art', 'dir')]
    TREE['/uni/Assets/Prefabs'] = [entry('hero.prefab', 'file')]
    TREE['/uni/Assets/Art'] = [entry('Mats', 'dir')]
    TREE['/uni/Assets/Art/Mats'] = [entry('skin.mat', 'file')]
    FILES['/uni/ProjectSettings/ProjectVersion.txt'] = 'm_EditorVersion: 6000.0.0f1\n'
    FILES['/uni/Assets/Prefabs/hero.prefab'] = [
      '--- !u!1 &1',
      `  m_Material: {fileID: 2100000, guid: ${GUID_A}, type: 2}`,
      `  m_Script: {fileID: 11500000, guid: ${GUID_A}, type: 3}`,
      `  m_Mesh: {fileID: 10202, guid: ${BUILTIN}, type: 0}`,
      `  m_Other: {fileID: 1, guid: ${GUID_X}, type: 3}`,
    ].join('\n')
    GREP['/uni'] = [
      `Assets/Art/Mats/skin.mat.meta:guid: ${GUID_A}`,
      `Assets/Prefabs/hero.prefab.meta:guid: ${GUID_B}`,
    ].join('\n')
    const store = new Map<string, unknown>([['explorer.mode:/uni', 'unity']])
    on('store.get', (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e) => {
      store.set(e.key, e.value)

      return { value: undefined }
    })
    fake(on, [], [], [], () => '/uni')
    await $.session.start({ ...start(surface), cwd: '/uni' })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    await ui.press({ key: 'row:/uni/Assets' })
    await ui.press({ key: 'row:/uni/Assets/Prefabs' })
    await ui.press({ key: 'row:/uni/Assets/Prefabs/hero.prefab' })
    expect(await ui.find({ type: 'Text', text: /References \(3\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Unity built-in/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /package or missing/ })).toBeDefined()
    expect(await ui.find({ key: 'row:/uni/Assets/Art/Mats/skin.mat' })).toBeUndefined()

    await ui.press({ key: 'ref:/uni/Assets/Art/Mats/skin.mat' })
    expect(await ui.find({ key: 'row:/uni/Assets/Art/Mats/skin.mat' })).toBeDefined()
    expect(await ui.find({ key: 'row:/uni/Assets/Art/Mats' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /References/ })).toBeUndefined()
  })
}

test('files mode shows no references', async ($, on) => {
  mock.store(on)
  fake(on)
  TREE['/proj/src'] = [entry('a.prefab', 'file')]
  FILES['/proj/src/a.prefab'] = `guid: ${GUID_A}\n`
  await $.session.start(start('terminal'))
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    props: PROPS,
    requestId: 'ide-explorer',
    viewport: VIEWPORT,
  })
  await ui.press({ key: 'row:/proj/src' })
  await ui.press({ key: 'row:/proj/src/a.prefab' })
  expect(await ui.find({ type: 'Text', text: /References/ })).toBeUndefined()
  TREE['/proj/src'] = [entry('main.ts', 'file', 40)]
})

test('focus moving past the window edge scrolls the tree', async ($, on) => {
  mock.store(on)
  fake(on, [], [], [], () => '/big')
  const names = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`)
  TREE['/big'] = names.map(name => entry(name, 'file'))
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: '/big', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    props: { ...PROPS, scroll: { offset: 0, bodyRows: 9 } },
    requestId: 'ide-explorer',
    viewport: VIEWPORT,
  })

  const rows = async () =>
    (await ui.findAll({ type: 'Button' }))
      .map(b => b.key ?? '')
      .filter(key => key.startsWith('row:'))
  expect(await rows()).toHaveLength(4)
  for (const name of names.slice(0, 6)) {
    await $.ui.focus({
      component: 'Pane',
      requestId: 'ide-explorer',
      plugin: PLUGIN,
      element: 'row:/big/' + name,
      origin: { kind: 'person' },
    })
  }
  const shown = await rows()
  expect(shown).toHaveLength(4)
  expect(shown).toContain('row:/big/f05.txt')
  expect(shown).toContain('row:/big/f06.txt')
  expect(shown).not.toContain('row:/big/f00.txt')
})

test('focus moves the cursor, Enter moves the selection', async ($, on) => {
  mock.store(on)
  fake(on, [], [], [], () => '/cur')
  TREE['/cur'] = ['a.txt', 'b.txt'].map(name => entry(name, 'file'))
  FILES['/cur/a.txt'] = 'alpha'
  FILES['/cur/b.txt'] = 'bravo'
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: '/cur', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    props: PROPS,
    requestId: 'ide-explorer',
    viewport: VIEWPORT,
  })

  const code = async () => (await ui.find({ type: 'Code' }))?.text ?? ''
  await ui.press({ key: 'row:/cur/a.txt' })
  expect(await code()).toContain('alpha')
  await $.ui.focus({
    component: 'Pane',
    requestId: 'ide-explorer',
    plugin: PLUGIN,
    element: 'row:/cur/b.txt',
    origin: { kind: 'person' },
  })
  // the preview stays on the selected file while the cursor moves
  expect(await code()).toContain('alpha')
  await ui.press({ key: 'row:/cur/b.txt' })
  expect(await code()).toContain('bravo')
})

test('session.start registers /ide-panels only', async ($, on) => {
  mock.store(on)
  const names: string[] = []
  fake(on, [], [], names)
  await $.session.start(start('terminal'))

  expect(names).toEqual(['ide-panels'])
})

test('/ide-panels opens explorer and git, explorer focused in front', async ($, on) => {
  mock.store(on)
  const opened: unknown[] = []
  fake(on, [], opened)
  await $.session.start(start('terminal'))
  const ran = await $.command.run({
    command: 'ide-panels',
    args: '',
    origin: { kind: 'composer' },
    presentation: PRESENTATION,
  })

  expect(ran.text).toContain('Explorer and Git')
  expect(opened).toEqual([
    { id: 'ide-explorer', focus: undefined },
    { id: 'ide-git', focus: undefined },
    { id: 'ide-explorer', focus: true },
  ])
})

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: Engine) =>
    $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

  // The test's own bottom hook: the tool "runs" and reports success.
  const done = () => ({ result: {}, text: '' }) as never

  test(`${surface}: a Write of a new file shows its row without refresh`, async ($, on) => {
    mock.store(on)
    fake(on)
    on('tool.call', done)
    await $.session.start(start(surface))
    const ui = await mount($)
    await ui.press({ key: 'row:/proj/src' })
    expect(await ui.find({ key: 'row:/proj/src/new.ts' })).toBeUndefined()

    TREE['/proj/src'] = [...(TREE['/proj/src'] ?? []), entry('new.ts', 'file')]
    await $.tool.call({
      tool: 'Write',
      file_path: '/proj/src/new.ts',
      content: 'x',
    })
    expect(await ui.find({ key: 'row:/proj/src/new.ts' })).toBeDefined()
    TREE['/proj/src'] = [entry('main.ts', 'file', 40)]
  })

  test(`${surface}: a Bash call re-lists the tree`, async ($, on) => {
    mock.store(on)
    fake(on)
    on('tool.call', done)
    await $.session.start(start(surface))
    const ui = await mount($)
    expect(await ui.find({ key: 'row:/proj/fresh.txt' })).toBeUndefined()

    TREE['/proj'] = [...(TREE['/proj'] ?? []), entry('fresh.txt', 'file')]
    await $.tool.call({ tool: 'Bash', command: 'touch fresh.txt' })
    expect(await ui.find({ key: 'row:/proj/fresh.txt' })).toBeDefined()
    TREE['/proj'] = (TREE['/proj'] ?? []).filter(x => x.name !== 'fresh.txt')
  })

  test(`${surface}: hotkeys f, u and r are set and work`, async ($, on) => {
    mock.store(on)
    fake(on)
    await $.session.start(start(surface))
    const ui = await mount($)

    expect(await ui.find({ key: 'mode' })).toBeUndefined()
    expect((await ui.find({ key: 'tab:files' }))?.props.hotkey).toBe('f')
    expect((await ui.find({ key: 'tab:unity' }))?.props.hotkey).toBe('u')
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    expect((await ui.find({ key: 'tab:files' }))?.props.dimColor).toBeUndefined()
    expect((await ui.find({ key: 'tab:unity' }))?.props.dimColor).toBe(true)
    await ui.press({ key: 'tab:unity' })
    expect(await ui.find({ type: 'Text', text: /not a Unity project/ })).toBeDefined()
    expect((await ui.find({ key: 'tab:unity' }))?.props.dimColor).toBeUndefined()
    await ui.press({ key: 'tab:files' })
    expect((await ui.find({ key: 'tab:files' }))?.props.label).toBe('▌Files')
    expect(await ui.find({ type: 'Text', text: /not a Unity project/ })).toBeUndefined()
  })
}

const scroll = ($: Engine, requestId: string, by: number, pointer?: { column: number; row: number }) =>
  $.ui.scroll({
    component: 'Pane',
    requestId,
    plugin: PLUGIN,
    offset: 0,
    by,
    bodyRows: 20,
    contentRows: 20,
    origin: { kind: 'person' },
    ...(pointer === undefined ? {} : { pointer }),
  } as never)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: wheel scrolls the section under the pointer, keys move the selection and page the preview`, async ($, on) => {
    mock.store(on)
    fake(on, [], [], [], () => '/many')
    on('ui.focus', () => ({}))
    on('ui.scroll', () => ({}))
    const names = Array.from({ length: 30 }, (_, i) => `g${String(i).padStart(2, '0')}.txt`)
    TREE['/many'] = names.map(name => entry(name, 'file'))
    for (const name of names) {
      FILES['/many/' + name] = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    }
    await $.session.start({ cwd: '/many', surface, isInteractive: true })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: { ...PROPS, scroll: { offset: 0, bodyRows: 12 } },
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })
    const keys = async () =>
      (await ui.findAll({ type: 'Button' }))
        .map(b => b.key ?? '')
        .filter(key => key.startsWith('row:'))
    const bars = async () =>
      (await ui.findAll({ type: 'Text', text: /^[┃│ ]$/, in: 'sb:preview' })).map(t => t.text).join('')
    await ui.press({ key: 'row:/many/g00.txt' })
    expect(await keys()).toContain('row:/many/g00.txt')
    expect(await bars()).toContain('┃')

    // wheel over the tree: the window moves, the selection stays
    await scroll($, 'ide-explorer', 5, { column: 5, row: 3 })
    const moved = await keys()
    expect(moved).not.toContain('row:/many/g00.txt')
    expect(moved).toContain('row:/many/g05.txt')
    const code = async () => await ui.find({ type: 'Code' })
    expect((await code())?.props.startLine).toBe(1)

    // wheel over the preview scrolls the file lines
    await scroll($, 'ide-explorer', 4, { column: 80, row: 3 })
    expect((await code())?.props.startLine).toBe(5)
    expect((await code())?.text).toContain('line 5')
    expect(await keys()).toEqual(moved)

    // a page key (no pointer) scrolls the preview by its rows
    await scroll($, 'ide-explorer', 20)
    expect(((await code())?.props.startLine as number) > 5).toBe(true)
    await scroll($, 'ide-explorer', -20)
    expect((await code())?.props.startLine).toBe(5)
    await scroll($, 'ide-explorer', -20)
    expect((await code())?.props.startLine).toBe(1)

    // an arrow key moves the selection and resets the preview
    await scroll($, 'ide-explorer', 1)
    expect(await keys()).toContain('row:/many/g01.txt')
    expect((await code())?.props.startLine).toBe(1)
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: dragging a scrollbar moves its section, the selection stays`, async ($, on) => {
    mock.store(on)
    fake(on, [], [], [], () => '/drag')
    on('ui.focus', () => ({}))
    const names = Array.from({ length: 30 }, (_, i) => `d${String(i).padStart(2, '0')}.txt`)
    TREE['/drag'] = names.map(name => entry(name, 'file'))
    for (const name of names) {
      FILES['/drag/' + name] = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    }
    await $.session.start({ cwd: '/drag', surface, isInteractive: true })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: { ...PROPS, scroll: { offset: 0, bodyRows: 14 } },
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })
    await ui.press({ key: 'row:/drag/d00.txt' })
    const code = async () => await ui.find({ type: 'Code' })
    const keys = async () =>
      (await ui.findAll({ type: 'Button' }))
        .map(b => b.key ?? '')
        .filter(key => key.startsWith('row:'))
    const thumbs = async (key: string) =>
      (await ui.findAll({ type: 'Text', in: key })).map(t => t.text).join('')

    await ui.resize({ columns: 1, rows: 9, in: 'sb:preview' })
    await ui.resize({ columns: 1, rows: 9, in: 'sb:tree' })

    // preview: the thumb starts on top; drag it down, release at the bottom
    expect((await thumbs('sb:preview')).startsWith('┃')).toBe(true)
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'sb:preview' })
    expect((await code())?.props.startLine).toBe(1)
    await ui.pointer({ type: 'move', x: 0, y: 4, button: 'left', in: 'sb:preview' })
    expect((await code())?.props.startLine).toBe(27)
    await ui.pointer({ type: 'up', x: 0, y: 8, button: 'left', in: 'sb:preview' })
    expect((await code())?.props.startLine).toBe(52)
    expect((await thumbs('sb:preview')).endsWith('┃')).toBe(true)

    // a click on the track centres the thumb there
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'sb:preview' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'sb:preview' })
    expect((await code())?.props.startLine).toBe(1)

    // tree: the window moves, the selection and preview stay
    await ui.pointer({ type: 'down', x: 0, y: 8, button: 'left', in: 'sb:tree' })
    await ui.pointer({ type: 'up', x: 0, y: 8, button: 'left', in: 'sb:tree' })
    const moved = await keys()
    expect(moved).not.toContain('row:/drag/d00.txt')
    expect(moved).toContain('row:/drag/d29.txt')
    expect((await code())?.props.startLine).toBe(1)
    expect((await code())?.text).toContain('line 1')
  })
}

// ------------------------------------------------------------ Edit section

// A root of one dir with the given files; mounts the pane, selects the first
// file and opens the editor on it.
const editing = async (
  $: Engine,
  on: On,
  surface: 'terminal' | 'desktop',
  root: string,
  files: Record<string, string>,
) => {
  mock.store(on)
  fake(on, [], [], [], () => root)
  TREE[root] = Object.keys(files).map(name => entry(name, 'file', files[name]!.length))
  for (const [name, text] of Object.entries(files)) {
    FILES[root + '/' + name] = text
    delete MTIMES[root + '/' + name]
    delete FILES[draftFile('/home/u', root + '/' + name)]
  }
  await $.session.start({ cwd: root, surface, isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    props: PROPS,
    requestId: 'ide-explorer',
    viewport: VIEWPORT,
  })
  await ui.press({ key: 'row:' + root + '/' + Object.keys(files)[0] })
  expect((await ui.find({ key: 'edit' }))?.props.hotkey).toBe('e')
  await ui.press({ key: 'edit' })
  await ui.resize({ columns: 60, rows: 10, in: 'editor' })
  // Lets the client's posts and the hook's answers settle.
  const settle = async () => {
    for (let i = 0; i < 8; i++) await ui.advance(250)
  }
  await settle()
  const text = async () =>
    (await ui.findAll({ type: 'Text', in: 'editor' }))
      // one Text per row; its runs are Texts nested in it
      .filter(t => t.props.wrap === 'truncate-end')
      .map(t => t.text)
      .join('\n')
  const title = async () => (await ui.find({ key: 'title:edit' }))?.props.label

  return { ui, settle, text, title }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: edit, type and save writes the file`, async ($, on) => {
    const { ui, settle, text, title } = await editing($, on, surface, '/ed1', { 'a.ts': 'one\ntwo\n' })
    expect(await text()).toContain('one')
    expect(await title()).toBe(' Edit ')

    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    expect(await text()).toContain('xone')
    expect(await title()).toBe(' ● Edit ')

    await ui.key({ key: 's', ctrl: true, in: 'editor' })
    await settle()
    expect(FILES['/ed1/a.ts']).toBe('xone\ntwo\n')
    expect(await title()).toBe(' Edit ')
  })

  test(`${surface}: a 300k-char file loads in 4 chunks and saves intact`, async ($, on) => {
    const line = 'const value = "0123456789abcdefghijklmnopqrstuvwxyz";\n'
    const big = line.repeat(Math.ceil(300_000 / line.length))
    const { ui, settle, text } = await editing($, on, surface, '/ed2', { 'big.ts': big })
    const client = await ui.find({ key: 'editor' })
    const props = client?.props.props as { total: number; index: number }
    expect(props.total).toBe(4)
    expect(props.index).toBe(4)
    expect(await text()).toContain('0123456789')

    await ui.press({ key: 'edit:duplicateLines' })
    await settle()
    await ui.press({ key: 'edit:deleteLines' })
    await settle()
    await ui.press({ key: 'edit:save' })
    await settle()
    expect(FILES['/ed2/big.ts']).toBe(big)
  })

  test(`${surface}: save after an external change shows the conflict bar`, async ($, on) => {
    const { ui, settle } = await editing($, on, surface, '/ed3', { 'a.ts': 'one\n' })
    await ui.key({ key: 'x', in: 'editor' })
    MTIMES['/ed3/a.ts'] = ++clock
    FILES['/ed3/a.ts'] = 'theirs\n'
    await ui.key({ key: 's', ctrl: true, in: 'editor' })
    await settle()
    expect(FILES['/ed3/a.ts']).toBe('theirs\n')
    expect(await ui.find({ key: 'ask:overwrite' })).toBeDefined()

    await ui.press({ key: 'ask:overwrite' })
    await settle()
    expect(FILES['/ed3/a.ts']).toBe('xone\n')
    expect(await ui.find({ key: 'ask:overwrite' })).toBeUndefined()
  })

  test(`${surface}: selecting another file while dirty asks first`, async ($, on) => {
    const { ui, settle } = await editing($, on, surface, '/ed4', { 'a.ts': 'one\n', 'b.ts': 'two\n' })
    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    await ui.press({ key: 'row:/ed4/b.ts' })
    expect(await ui.find({ key: 'ask:save' })).toBeDefined()
    expect(await ui.find({ key: 'editor' })).toBeDefined()

    await ui.press({ key: 'ask:cancel' })
    expect(await ui.find({ key: 'ask:save' })).toBeUndefined()
    expect(await ui.find({ key: 'editor' })).toBeDefined()

    await ui.press({ key: 'row:/ed4/b.ts' })
    await ui.press({ key: 'ask:discard' })
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    expect((await ui.find({ type: 'Code' }))?.text).toContain('two')
    expect(FILES['/ed4/a.ts']).toBe('one\n')
  })

  // The test kit raises no `ui.close` of its own: an inline plugin closes it.
  const closer = {
    name: 'closer',
    register: (on: On) => {
      on('command.run', { command: 'close-explorer' }, async $ => {
        await $.ui.close({ id: 'ide-explorer' })

        return { text: '' }
      })
    },
  }
  test(`${surface}: closing the pane while dirty keeps it open`, { plugins: [closer] }, async ($, on) => {
    let closed = 0
    on('ui.close', () => {
      closed += 1

      return { value: undefined }
    })
    const { ui, settle } = await editing($, on, surface, '/ed5', { 'a.ts': 'one\n' })
    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    const close = () =>
      $.command.run({
        command: 'close-explorer',
        args: '',
        origin: { kind: 'composer' },
        presentation: PRESENTATION,
      })
    await close()
    expect(closed).toBe(0)
    expect(await ui.find({ key: 'ask:save' })).toBeDefined()

    await ui.press({ key: 'ask:save' })
    await settle()
    expect(FILES['/ed5/a.ts']).toBe('xone\n')
    expect(closed).toBe(1)
  })

  test(`${surface}: session.start restores the draft`, async ($, on) => {
    const { ui, settle, text, title } = await editing($, on, surface, '/ed6', { 'a.ts': 'one\n' })
    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    const draft = draftFile('/home/u', '/ed6/a.ts')
    expect(FILES[draft]).toBe('xone\n')

    await $.session.start({ cwd: '/ed6', surface, isInteractive: true })
    await settle()
    expect(await text()).toContain('xone')
    expect(await title()).toBe(' ● Edit ')
    expect(FILES['/ed6/a.ts']).toBe('one\n')

    await ui.press({ key: 'edit:save' })
    await settle()
    expect(FILES['/ed6/a.ts']).toBe('xone\n')
    expect(FILES[draft]).toBeUndefined()
  })

  test(`${surface}: a click places the cursor, alt+click adds one`, async ($, on) => {
    const { ui, settle, text } = await editing($, on, surface, '/ed8', { 'a.ts': 'one\ntwo' })
    // the gutter is two cells ("1 ")
    await ui.pointer({ type: 'down', x: 3, y: 1, button: 'left', in: 'editor' })
    await ui.pointer({ type: 'up', x: 3, y: 1, button: 'left', in: 'editor' })
    await ui.key({ key: 'Z', shift: true, in: 'editor' })
    await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', alt: true, in: 'editor' })
    await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left', alt: true, in: 'editor' })
    await ui.key({ key: 'Q', shift: true, in: 'editor' })
    await settle()
    expect(await text()).toBe('1 Qone\n2 tZQwo')
  })

  test(
    `${surface}: editorKeys rebinds a key`,
    { options: { editorKeys: '{"duplicateLines":"ctrl+shift+d"}' } },
    async ($, on) => {
      const { ui, settle, text } = await editing($, on, surface, '/ed7', { 'a.ts': 'one\n' })
      await ui.key({ key: 'd', ctrl: true, in: 'editor' })
      await settle()
      expect((await text()).match(/one/g)).toHaveLength(1)
      await ui.key({ key: 'd', ctrl: true, shift: true, in: 'editor' })
      await settle()
      expect((await text()).match(/one/g)).toHaveLength(2)
    },
  )
}

test('vscode: no Client, so no edit button', async ($, on) => {
  mock.store(on)
  fake(on)
  await $.session.start({ cwd: CWD, surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'vscode',
    component: 'Pane',
    props: PROPS,
    requestId: 'ide-explorer',
    viewport: VIEWPORT,
  })
  await ui.press({ key: 'row:/proj/notes.txt' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  expect(await ui.find({ key: 'edit' })).toBeUndefined()
  // `new` opens the editor, so it needs a Client too, though vscode has Input.
  expect(await ui.find({ key: 'new' })).toBeUndefined()
})

// ---------------------------------------------------------------- New file

// A root with `src/x.ts`; mounts the pane with toasts recorded.
const naming = async ($: Engine, on: On, surface: 'terminal' | 'desktop', root: string) => {
  mock.store(on)
  fake(on, [], [], [], () => root)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  TREE[root] = [entry('src', 'dir')]
  TREE[root + '/src'] = [entry('x.ts', 'file')]
  FILES[root + '/src/x.ts'] = 'x\n'
  await $.session.start({ cwd: root, surface, isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    props: PROPS,
    requestId: 'ide-explorer',
    viewport: VIEWPORT,
  })
  const settle = async () => {
    for (let i = 0; i < 8; i++) await ui.advance(250)
  }

  return { ui, settle, toasts }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: new opens an empty dirty editor, the first save creates the file`, async ($, on) => {
    const { ui, settle } = await naming($, on, surface, '/nf1-' + surface)
    expect((await ui.find({ key: 'new' }))?.props.hotkey).toBe('n')
    await ui.press({ key: `row:/nf1-${surface}/src` })
    await ui.press({ key: 'new' })
    const field = await ui.find({ key: 'new-file' })
    expect(field?.props.label).toBe('new file in src/')
    expect(field?.props.submitLabel).toBe('create')

    await ui.input({ key: 'new-file', text: ' a/b.ts ' })
    await ui.resize({ columns: 60, rows: 10, in: 'editor' })
    await settle()
    expect(await ui.find({ key: 'new-file' })).toBeUndefined()
    expect(await ui.find({ key: 'editor' })).toBeDefined()
    expect((await ui.find({ key: 'title:edit' }))?.props.label).toBe(' ● Edit ')
    expect(FILES[`/nf1-${surface}/src/a/b.ts`]).toBeUndefined()
    expect(TREE[`/nf1-${surface}/src/a`]).toBeUndefined()

    await ui.key({ key: 'y', in: 'editor' })
    await ui.key({ key: 's', ctrl: true, in: 'editor' })
    await settle()
    expect(FILES[`/nf1-${surface}/src/a/b.ts`]).toBe('y')
    expect((await ui.find({ key: 'title:edit' }))?.props.label).toBe(' Edit ')
    expect(await ui.find({ key: `row:/nf1-${surface}/src/a` })).toBeDefined()
    expect(await ui.find({ key: `row:/nf1-${surface}/src/a/b.ts` })).toBeDefined()
  })

  test(`${surface}: new refuses a taken name and \`..\`, writing nothing`, async ($, on) => {
    const { ui, toasts } = await naming($, on, surface, '/nf2-' + surface)
    await ui.press({ key: `row:/nf2-${surface}/src` })
    await ui.press({ key: 'new' })
    const before = { ...FILES }

    await ui.input({ key: 'new-file', text: 'x.ts' })
    expect(toasts.at(-1)).toBe('Already exists: src/x.ts')
    await ui.input({ key: 'new-file', text: '../x' })
    expect(toasts.at(-1)).toBe('No \`..\` in a new file name')
    expect(FILES).toEqual(before)
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    expect(await ui.find({ key: 'new-file' })).toBeDefined()

    await ui.press({ key: 'new:cancel' })
    expect(await ui.find({ key: 'new-file' })).toBeUndefined()
  })

  test(`${surface}: new from a file names in its dir; with no selection, in the root`, async ($, on) => {
    const { ui } = await naming($, on, surface, '/nf3-' + surface)
    await ui.press({ key: 'new' })
    expect((await ui.find({ key: 'new-file' }))?.props.label).toBe('new file in ./')
    await ui.press({ key: `row:/nf3-${surface}/src` })
    await ui.press({ key: `row:/nf3-${surface}/src/x.ts` })
    await ui.press({ key: 'new' })
    expect((await ui.find({ key: 'new-file' }))?.props.label).toBe('new file in src/')
  })

  test(`${surface}: new over unsaved text asks first, discard shows the name field`, async ($, on) => {
    const { ui, settle } = await editing($, on, surface, `/nf4-${surface}`, { 'a.ts': 'one\n' })
    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    await ui.press({ key: 'new' })
    expect(await ui.find({ key: 'ask:save' })).toBeDefined()
    expect(await ui.find({ key: 'new-file' })).toBeUndefined()

    await ui.press({ key: 'ask:discard' })
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    expect((await ui.find({ key: 'new-file' }))?.props.label).toBe('new file in ./')
    expect(FILES[`/nf4-${surface}/a.ts`]).toBe('one\n')
  })

  test(`${surface}: header lines: tabs, actions, then the interactive line only while it asks`, async ($, on) => {
    const { ui, settle } = await editing($, on, surface, `/hl-${surface}`, { 'a.ts': 'one\n' })
    const lines = async () =>
      (await ui.findAll({ type: 'Box' }))
        .map(box => box.key ?? '')
        .filter(key => key.startsWith('header:'))
    const ask = async () => keysIn((await ui.findAll({ type: 'Box' })).find(box => box.key === 'header:ask'))
    expect(await lines()).toEqual(['header:tabs', 'header:actions'])
    const header = await ui.findAll({ type: 'Box' })
    expect(keysIn(header.find(box => box.key === 'header:tabs'))).toEqual(['tab:files', 'tab:unity'])
    expect(keysIn(header.find(box => box.key === 'header:actions'))).toEqual(
      expect.arrayContaining(['refresh', 'new', 'delete']),
    )

    // the name field and its cancel
    await ui.press({ key: 'new' })
    expect(await lines()).toEqual(['header:tabs', 'header:actions', 'header:ask'])
    expect(await ask()).toEqual(['new-file', 'new:cancel'])
    await ui.press({ key: 'new:cancel' })
    expect(await lines()).toEqual(['header:tabs', 'header:actions'])

    // the delete bar
    await ui.press({ key: 'delete' })
    expect(await ask()).toEqual(['delete:confirm', 'delete:cancel'])
    await ui.press({ key: 'delete:cancel' })
    expect(await lines()).toEqual(['header:tabs', 'header:actions'])

    // the unsaved-changes bar wins over the name field
    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    await ui.press({ key: 'new' })
    expect(await ask()).toEqual(['ask:save', 'ask:discard', 'ask:cancel'])
    await ui.press({ key: 'ask:cancel' })
    expect(await lines()).toEqual(['header:tabs', 'header:actions'])
  })
}

// Every element key under a found node, in drawing order.
const keysIn = (node: unknown): string[] => {
  const out: string[] = []
  const walk = (at: unknown, isRoot: boolean): void => {
    if (at === null || typeof at !== 'object') return
    const n = at as { key?: string; props?: { key?: string }; children?: unknown[] }
    const key = n.key ?? n.props?.key
    if (!isRoot && typeof key === 'string') out.push(key)
    for (const child of n.children ?? []) walk(child, false)
  }
  walk(node, true)

  return out
}

// ------------------------------------------------------------------ Delete

// A root with `src/{x.ts,y.ts}`, `a.txt` and `b.txt`; mounts the pane with
// rm calls and toasts recorded.
const deleting = async ($: Engine, on: On, surface: 'terminal' | 'desktop', root: string) => {
  mock.store(on)
  const calls: string[][] = []
  fake(on, calls, [], [], () => root)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  TREE[root] = [entry('src', 'dir'), entry('a.txt', 'file'), entry('b.txt', 'file')]
  TREE[root + '/src'] = [entry('x.ts', 'file'), entry('y.ts', 'file')]
  FILES[root + '/a.txt'] = 'aaa\n'
  FILES[root + '/b.txt'] = 'bbb\n'
  FILES[root + '/src/x.ts'] = 'x\n'
  FILES[root + '/src/y.ts'] = 'y\n'
  await $.session.start({ cwd: root, surface, isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    props: PROPS,
    requestId: 'ide-explorer',
    viewport: VIEWPORT,
  })
  const bar = async () => (await ui.find({ type: 'Text', text: /^Delete / }))?.text
  const rms = () => calls.filter(argv => argv[0] === 'rm' && argv.includes('--'))

  return { ui, toasts, bar, rms }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: delete removes a file and selects the next sibling`, async ($, on) => {
    const root = '/del1-' + surface
    const { ui, toasts, bar, rms } = await deleting($, on, surface, root)
    // Nothing selected: no row to delete (the root never is one).
    expect(await ui.find({ key: 'delete' })).toBeUndefined()
    await ui.press({ key: `row:${root}/a.txt` })
    expect((await ui.find({ key: 'delete' }))?.props.hotkey).toBe('d')

    await ui.press({ key: 'delete' })
    expect(await bar()).toBe('Delete a.txt?')
    expect(rms()).toEqual([])
    await ui.press({ key: 'delete:confirm' })
    expect(rms()).toEqual([['rm', '-rf', '--', `${root}/a.txt`]])
    expect(await ui.find({ key: `row:${root}/a.txt` })).toBeUndefined()
    expect(await bar()).toBeUndefined()
    expect((await ui.find({ type: 'Code' }))?.text).toContain('bbb')
    expect(toasts.at(-1)).toBe('Deleted a.txt')
  })

  test(`${surface}: delete removes a dir with its children`, async ($, on) => {
    const root = '/del2-' + surface
    const { ui, bar, rms } = await deleting($, on, surface, root)
    await ui.press({ key: `row:${root}/src` })
    expect(await ui.find({ key: `row:${root}/src/x.ts` })).toBeDefined()

    await ui.press({ key: 'delete' })
    expect(await bar()).toBe('Delete src/? (2 entries)')
    await ui.press({ key: 'delete:confirm' })
    expect(rms()).toEqual([['rm', '-rf', '--', `${root}/src`]])
    expect(await ui.find({ key: `row:${root}/src` })).toBeUndefined()
    expect(await ui.find({ key: `row:${root}/src/x.ts` })).toBeUndefined()
    expect(FILES[`${root}/src/x.ts`]).toBeUndefined()
    // the next sibling: a.txt, shown in the preview
    expect((await ui.find({ type: 'Code' }))?.text).toContain('aaa')
  })

  test(`${surface}: cancel removes nothing`, async ($, on) => {
    const root = '/del3-' + surface
    const { ui, bar, rms } = await deleting($, on, surface, root)
    await ui.press({ key: `row:${root}/b.txt` })
    await ui.press({ key: 'delete' })
    await ui.press({ key: 'delete:cancel' })
    expect(await bar()).toBeUndefined()
    expect(rms()).toEqual([])
    expect(FILES[`${root}/b.txt`]).toBe('bbb\n')
    expect(await ui.find({ key: `row:${root}/b.txt` })).toBeDefined()
  })

  test(`${surface}: a failing rm toasts and keeps the row`, async ($, on) => {
    const root = '/del4-' + surface
    const { ui, toasts, bar } = await deleting($, on, surface, root)
    FAIL_RM.add(`${root}/b.txt`)
    await ui.press({ key: `row:${root}/b.txt` })
    await ui.press({ key: 'delete' })
    await ui.press({ key: 'delete:confirm' })
    FAIL_RM.delete(`${root}/b.txt`)
    expect(toasts.at(-1)).toBe(`Delete failed: rm: cannot remove '${root}/b.txt': Permission denied`)
    expect(await bar()).toBeUndefined()
    expect(await ui.find({ key: `row:${root}/b.txt` })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.text).toContain('bbb')
  })

  test(`${surface}: deleting the file in a dirty editor warns, closes it and drops the draft`, async ($, on) => {
    const root = '/del5-' + surface
    const { ui, settle } = await editing($, on, surface, root, { 'a.ts': 'one\n', 'b.ts': 'two\n' })
    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    const draft = draftFile('/home/u', root + '/a.ts')
    expect(FILES[draft]).toBe('xone\n')

    await ui.press({ key: 'delete' })
    expect((await ui.find({ type: 'Text', text: /^Delete / }))?.text).toBe(
      'Delete a.ts? (open in editor, unsaved)',
    )
    // The delete bar is not the unsaved-changes one.
    expect(await ui.find({ key: 'ask:save' })).toBeUndefined()
    await ui.press({ key: 'delete:confirm' })
    await settle()
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    expect(FILES[root + '/a.ts']).toBeUndefined()
    expect(FILES[draft]).toBeUndefined()
    expect(await ui.find({ key: `row:${root}/a.ts` })).toBeUndefined()
    expect((await ui.find({ type: 'Code' }))?.text).toContain('two')
  })

  test(`${surface}: no delete while the unsaved-changes bar is up`, async ($, on) => {
    const root = '/del6-' + surface
    const { ui, settle } = await editing($, on, surface, root, { 'a.ts': 'one\n', 'b.ts': 'two\n' })
    await ui.key({ key: 'x', in: 'editor' })
    await settle()
    await ui.press({ key: `row:${root}/b.ts` })
    expect(await ui.find({ key: 'ask:save' })).toBeDefined()
    expect(await ui.find({ key: 'delete' })).toBeUndefined()
  })

  test(`${surface}: unity mode deletes the .meta in the same rm`, async ($, on) => {
    const root = '/del7-' + surface
    const calls: string[][] = []
    const store = new Map<string, unknown>([['explorer.mode:' + root, 'unity']])
    on('store.get', (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e) => {
      store.set(e.key, e.value)

      return { value: undefined }
    })
    fake(on, calls, [], [], () => root)
    TREE[root] = [entry('Assets', 'dir'), entry('ProjectSettings', 'dir')]
    TREE[root + '/ProjectSettings'] = [entry('ProjectVersion.txt', 'file')]
    TREE[root + '/Assets'] = [entry('a.png', 'file'), entry('a.png.meta', 'file'), entry('b.png', 'file')]
    FILES[root + '/ProjectSettings/ProjectVersion.txt'] = 'm_EditorVersion: 6000.0.0f1\n'
    FILES[root + '/Assets/a.png'] = 'png'
    FILES[root + '/Assets/a.png.meta'] = 'guid: 0123\n'
    FILES[root + '/Assets/b.png'] = 'png'
    await $.session.start({ cwd: root, surface, isInteractive: true })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })
    await ui.press({ key: `row:${root}/Assets` })
    await ui.press({ key: `row:${root}/Assets/a.png` })
    await ui.press({ key: 'delete' })
    expect((await ui.find({ type: 'Text', text: /^Delete / }))?.text).toBe('Delete a.png? + .meta')
    await ui.press({ key: 'delete:confirm' })
    expect(calls.filter(argv => argv[0] === 'rm')).toEqual([
      ['rm', '-rf', '--', `${root}/Assets/a.png`, `${root}/Assets/a.png.meta`],
    ])
    expect(FILES[root + '/Assets/a.png.meta']).toBeUndefined()
    expect(await ui.find({ key: `row:${root}/Assets/b.png` })).toBeDefined()
  })
}
