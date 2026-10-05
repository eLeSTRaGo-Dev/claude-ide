import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ExplorerState } from '../../types'
import {
  MAX_PREVIEW_BYTES,
  clip,
  flatten,
  formatSize,
  isBinary,
  join,
  languageOf,
  parentOf,
  window as windowOf,
} from './tree'
import type { Entry, Mode, Row } from './tree'
import { GIT_COMMAND } from '../git/git'
import { classify, hasRefs, metaGuid, parseGrep, refsOf } from './unity'
import type { GuidIndex, Ref } from './unity'

type On = Parameters<Register>[0]

const PANE = 'ide-explorer'
const MODES: readonly Mode[] = ['files', 'unity']

const explorer = atom<'ide-panes', 'explorer'>(
  { plugin: 'ide-panes', key: 'explorer' } as const,
  { root: '', mode: 'files', expanded: [], offset: 0 } satisfies ExplorerState,
)

// Listings and git-ignore results are cached here, not in $.state: they are
// cheap to rebuild (render re-lists every expanded dir after a reload) and
// $.state should stay small. `refresh` and stage 4 invalidate them.
const listings = new Map<string, Entry[]>()
const ignored = new Set<string>()
// Whether a root holds `ProjectSettings/ProjectVersion.txt`; checked in Unity
// mode only.
const unityRoots = new Map<string, boolean>()
// Rows the tree window shows; set by render, read by the focus hook.
let treeRows = 20

const isMode = (value: unknown): value is Mode =>
  MODES.includes(value as Mode)

const modeKey = (root: string): string => 'explorer.mode:' + root

const ensureListed = async ($: EngineInterface, dir: string): Promise<void> => {
  if (listings.has(dir)) return
  let entries: Entry[] = []
  try {
    const found = await $.fs.list(dir)
    entries = found.map(({ name, kind, size, mtimeMs }) => ({
      name,
      kind,
      size,
      mtimeMs,
    }))
  } catch {
    entries = []
  }
  listings.set(dir, entries)
  await markIgnored($, dir, entries)
}

// One `git check-ignore` per listed dir; a non-zero exit (1: none ignored,
// 128: not a repo) or any failure leaves nothing dimmed.
const markIgnored = async (
  $: EngineInterface,
  dir: string,
  entries: readonly Entry[],
): Promise<void> => {
  if (entries.length === 0) return
  try {
    const ran = await $.process.run(['git', 'check-ignore', '--stdin', '-z'], {
      cwd: dir,
      stdin: entries.map(entry => entry.name).join('\0'),
      timeoutMs: 5000,
    })
    if (ran.exitCode !== 0) return
    for (const name of ran.stdout.split('\0')) {
      if (name !== '') ignored.add(join(dir, name))
    }
  } catch {
    // not a git repo, or git is missing
  }
}

const isUnityProject = async (
  $: EngineInterface,
  root: string,
): Promise<boolean> => {
  const known = unityRoots.get(root)
  if (known !== undefined) return known
  let found = false
  try {
    found = await $.fs.exists(join(root, 'ProjectSettings/ProjectVersion.txt'))
  } catch {
    found = false
  }
  unityRoots.set(root, found)

  return found
}

const TOP = ['Assets', 'Packages']

const walk = async (
  $: EngineInterface,
  dir: string,
  index: Map<string, string>,
): Promise<void> => {
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>> = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.kind === 'dir') {
      await walk($, path, index)
    } else if (entry.kind === 'file' && entry.name.endsWith('.meta')) {
      try {
        const text = await $.fs.read(path)
        const guid = typeof text === 'string' ? metaGuid(text) : undefined
        if (guid !== undefined && !index.has(guid)) {
          index.set(guid, path.slice(0, -'.meta'.length))
        }
      } catch {
        // unreadable .meta: skip
      }
    }
  }
}

const buildIndex = async (
  $: EngineInterface,
  root: string,
): Promise<Map<string, string>> => {
  const dirs: string[] = []
  for (const name of TOP) {
    try {
      if (await $.fs.exists(join(root, name))) dirs.push(name)
    } catch {
      // treat as missing
    }
  }
  if (dirs.length === 0) return new Map()
  try {
    const ran = await $.process.run(
      ['grep', '-r', '--include=*.meta', '-m1', '^guid:', ...dirs],
      { cwd: root, timeoutMs: 20000 },
    )
    // exit 1: no matches; 0: matches. Anything else, or cut output, is not
    // trusted: walk the tree instead.
    if (ran.exitCode <= 1 && !ran.isStdoutTruncated) {
      return parseGrep(ran.stdout, root)
    }
  } catch {
    // grep missing or timed out
  }
  const index = new Map<string, string>()
  for (const name of dirs) await walk($, join(root, name), index)

  return index
}

