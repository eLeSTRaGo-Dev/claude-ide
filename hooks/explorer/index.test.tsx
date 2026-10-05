import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

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

// `grep` output per cwd, for the Unity GUID index.
const GREP: Record<string, string> = {}

// Answers fs, git, session and command plumbing beneath the plugin.
const fake = (
  on: On,
  calls: string[][] = [],
  opened: unknown[] = [],
  names: string[] = [],
): void => {
  on('fs.list', (_$, e) => ({ value: TREE[e.path] ?? [] }))
  on('fs.stat', (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error('ENOENT ' + e.path)

    return {
      value: {
        kind: 'file' as const,
        size: text.length,
        mtimeMs: 1_700_000_000_000,
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
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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

    expect(await ui.find({ type: 'Text', text: /Files/ })).toBeDefined()
    await ui.press({ key: 'mode' })
    expect(store.get('explorer.mode:' + CWD)).toBe('unity')
    expect(await ui.find({ type: 'Text', text: /Unity/ })).toBeDefined()

    await $.session.start(start(surface))
    expect(await ui.find({ type: 'Text', text: /Unity/ })).toBeDefined()
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
    fake(on)
    await $.session.start({ ...start(surface), cwd: '/plain' })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      props: PROPS,
      requestId: 'ide-explorer',
      viewport: VIEWPORT,
    })

    expect(await ui.find({ type: 'Text', text: /\[Unity\]/ })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /not a Unity project/ }),
    ).toBeDefined()

    await $.session.start({ ...start(surface), cwd: '/game' })
    expect(await ui.find({ type: 'Text', text: /\[Unity\]/ })).toBeDefined()
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
    fake(on)
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
  fake(on)
  const names = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`)
  TREE['/big'] = names.map(name => entry(name, 'file'))
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: '/big', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    props: { ...PROPS, scroll: { offset: 0, bodyRows: 7 } },
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

test('command opens the pane and sets the mode', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  const opened: unknown[] = []
  fake(on, [], opened)
  await $.session.start(start('terminal'))
  const ran = await $.command.run({
    command: 'explorer',
    args: 'mode unity',
    origin: { kind: 'composer' },
    presentation: PRESENTATION,
  })

  expect(ran.text).toContain('unity')
  expect(store.get('explorer.mode:' + CWD)).toBe('unity')
  expect(opened).toEqual([{ id: 'ide-explorer', focus: true }])
  const bad = await $.command.run({
    command: 'explorer',
    args: 'mode nope',
    origin: { kind: 'composer' },
    presentation: PRESENTATION,
  })
  expect(bad.text).toContain('Usage')
})

test('session.start registers both /explorer and /git', async ($, on) => {
  mock.store(on)
  const names: string[] = []
  fake(on, [], [], names)
  await $.session.start(start('terminal'))

  expect(names.sort()).toEqual(['explorer', 'git'])
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

  test(`${surface}: hotkeys m and r are set and work`, async ($, on) => {
    mock.store(on)
    fake(on)
    await $.session.start(start(surface))
    const ui = await mount($)

    const mode = await ui.find({ key: 'mode' })
    expect(mode?.props.hotkey).toBe('m')
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    await ui.press({ key: 'mode' })
    expect(await ui.find({ type: 'Text', text: /Unity/ })).toBeDefined()
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
    fake(on)
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
    fake(on)
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
      props: { ...PROPS, scroll: { offset: 0, bodyRows: 12 } },
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
