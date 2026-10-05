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
import { GIT_PANE } from '../git/git'
import { borderOf, lastAgentColor, parseColorAnswer } from '../shared/color'
import { scrollbar } from '../shared/scrollbar'
import {
  classify,
  hasRefs,
  isIndexCommand,
  metaGuid,
  parseGrep,
  refsOf,
} from './unity'
import type { GuidIndex, Ref } from './unity'

type On = Parameters<Register>[0]

// Black behind the whole pane, as the console default.
const BACKGROUND = 'black'
// The `/color` of this session; the explorer's hooks keep it current.
const sessionColor = atom<'ide-panes', 'sessionColor'>(
  { plugin: 'ide-panes', key: 'sessionColor' } as const,
  '',
)
const PANE = 'ide-explorer'
const MODES: readonly Mode[] = ['files', 'unity']

const explorer = atom<'ide-panes', 'explorer'>(
  { plugin: 'ide-panes', key: 'explorer' } as const,
  { root: '', mode: 'files', expanded: [], offset: 0, previewOffset: 0 } satisfies ExplorerState,
)

// Listings and git-ignore results are cached here, not in $.state: they are
// cheap to rebuild (render re-lists every expanded dir after a reload) and
// $.state should stay small. `refresh` and the tool.call hook invalidate them.
const listings = new Map<string, Entry[]>()
const ignored = new Set<string>()
// Whether a root holds `ProjectSettings/ProjectVersion.txt`; checked in Unity
// mode only.
const unityRoots = new Map<string, boolean>()
// Rows the tree window shows; set by render, read by the focus hook.
let treeRows = 20
// The last drawing's geometry, set by render and read by the scroll hook: the
// column where the preview starts, each section's furthest offset and the
// rows the preview shows.
const view = { treeEnd: 0, treeMax: 0, previewMax: 0, previewRows: 1 }

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max))

const isMode = (value: unknown): value is Mode =>
  MODES.includes(value as Mode)

// The session's `/color` as the transcript last recorded it (`agent-color`
// entries); nothing recorded leaves the current value.
// Background of the selected row (the file in the preview); the cursor is
// the engine's focus ring, drawn inverse on top.
const SELECTED = 'ansi256(238)'

const syncColor = async ($: EngineInterface): Promise<void> => {
  try {
    const id = await $.session.id()
    const ran = await $.process.run(
      ['sh', '-c', 'grep -h \'"agentColor"\' "$HOME"/.claude/projects/*/"$1".jsonl', 'sh', id],
      { timeoutMs: 5000 },
    )
    const name = lastAgentColor(ran.stdout)
    if (name !== undefined) await update($, sessionColor, () => name)
  } catch {
    // no transcript yet
  }
}

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