// Module cache (not $.state): rebuilt lazily after a reload or `refresh`.
const indexes = new Map<string, Promise<Map<string, string>>>()

const guidIndex = (
  $: EngineInterface,
  root: string,
): Promise<GuidIndex> => {
  let built = indexes.get(root)
  if (built === undefined) {
    built = buildIndex($, root)
    indexes.set(root, built)
  }

  return built
}


const rootOf = async (
  $: EngineInterface,
  state: ExplorerState,
): Promise<string> => (state.root === '' ? await $.session.cwd() : state.root)

const setMode = async ($: EngineInterface, mode: Mode): Promise<void> => {
  const state = await read($, explorer)
  const root = await rootOf($, state)
  await update($, explorer, s => ({ ...s, root, mode, offset: 0 }))
  await $.store.set(modeKey(root), mode)
}

const press = async ($: EngineInterface, row: Row): Promise<void> => {
  await update($, explorer, s => ({
    ...s,
    selected: row.path,
    expanded:
      row.kind !== 'dir'
        ? s.expanded
        : s.expanded.includes(row.path)
          ? s.expanded.filter(path => path !== row.path)
          : [...s.expanded, row.path],
  }))
}

type Preview =
  | {
      type: 'code'
      path: string
      language?: string
      source: string
      refs: Ref[]
    }
  | { type: 'text'; lines: string[] }

// Select `path` and expand every dir between the root and it; the window
// offset is recomputed so the row is visible.
const jump = async ($: EngineInterface, path: string): Promise<void> => {
  const state = await read($, explorer)
  const root = await rootOf($, state)
  const dirs: string[] = []
  for (let dir = parentOf(path); dir.length > root.length; dir = parentOf(dir)) {
    dirs.push(dir)
  }
  dirs.reverse()
  const expanded = [...state.expanded, ...dirs.filter(d => !state.expanded.includes(d))]
  await Promise.all([root, ...expanded].map(dir => ensureListed($, dir)))
  const rows = flatten(listings, new Set(expanded), root, { mode: state.mode })
  const win = windowOf(
    rows,
    rows.findIndex(row => row.path === path),
    treeRows,
    state.offset,
  )
  await update($, explorer, s => ({
    ...s,
    selected: path,
    expanded,
    offset: win.offset,
  }))
}

const metadata = (name: string, size: number, mtimeMs: number): string[] => [
  name,
  formatSize(size),
  'modified ' + new Date(mtimeMs).toISOString(),
]

const RANK = { resolved: 0, unresolved: 1, builtin: 2 } as const

const loadPreview = async (
  $: EngineInterface,
  row: Row,
  lines: number,
  isUnity: boolean,
  root: string,
): Promise<Preview> => {
  if (row.kind === 'dir') {
    await ensureListed($, row.path)
    const entries = listings.get(row.path) ?? []
    const files = entries.filter(entry => entry.kind === 'file')
    const total = files.reduce((sum, entry) => sum + entry.size, 0)

    return {
      type: 'text',
      lines: [
        row.name + '/',
        `${entries.length} entries`,
        `${formatSize(total)} in ${files.length} files`,
      ],
    }
  }
  try {
    const stat = await $.fs.stat(row.path)
    if (stat.kind !== 'file' || stat.size > MAX_PREVIEW_BYTES) {
      return { type: 'text', lines: metadata(row.name, stat.size, stat.mtimeMs) }
    }
    const text = await $.fs.read(row.path)
    if (typeof text !== 'string' || isBinary(text)) {
      return { type: 'text', lines: metadata(row.name, stat.size, stat.mtimeMs) }
    }

    const refs =
      isUnity && hasRefs(row.name)
        ? classify(refsOf(text), await guidIndex($, root))
        : []
    refs.sort((a, b) => RANK[a.kind] - RANK[b.kind])

    return {
      type: 'code',
      path: row.path,
      language: languageOf(row.name),
      source: clip(text, lines),
      refs,
    }
  } catch {
    return { type: 'text', lines: [row.name, 'cannot read'] }
  }
}

