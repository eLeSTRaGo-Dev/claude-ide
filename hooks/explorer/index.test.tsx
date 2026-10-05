import { expect, mock, test } from 'claude-code/testing'
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

// Answers fs, git, session and command plumbing beneath the plugin.
const fake = (
  on: On,
  calls: string[][] = [],
  opened: unknown[] = [],
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
  on('fs.read', (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error('ENOENT ' + e.path)

    return { value: text }
  })
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
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
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
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
}

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
    props: { ...PROPS, scroll: { offset: 0, bodyRows: 6 } },
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