// Enter or a click: the row becomes the selection (shown in the preview);
// a dir also opens or closes.
const press = async ($: EngineInterface, row: Row): Promise<void> => {
  await update($, explorer, s => ({
    ...s,
    cursor: row.path,
    selected: row.path,
    previewOffset: s.selected === row.path ? s.previewOffset : 0,
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
      lines: string[]
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
    cursor: path,
    previewOffset: s.selected === path ? s.previewOffset : 0,
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
      lines: text.replace(/\n$/, '').split('\n'),
      refs,
    }
  } catch {
    return { type: 'text', lines: [row.name, 'cannot read'] }
  }
}

// Drops the cached listing of the file's dir and of the file itself.
const dropFile = (file: string): void => {
  for (const path of [file, parentOf(file)]) {
    listings.delete(path)
    ignored.delete(path)
  }
  if (file.endsWith('.meta')) indexes.clear()
}

export const register = (on: On): void => {
  on('session.start', async ($, e, next) => {
    // The plugin's one command (one session.start hook per plugin).
    await $.command.register({
      name: 'ide-panels',
      description: 'Open every ide-panes pane (explorer and git)',
    })
    const saved = await $.store.get(modeKey(e.cwd))
    await update($, explorer, s => {
      const isSame = s.root === '' || s.root === e.cwd

      return {
        ...s,
        root: e.cwd,
        mode: isMode(saved) ? saved : 'files',
        expanded: isSame ? s.expanded : [],
        selected: isSame ? s.selected : undefined,
        cursor: isSame ? s.cursor : undefined,
        offset: isSame ? s.offset : 0,
        previewOffset: isSame ? (s.previewOffset ?? 0) : 0,
      }
    })
    // A resumed session keeps its `/color`.
    await syncColor($)

    return next(e)
  })

  // Follow `/color` so the section frames match the prompt bar.
  on('command.run', { command: 'color' }, async ($, e, next) => {
    const ran = await next(e)
    // The answer names the color when the command prints it; otherwise (a
    // random pick, a panel) the transcript has it by now.
    const name = parseColorAnswer(ran.text ?? '')
    if (name !== undefined) await update($, sessionColor, () => name)
    else await syncColor($)
    $.ui.invalidate('ui.render')

    return ran
  })

  // Refresh after Claude changes files; never denies or rewrites the call.
  // One hook per tool: the validator refuses two unmatched tool.call hooks.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    dropFile(e.file_path)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    dropFile(e.file_path)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    dropFile(e.notebook_path)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    listings.clear()
    ignored.clear()
    unityRoots.clear()
    if (isIndexCommand(e.command)) indexes.clear()
    $.ui.invalidate('ui.render')

    return ran
  })

  on('command.run', { command: 'ide-panels' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Explorer' })
    await $.ui.open({ id: GIT_PANE, title: 'Git' })
    await $.ui.open({ id: PANE, title: 'Explorer', focus: true })

    return { text: 'Opened Explorer and Git (ctrl+x tab, or click a tab, to switch).' }
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
      // The focus ring is the cursor; the selection moves only on Enter.
      if (state.cursor !== path || state.offset !== win.offset) {
        await update($, explorer, s => ({ ...s, cursor: path, offset: win.offset }))
      }
    }

    return next(e)
  })

  // Wheel: scrolls the section under the pointer, the selection stays. Keys:
  // an arrow moves the selection, a page key scrolls the preview. The engine's
  // own window is never used, so the hook always answers `{}` without `next`.
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    const state = await read($, explorer)
    const pointer = e.pointer
    if (pointer !== undefined) {
      if (pointer.column < view.treeEnd) {
        const offset = clamp(state.offset + e.by, view.treeMax)
        if (offset !== state.offset) await update($, explorer, s => ({ ...s, offset }))
      } else {
        const was = state.previewOffset ?? 0
        const previewOffset = clamp(was + e.by, view.previewMax)
        if (previewOffset !== was) {
          await update($, explorer, s => ({ ...s, previewOffset }))
        }
      }
    } else if (Math.abs(e.by) === 1) {
      const root = await rootOf($, state)
      const rows = flatten(listings, new Set(state.expanded), root, {
        mode: state.mode,
      })
      const at = rows.findIndex(row => row.path === (state.cursor ?? state.selected))
      const target = rows[clamp(at < 0 ? 0 : at + e.by, rows.length - 1)]
      if (target !== undefined && target.path !== state.cursor) {
        const win = windowOf(
          rows,
          rows.indexOf(target),
          treeRows,
          state.offset,
        )
        await update($, explorer, s => ({ ...s, cursor: target.path, offset: win.offset }))
        await $.ui.focus({ requestId: PANE, key: 'row:' + target.path })
      }
    } else {
      const was = state.previewOffset ?? 0
      const previewOffset = clamp(
        was + Math.sign(e.by) * view.previewRows,
        view.previewMax,
      )
      if (previewOffset !== was) {
        await update($, explorer, s => ({ ...s, previewOffset }))
      }
    }
    $.ui.invalidate('ui.render')

    return {}
  })

  // A scrollbar dragged: the window moves, the selection stays (as the wheel).
  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as { offset?: unknown } | null
    const to = typeof data?.offset === 'number' ? data.offset : NaN
    if (!Number.isFinite(to)) return {}
    if (e.element === 'sb:tree') {
      const offset = clamp(Math.round(to), view.treeMax)
      await update($, explorer, s => ({ ...s, offset }))
    } else if (e.element === 'sb:preview') {
      const previewOffset = clamp(Math.round(to), view.previewMax)
      await update($, explorer, s => ({ ...s, previewOffset }))
    } else {
      return {}
    }
    $.ui.invalidate('ui.render')

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Code } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    const state = await read($, explorer)
    const root = await rootOf($, state)
    const expanded = new Set(state.expanded)
    await Promise.all([root, ...expanded].map(dir => ensureListed($, dir)))
    const rows = flatten(listings, expanded, root, { mode: state.mode })
    const isNotUnity =
      state.mode === 'unity' && !(await isUnityProject($, root))
    const index = rows.findIndex(row => row.path === state.selected)
    const bodyRows = e.props.scroll.bodyRows
    // One header row, then the bordered sections: 2 rows of frame each.
    const sectionRows = Math.max(5, bodyRows - 1)
    // Each section is framed in the session color.
    const border = borderOf(await read($, sessionColor))
    treeRows = sectionRows - 2
    // The wheel moves the window off the selection, so it only clamps here.
    const win = windowOf(rows, -1, treeRows, state.offset)
    const current = index < 0 ? undefined : rows[index]
    const isUnity = state.mode === 'unity' && !isNotUnity
    const preview =
      current === undefined
        ? undefined
        : await loadPreview($, current, isUnity, root)
    // Reference section: a header line, up to `shown` refs and a "+n more"
    // line; Code gets the rest of the pane rows.
    const refs = preview?.type === 'code' ? preview.refs : []
    const shown =
      refs.length === 0
        ? 0
        : Math.min(refs.length, Math.max(1, Math.floor((treeRows - 1) / 2)))
    const hidden = refs.length - shown
    const refLines = refs.length === 0 ? 0 : 1 + shown + (hidden > 0 ? 1 : 0)
    // The focus ring starts on the cursor (else the selection). A row scrolled
    // out of the window is not focused: autoFocus would move the cursor to
    // whatever row the wheel brought in.
    const home = state.cursor ?? current?.path
    const focusKey =
      home === undefined
        ? win.rows[0]?.path
        : win.rows.some(row => row.path === home)
          ? home
          : undefined
    const previewTotal = preview?.type === 'code' ? preview.lines.length : 0
    const previewRows = Math.max(1, treeRows - refLines)
    const previewOffset = clamp(state.previewOffset ?? 0, previewTotal - previewRows)
    view.treeEnd = Math.floor(e.props.bodyColumns * 0.35)
    view.treeMax = Math.max(0, rows.length - treeRows)
    view.previewMax = Math.max(0, previewTotal - previewRows)
    view.previewRows = previewRows
    const bar = (cells: string[]) => (
      <Box flexDirection="column" width={1} flexShrink={0}>
        {cells.map((cell, i) =>
          cell === '┃' ? (
            <Text key={'bar:' + i} color={border.borderColor}>
              {cell}
            </Text>
          ) : (
            <Text key={'bar:' + i} dimColor>
              {cell}
            </Text>
          ),
        )}
      </Box>
    )

    // Draggable on surfaces that draw a `Client`, the Text column elsewhere.
    const dragBar = (key: string, total: number, rows: number, offset: number) =>
      Client === undefined || total <= rows ? (
        bar(scrollbar(total, rows, offset, rows))
      ) : (
        <Client
          key={key}
          module="../shared/scrollbar-client.tsx"
          props={{ total, visible: rows, offset, height: rows, color: border.borderColor }}
          width={1}
          height={rows}
        />
      )

    return (
      <Box flexDirection="column" width="100%" minHeight={e.props.scroll.bodyRows} backgroundColor={BACKGROUND}>
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
            hotkey="m"
            label={'mode: ' + state.mode + ' (m)'}
            onPress={() =>
              setMode($, state.mode === 'files' ? 'unity' : 'files')
            }
          />
          <Button
            key="refresh"
            hotkey="r"
            label="refresh (r)"
            onPress={() => {
              listings.clear()
              ignored.clear()
              unityRoots.clear()
              indexes.clear()
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
        <Box flexDirection="row">
          <Box flexDirection="row" width="35%" height={sectionRows} {...border}>
            <Box flexDirection="column" flexGrow={1}>
            {rows.length === 0 && <Text dimColor>(empty)</Text>}
            {win.rows.map(row => (
              // Selection mark, a dim rail per depth level, then the row.
              <Box
                key={'line:' + row.path}
                flexDirection="row"
                backgroundColor={row.path === state.selected ? SELECTED : undefined}
              >
                <Text color={border.borderColor}>
                  {row.path === state.selected ? '▌' : ' '}
                </Text>
                {row.depth > 0 && <Text dimColor>{'│ '.repeat(row.depth)}</Text>}
                <Button
                  key={'row:' + row.path}
                  plain
                  dimColor={ignored.has(row.path)}
                  autoFocus={row.path === focusKey ? true : undefined}
                  label={
                    (row.kind === 'dir'
                      ? (row.isExpanded ? '▾ ' : '▸ ') + row.name + '/'
                      : '  ' + row.name)
                  }
                  onPress={() => press($, row)}
                />
              </Box>
            ))}
            </Box>
            {dragBar('sb:tree', rows.length, treeRows, win.offset)}
          </Box>
          <Box flexDirection="row" flexGrow={1} height={sectionRows} {...border}>
            <Box flexDirection="column" flexGrow={1}>
            {preview === undefined && <Text dimColor>Select a file.</Text>}
            {preview?.type === 'text' &&
              preview.lines.map(line => <Text>{line}</Text>)}
            {preview?.type === 'code' && (
              <Code
                source={clip(
                  preview.lines
                    .slice(previewOffset, previewOffset + previewRows)
                    .join('\n'),
                  previewRows,
                )}
                path={preview.path}
                language={preview.language}
                startLine={previewOffset + 1}
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
            {dragBar('sb:preview', previewTotal, previewRows, previewOffset)}
          </Box>
        </Box>
      </Box>
    )
  })
}