export const register = (on: On): void => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'explorer',
      description: 'Open the project explorer',
      argumentHint: '[mode unity|files]',
    })
    // the git view's command: one session.start hook per plugin
    await $.command.register(GIT_COMMAND)
    const saved = await $.store.get(modeKey(e.cwd))
    await update($, explorer, s => {
      const isSame = s.root === '' || s.root === e.cwd

      return {
        ...s,
        root: e.cwd,
        mode: isMode(saved) ? saved : 'files',
        expanded: isSame ? s.expanded : [],
        selected: isSame ? s.selected : undefined,
        offset: isSame ? s.offset : 0,
      }
    })

    return next(e)
  })

  on('command.run', { command: 'explorer' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    if (words.length > 0) {
      const want = words[0] === 'mode' ? words[1] : words[0]
      if (!isMode(want)) return { text: 'Usage: /explorer [mode unity|files]' }
      await setMode($, want)
    }
    await $.ui.open({ id: PANE, title: 'Explorer', focus: true })
    const { mode } = await read($, explorer)

    return { text: `Explorer opened (${mode} mode).` }
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const element = e.element
    if (element !== undefined && element.startsWith('row:')) {
      const path = element.slice(4)
      const state = await read($, explorer)
      const root = await rootOf($, state)
      const rows = flatten(listings, new Set(state.expanded), root, {
        mode: state.mode,
      })
      const win = windowOf(
        rows,
        rows.findIndex(row => row.path === path),
        treeRows,
        state.offset,
      )
      if (state.selected !== path || state.offset !== win.offset) {
        await update($, explorer, s => ({
          ...s,
          selected: path,
          offset: win.offset,
        }))
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const state = await read($, explorer)
    const root = await rootOf($, state)
    const expanded = new Set(state.expanded)
    await Promise.all([root, ...expanded].map(dir => ensureListed($, dir)))
    const rows = flatten(listings, expanded, root, { mode: state.mode })
    const isNotUnity =
      state.mode === 'unity' && !(await isUnityProject($, root))
    const index = rows.findIndex(row => row.path === state.selected)
    const bodyRows = e.props.scroll.bodyRows
    treeRows = Math.max(3, bodyRows - 2)
    const win = windowOf(rows, index, treeRows, state.offset)
    const current = index < 0 ? undefined : rows[index]
    const isUnity = state.mode === 'unity' && !isNotUnity
    const preview =
      current === undefined
        ? undefined
        : await loadPreview($, current, treeRows, isUnity, root)
    // Reference section: a header line, up to `shown` refs and a "+n more"
    // line; Code gets the rest of the pane rows.
    const refs = preview?.type === 'code' ? preview.refs : []
    const shown =
      refs.length === 0
        ? 0
        : Math.min(refs.length, Math.max(1, Math.floor((treeRows - 1) / 2)))
    const hidden = refs.length - shown
    const refLines = refs.length === 0 ? 0 : 1 + shown + (hidden > 0 ? 1 : 0)
    const focusKey = current?.path ?? rows[0]?.path

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>Explorer [{state.mode === 'unity' ? 'Unity' : 'Files'}]</Text>
          <Text dimColor wrap="truncate-start">
            {root}
          </Text>
          {isNotUnity && (
            <Text dimColor>
              not a Unity project
            </Text>
          )}
          <Button
            key="mode"
            label={'mode: ' + state.mode}
            onPress={() =>
              setMode($, state.mode === 'files' ? 'unity' : 'files')
            }
          />
          <Button
            key="refresh"
            label="refresh"
            onPress={() => {
              listings.clear()
              ignored.clear()
              unityRoots.clear()
              indexes.clear()
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box flexDirection="column" width="35%">
            {rows.length === 0 && <Text dimColor>(empty)</Text>}
            {win.rows.map(row => (
              <Button
                key={'row:' + row.path}
                plain
                dimColor={ignored.has(row.path)}
                autoFocus={row.path === focusKey ? true : undefined}
                label={
                  (row.path === state.selected ? '>' : ' ') +
                  '  '.repeat(row.depth) +
                  (row.kind === 'dir' ? (row.isExpanded ? '▾ ' : '▸ ') : '  ') +
                  row.name
                }
                onPress={() => press($, row)}
              />
            ))}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {preview === undefined && <Text dimColor>Select a file.</Text>}
            {preview?.type === 'text' &&
              preview.lines.map(line => <Text>{line}</Text>)}
            {preview?.type === 'code' && (
              <Code
                source={clip(preview.source, Math.max(1, treeRows - refLines))}
                path={preview.path}
                language={preview.language}
                startLine={1}
                wrap="truncate-end"
              />
            )}
            {refs.length > 0 && <Text bold>References ({refs.length})</Text>}
            {refs.slice(0, shown).map(ref =>
              ref.kind === 'resolved' ? (
                <Button
                  key={'ref:' + ref.path}
                  plain
                  label={ref.path.startsWith(root + '/') ? ref.path.slice(root.length + 1) : ref.path}
                  onPress={() => jump($, ref.path)}
                />
              ) : (
                <Text dimColor wrap="truncate-end">
                  {ref.guid} {ref.kind === 'builtin' ? 'Unity built-in' : 'package or missing'}
                </Text>
              ),
            )}
            {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
          </Box>
        </Box>
      </Box>
    )
  })
}
