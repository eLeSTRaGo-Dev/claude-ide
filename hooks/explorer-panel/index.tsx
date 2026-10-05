import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { ExplorerState } from '../../types'
import { TRANSFER_CHUNK, accept, draftFile, parseChunk } from './edit'
import type { EditorProps, Incoming } from './edit'
import { KEYMAPS, chunks, mergeKeymap } from './editor'
import type { Action, Keymap } from './editor'
import {
  MAX_PREVIEW_BYTES,
  afterDelete,
  clip,
  deleteTarget,
  flatten,
  formatSize,
  isBinary,
  join,
  languageOf,
  newFilePath,
  parentOf,
  window as windowOf,
} from './tree'
import type { Entry, Mode, Row } from './tree'
import { GIT_PANE, changeCounts, shortDir, parseStatus, statusArgv } from '../git-panel/git'
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
// The footer's branch and change counts per root; undefined `branch`: not a
// repo. Cleared with the listings.
const footers = new Map<
  string,
  { branch?: string; counts: { added: number; modified: number; deleted: number } }
>()
// Rows the tree window shows; set by render, read by the focus hook.
let treeRows = 20
// The last drawing's geometry, set by render and read by the scroll hook: the
// column where the preview starts, each section's furthest offset and the
// rows the preview shows; the Edit region and whether it was drawn (read by
// the scroll and editor message hooks too).
const view = {
  treeEnd: 0,
  treeMax: 0,
  previewMax: 0,
  previewRows: 1,
  editRows: 1,
  editColumns: 1,
  isEditDrawn: false,
}

type Edit = NonNullable<ExplorerState['edit']>

// The Edit section's side of the editor client's protocol (editor-client.tsx).
// Module-level: a reload bumps `edit.version` (session.start), so the client
// asks for the text again and nothing here has to survive one.
const editing = {
  version: -1, // the `edit.version` the parts below were read for
  parts: [] as string[], // the text in chunks; emptied once all were delivered
  total: 0,
  index: -1, // the chunk in the props; `total`: all delivered
  isDraft: false,
  ack: '', // id of the client's last message taken
  saved: 0, // seq of the last save written
  isDirty: false, // as the client last said
  command: '',
  commandSeq: 0,
  by: 0,
  incoming: undefined as Incoming | undefined,
}
// The merged keymap (register's options) and what was wrong with the overrides.
let keymap: Keymap = KEYMAPS.jetbrains
let keymapErrors: string[] = []
// The dir the `new` name field creates in; undefined: the field is not shown.
// Module-level: a reload just drops the field.
let naming: string | undefined

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

// Read-only git call in `cwd`; undefined on a non-zero exit or any failure.
const gitOut = async (
  $: EngineInterface,
  cwd: string,
  argv: string[],
): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs: 15000 })

    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch {
    return undefined
  }
}

// The branch (a short sha when detached) and the working tree's change
// counts for the footer; no branch outside a repo.
const footerOf = async ($: EngineInterface, root: string) => {
  let footer = footers.get(root)
  if (footer === undefined) {
    let branch = (await gitOut($, root, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
    if (branch === 'HEAD') {
      branch = (await gitOut($, root, ['git', 'rev-parse', '--short', 'HEAD']))?.trim()
    }
    const status = branch === undefined ? undefined : await gitOut($, root, statusArgv())
    footer = {
      branch: branch === '' ? undefined : branch,
      counts: changeCounts(parseStatus(status ?? '')),
    }
    footers.set(root, footer)
  }

  return footer
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
): Promise<string> => (state.root === '' ? await $.session.root() : state.root)

// Leaving the editor for another file or mode: a dirty buffer asks first
// (true: wait for the bar), a clean one just closes.
const leaveEdit = async (
  $: EngineInterface,
  confirm: 'select' | 'mode',
  pending: string,
): Promise<boolean> => {
  if ((await read($, explorer)).edit === undefined) return false
  if (await guarded($, confirm, pending)) return true
  await clearEdit($)

  return false
}

const setMode = async ($: EngineInterface, mode: Mode): Promise<void> => {
  if (await leaveEdit($, 'mode', mode)) return
  const state = await read($, explorer)
  const root = await rootOf($, state)
  await update($, explorer, s => ({ ...s, root, mode, offset: 0 }))
  await $.store.set(modeKey(root), mode)
}

// Enter or a click: the row becomes the selection (shown in the preview);
// a dir also opens or closes.
const press = async ($: EngineInterface, row: Row): Promise<void> => {
  const edit = (await read($, explorer)).edit
  if (edit !== undefined && (row.kind === 'dir' || row.path === edit.path)) {
    // While editing, a dir only opens or closes and the selection stays.
    await update($, explorer, s => ({
      ...s,
      cursor: row.path,
      expanded:
        row.kind !== 'dir'
          ? s.expanded
          : s.expanded.includes(row.path)
            ? s.expanded.filter(path => path !== row.path)
            : [...s.expanded, row.path],
    }))

    return
  }
  if (await leaveEdit($, 'select', row.path)) return
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

const copyName = async (
  $: EngineInterface,
  name: string,
  surface: Parameters<EngineInterface['ui']['copy']>[0]['surface'],
): Promise<void> => {
  const text = 'Explorer › ' + name
  const copied = await $.ui.copy({ text, surface })
  await $.ui.toast(
    copied.isCopied ? `Copied: ${text}` : `Copy failed: ${copied.reason}`,
  )
}

// Select `path` and expand every dir between the root and it; the window
// offset is recomputed so the row is visible.
const jump = async ($: EngineInterface, path: string): Promise<void> => {
  if ((await read($, explorer)).edit?.path !== path && (await leaveEdit($, 'select', path))) return
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
  footers.clear()
  if (file.endsWith('.meta')) indexes.clear()
}

// ------------------------------------------------------------ Edit section

// Unsaved: the client said so, a draft holds text the file does not, or the
// file is new (created on its first save).
const isEditDirty = (edit: Edit | undefined): boolean =>
  edit !== undefined && (editing.isDirty || edit.hasDraft === true || edit.isNew === true)

const resetEditing = (): void => {
  editing.version = -1
  editing.parts = []
  editing.total = 0
  editing.index = -1
  editing.isDraft = false
  editing.isDirty = false
  editing.incoming = undefined
}

const statOf = async ($: EngineInterface, path: string) => {
  try {
    return await $.fs.stat(path)
  } catch {
    return undefined
  }
}

const draftOf = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  const home = await $.env.get('HOME')

  return home === undefined || home === '' ? undefined : draftFile(home, path)
}

// There is no `$.fs` delete.
const removeDraft = async ($: EngineInterface, path: string): Promise<void> => {
  const draft = await draftOf($, path)
  if (draft === undefined) return
  try {
    await $.process.run(['rm', '-f', draft], { timeoutMs: 5000 })
  } catch {
    // left behind: an older draft is never restored over a newer file
  }
}

// Merges into `edit` while it is still the given version.
const patchEdit = ($: EngineInterface, version: number, patch: Partial<Edit>) =>
  update($, explorer, s =>
    s.edit === undefined || s.edit.version !== version ? s : { ...s, edit: { ...s.edit, ...patch } },
  )

const clearEdit = async ($: EngineInterface): Promise<void> => {
  resetEditing()
  await update($, explorer, s => ({ ...s, edit: undefined }))
}

// A border or bar Button's action for the client, through its props.
const sendCommand = ($: EngineInterface, command: string, by = 0): void => {
  editing.command = command
  editing.by = by
  editing.commandSeq += 1
  $.ui.invalidate('ui.render')
}

const toast = async ($: EngineInterface, text: string): Promise<void> => {
  try {
    await $.ui.toast(text)
  } catch {
    // no surface to show it
  }
}

const startEdit = async ($: EngineInterface, path: string): Promise<void> => {
  const stat = await statOf($, path)
  resetEditing()
  await update($, explorer, s => ({
    ...s,
    selected: path,
    edit: {
      path,
      // Unique across edits, so a chunk of an earlier one is never taken.
      version: Math.max(Date.now(), (s.edit?.version ?? 0) + 1),
      baseMtime: stat?.mtimeMs,
      isNew: stat === undefined ? true : undefined,
    },
  }))
}

// Reads the text of `edit.version`: the draft when it is newer than the file
// (how a reload or a restart restores unsaved text), else the file; a file
// not there yet is empty. A file that cannot be read closes the editor
// rather than offer an empty buffer to save over it.
const loadEdit = async ($: EngineInterface, edit: Edit): Promise<boolean> => {
  const draft = await draftOf($, edit.path)
  const file = await statOf($, edit.path)
  const kept = draft === undefined ? undefined : await statOf($, draft)
  const isDraft =
    draft !== undefined && kept !== undefined && (file === undefined || kept.mtimeMs > file.mtimeMs)
  let text = ''
  try {
    if (isDraft || file !== undefined) {
      const got = await $.fs.read(isDraft ? draft : edit.path)
      if (typeof got !== 'string') throw new Error('not text')
      text = got
    }
  } catch {
    await clearEdit($)
    await toast($, `Cannot edit ${edit.path}`)

    return false
  }
  editing.version = edit.version
  editing.parts = chunks(text, TRANSFER_CHUNK)
  editing.total = editing.parts.length
  editing.index = 0
  editing.isDraft = isDraft
  editing.isDirty = isDraft
  editing.incoming = undefined
  await patchEdit($, edit.version, {
    // A draft keeps the mtime it was based on, so a save still sees a change.
    baseMtime: isDraft ? (edit.baseMtime ?? file?.mtimeMs) : file?.mtimeMs,
    hasDraft: isDraft ? true : undefined,
  })

  return true
}

const editorProps = (edit: Edit, color: string): EditorProps => {
  const isLoaded = editing.version === edit.version

  return {
    path: edit.path,
    language: languageOf(edit.path.slice(edit.path.lastIndexOf('/') + 1)) ?? '',
    color,
    keymap,
    rows: view.editRows,
    columns: view.editColumns,
    version: edit.version,
    chunk: isLoaded ? (editing.parts[editing.index] ?? '') : '',
    index: isLoaded ? editing.index : -1,
    total: isLoaded ? editing.total : 0,
    isDraft: isLoaded && editing.isDraft,
    ack: editing.ack,
    saved: editing.saved,
    command: editing.command,
    commandSeq: editing.commandSeq,
    by: editing.by,
  }
}

// The one dirty check: true when the action waits for the unsaved-changes
// bar (save / discard / cancel), which then runs it through `finish`.
const guarded = async (
  $: EngineInterface,
  confirm: NonNullable<Edit['confirm']>,
  pending?: string,
): Promise<boolean> => {
  const edit = (await read($, explorer)).edit
  if (!isEditDirty(edit)) return false
  await patchEdit($, edit!.version, { confirm, pending })
  $.ui.invalidate('ui.render')

  return true
}

// What the unsaved-changes bar held back, once saved or discarded.
const finish = async (
  $: EngineInterface,
  confirm: Edit['confirm'],
  pending: string | undefined,
): Promise<void> => {
  await clearEdit($)
  if (confirm === 'select' && pending !== undefined) await jump($, pending)
  else if (confirm === 'mode' && isMode(pending)) await setMode($, pending)
  else if (confirm === 'pane') await $.ui.close({ id: PANE })
  else if (confirm === 'new' && pending !== undefined) await openNaming($, pending)
  $.ui.invalidate('ui.render')
}

// The Edit border's `close`: back to Preview, asking first when unsaved.
const closeEdit = async ($: EngineInterface): Promise<void> => {
  if (await guarded($, 'close')) return
  await clearEdit($)
}

// ---------------------------------------------------------------- New file

// `dir` as the name field's label shows it: relative to the root, `/`-ended.
const relativeDir = (dir: string, root: string): string =>
  dir === root ? './' : dir.startsWith(root + '/') ? dir.slice(root.length + 1) + '/' : dir + '/'

// Moves the ring onto `key` once the press that drew it has returned: awaited
// inside the press, the focus waits on a drawing that cannot come until the
// press ends, and is denied. A click leaves the keyboard with the prompt, and
// `$.ui.focus` moves only a ring the pane holds, so the pane asks for the keys
// first (re-opening it with `focus`; the surface grants that only over an empty
// composer). A deny (not drawn yet, a row's autoFocus first) retries a few
// times; after that the person clicks into it.
const focusOn = ($: EngineInterface, key: string, tries = 4): void => {
  $.clock.after(50, async () => {
    try {
      const pane = (await $.ui.panes()).find(p => p.id === PANE)
      if (pane !== undefined && !pane.isFocused) {
        await $.ui.open({ id: PANE, title: 'Explorer', focus: true })
      }
      const moved = await $.ui.focus({ requestId: PANE, key })
      if (moved.deny !== undefined && tries > 1) focusOn($, key, tries - 1)
    } catch {
      // the person clicks into it
    }
  })
}

// `new (n)`: the name field on the interactive line, for a file in `dir`. Unsaved
// text in the editor asks first; the bar's save or discard opens it then.
const openNaming = async ($: EngineInterface, dir: string): Promise<void> => {
  if (await guarded($, 'new', dir)) return
  naming = dir
  // One question at a time: the field replaces the delete bar.
  if ((await read($, explorer)).deleting !== undefined) {
    await update($, explorer, s => ({ ...s, deleting: undefined }))
  }
  $.ui.invalidate('ui.render')
  focusOn($, 'new-file')
}

const closeNaming = ($: EngineInterface): void => {
  naming = undefined
  $.ui.invalidate('ui.render')
}

// The name field's Enter: refuses a bad or taken name with a toast (the field
// stays), else opens the Edit section on an empty buffer for the path, its
// dirs expanded. Nothing is written until the editor saves.
const createNew = async ($: EngineInterface, dir: string, name: string): Promise<void> => {
  const state = await read($, explorer)
  const root = await rootOf($, state)
  const made = newFilePath(dir, name, root)
  if ('error' in made) {
    await toast($, made.error)

    return
  }
  let isTaken = true
  try {
    isTaken = await $.fs.exists(made.path)
  } catch {
    isTaken = true
  }
  if (isTaken) {
    await toast($, 'Already exists: ' + relativeDir(parentOf(made.path), root) + made.path.slice(made.path.lastIndexOf('/') + 1))

    return
  }
  // Typed into the editor since `new` was pressed: ask again.
  if (await guarded($, 'new', dir)) return
  naming = undefined
  const dirs: string[] = []
  for (let at = parentOf(made.path); at.length > root.length; at = parentOf(at)) dirs.push(at)
  await update($, explorer, s => ({
    ...s,
    cursor: made.path,
    expanded: [...s.expanded, ...dirs.reverse().filter(d => !s.expanded.includes(d))],
  }))
  await startEdit($, made.path)
  $.ui.invalidate('ui.render')
}

// ------------------------------------------------------------------ Delete

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

// Past this many entries a dir's count reads `1000+`.
const COUNT_CAP = 1000

// What the delete bar says about its target, kept for the path it was read
// for. Module-level: a reload reads it again.
let deleteFacts: { key: string; isDir: boolean; count?: string; hasMeta: boolean } | undefined

const factsOf = async ($: EngineInterface, path: string, mode: Mode) => {
  const key = mode + ':' + path
  if (deleteFacts?.key === key) return deleteFacts
  await ensureListed($, parentOf(path))
  const isDir = listings.get(parentOf(path))?.find(entry => entry.name === nameOf(path))?.kind === 'dir'
  let count: string | undefined
  if (isDir) {
    try {
      const ran = await $.process.run(
        ['sh', '-c', `find "$1" -mindepth 1 2>/dev/null | head -n ${COUNT_CAP + 1} | wc -l`, 'sh', path],
        { timeoutMs: 10000 },
      )
      const n = Number.parseInt(ran.stdout.trim(), 10)
      if (Number.isFinite(n)) count = n > COUNT_CAP ? `${COUNT_CAP}+` : String(n)
    } catch {
      // no count: the bar still names the dir
    }
  }
  let hasMeta = false
  if (mode === 'unity') {
    try {
      hasMeta = await $.fs.exists(path + '.meta')
    } catch {
      hasMeta = false
    }
  }
  deleteFacts = { key, isDir, count, hasMeta }

  return deleteFacts
}

// The editor's file is the target or inside it.
const isEditIn = (edit: Edit | undefined, path: string): edit is Edit =>
  edit !== undefined && (edit.path === path || edit.path.startsWith(path + '/'))

// `delete (d)`: the bar names the target; nothing is removed until its `delete`.
const askDelete = async ($: EngineInterface, path: string): Promise<void> => {
  naming = undefined
  deleteFacts = undefined
  await update($, explorer, s => ({ ...s, deleting: path }))
  $.ui.invalidate('ui.render')
}

const cancelDelete = async ($: EngineInterface): Promise<void> => {
  await update($, explorer, s => ({ ...s, deleting: undefined }))
}

// The delete bar's `delete`: `rm -rf --` the target (and its `.meta` in Unity
// mode). A failure toasts stderr's first line and leaves everything as it was;
// success closes the editor if it was in there (its draft goes too), drops the
// cached listings under it and selects the next row.
const confirmDelete = async ($: EngineInterface): Promise<void> => {
  const state = await read($, explorer)
  const path = state.deleting
  if (path === undefined) return
  const root = await rootOf($, state)
  const target = deleteTarget(path, root)
  if ('error' in target) {
    await cancelDelete($)
    await toast($, target.error)

    return
  }
  const facts = await factsOf($, target.path, state.mode)
  const argv = ['rm', '-rf', '--', target.path, ...(facts.hasMeta ? [target.path + '.meta'] : [])]
  let failure: string | undefined
  try {
    const ran = await $.process.run(argv, { timeoutMs: 60000 })
    if (ran.exitCode !== 0) {
      failure = ran.stderr.split('\n').find(line => line.trim() !== '') ?? `rm exited ${ran.exitCode}`
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  }
  if (failure !== undefined) {
    await cancelDelete($)
    await toast($, 'Delete failed: ' + failure)

    return
  }
  const edit = (await read($, explorer)).edit
  if (isEditIn(edit, target.path)) {
    await removeDraft($, edit.path)
    await clearEdit($)
  }
  // The rows as they were, to find the neighbour to select.
  const rows = flatten(listings, new Set(state.expanded), root, { mode: state.mode })
  const next = afterDelete(rows, target.path)
  const isUnder = (at: string): boolean => at === target.path || at.startsWith(target.path + '/')
  for (const dir of [...listings.keys()]) {
    if (isUnder(dir) || dir === parentOf(target.path)) listings.delete(dir)
  }
  for (const at of [...ignored]) if (isUnder(at)) ignored.delete(at)
  footers.clear()
  if (state.mode === 'unity') indexes.clear()
  deleteFacts = undefined
  await update($, explorer, s => {
    const isGone = (at: string | undefined) => at !== undefined && isUnder(at)

    return {
      ...s,
      deleting: undefined,
      expanded: s.expanded.filter(dir => !isUnder(dir)),
      selected: isGone(s.selected) || s.selected === undefined ? next : s.selected,
      cursor: isGone(s.cursor) || s.cursor === undefined ? next : s.cursor,
      previewOffset: isGone(s.selected) ? 0 : s.previewOffset,
    }
  })
  await toast($, 'Deleted ' + nameOf(target.path) + (facts.hasMeta ? ' + .meta' : ''))
  $.ui.invalidate('ui.render')
}

// The Edit border's line Buttons: label and the editor action they send.
const EDIT_COMMANDS: readonly (readonly [string, Action])[] = [
  ['↑line', 'moveLinesUp'],
  ['↓line', 'moveLinesDown'],
  ['dup', 'duplicateLines'],
  ['del', 'deleteLines'],
]

const discard = async ($: EngineInterface): Promise<void> => {
  const edit = (await read($, explorer)).edit
  if (edit === undefined) return
  await removeDraft($, edit.path)
  await finish($, edit.confirm, edit.pending)
}

// Drops the buffer and reads the file again (the conflict bar's `reload`, or
// Claude changed a clean buffer's file).
const reloadEdit = async ($: EngineInterface): Promise<void> => {
  const edit = (await read($, explorer)).edit
  if (edit === undefined) return
  await removeDraft($, edit.path)
  resetEditing()
  await patchEdit($, edit.version, {
    version: edit.version + 1,
    conflict: undefined,
    confirm: undefined,
    pending: undefined,
    hasDraft: undefined,
  })
  $.ui.invalidate('ui.render')
}

// A save checks the file against the mtime it was loaded at: changed (or a
// new file's path taken meanwhile) asks overwrite / reload / cancel first.
const saveText = async (
  $: EngineInterface,
  seq: number,
  text: string,
  force: boolean,
): Promise<void> => {
  const edit = (await read($, explorer)).edit
  if (edit === undefined) return
  const stat = await statOf($, edit.path)
  const isChanged =
    stat !== undefined &&
    (edit.isNew === true || (edit.baseMtime !== undefined && stat.mtimeMs !== edit.baseMtime))
  if (isChanged && !force) {
    await patchEdit($, edit.version, { conflict: 'disk', confirm: undefined, pending: undefined })

    return
  }
  try {
    await $.fs.write(edit.path, text)
  } catch (err) {
    await toast($, `Save failed: ${err instanceof Error ? err.message : String(err)}`)

    return
  }
  const after = await statOf($, edit.path)
  editing.saved = seq
  editing.isDirty = false
  await removeDraft($, edit.path)
  dropFile(edit.path)
  // A new file may have made its dirs too: every listing above it is stale.
  if (edit.isNew === true) {
    for (let dir = parentOf(edit.path); ; dir = parentOf(dir)) {
      listings.delete(dir)
      if (dir === '/') break
    }
  }
  await patchEdit($, edit.version, {
    baseMtime: after?.mtimeMs,
    isNew: undefined,
    hasDraft: undefined,
    conflict: undefined,
  })
  if (edit.confirm !== undefined) await finish($, edit.confirm, edit.pending)
}

const writeDraft = async ($: EngineInterface, text: string): Promise<void> => {
  const edit = (await read($, explorer)).edit
  if (edit === undefined || !editing.isDirty) return
  const draft = await draftOf($, edit.path)
  if (draft === undefined) return
  try {
    await $.fs.write(draft, text)
  } catch {
    return
  }
  if (edit.hasDraft !== true) await patchEdit($, edit.version, { hasDraft: true })
}

// A message of the editor client: `need` a chunk, `dirty`, `copy`, or a
// draft or save chunk. Every answer is the client's next props, acking it.
const editorMessage = async (
  $: EngineInterface,
  data: unknown,
  surface: Parameters<EngineInterface['ui']['copy']>[0]['surface'],
): Promise<{ props?: unknown }> => {
  const edit = (await read($, explorer)).edit
  const d = data as Record<string, unknown> | null
  if (edit === undefined || d === null || typeof d !== 'object') return {}
  if (typeof d.id === 'string') editing.ack = d.id
  const isCurrent = d.version === edit.version
  if (typeof d.need === 'number' && isCurrent) {
    // `need: 0` is a client starting over (new, or drawn again): read afresh.
    if (d.need === 0 || editing.version !== edit.version) {
      if (!(await loadEdit($, edit))) return {}
    }
    editing.index = Math.min(Math.max(0, d.need), editing.total)
    if (editing.index >= editing.total) editing.parts = []
  } else if (typeof d.dirty === 'boolean' && isCurrent) {
    editing.isDirty = d.dirty
    if (!d.dirty && edit.hasDraft === true) {
      await removeDraft($, edit.path)
      await patchEdit($, edit.version, { hasDraft: undefined })
    }
    $.ui.invalidate('ui.render')
  } else if (typeof d.copy === 'string') {
    try {
      const copied = await $.ui.copy({ text: d.copy, surface })
      if (!copied.isCopied) await toast($, `Copy failed: ${copied.reason}`)
    } catch {
      // the editor's own clipboard still has it
    }
  } else {
    const msg = parseChunk(d)
    if (msg !== undefined && msg.version === edit.version) {
      const got = accept(editing.incoming, msg)
      editing.incoming = got.incoming
      if (got.text !== undefined) {
        if (msg.kind === 'draft') await writeDraft($, got.text)
        else await saveText($, msg.seq, got.text, msg.force === true)
        $.ui.invalidate('ui.render')
      }
    }
  }
  const after = (await read($, explorer)).edit
  if (after === undefined) return {}

  return { props: editorProps(after, borderOf(await read($, sessionColor)).borderColor) }
}

// After Claude touched files: a clean buffer reloads, a dirty one gets the
// changed-on-disk bar. Our own saves move `baseMtime` along, so they pass.
const checkDisk = async ($: EngineInterface): Promise<void> => {
  const edit = (await read($, explorer)).edit
  if (edit === undefined || edit.baseMtime === undefined) return
  const stat = await statOf($, edit.path)
  if (stat === undefined || stat.mtimeMs === edit.baseMtime) return
  if (isEditDirty(edit)) {
    await patchEdit($, edit.version, { conflict: 'changed' })
  } else {
    resetEditing()
    await patchEdit($, edit.version, { version: edit.version + 1, baseMtime: undefined })
  }
}

const keymapOf = (options: PluginOptions | undefined) => {
  const preset = options?.editorKeymap === 'vscode' ? KEYMAPS.vscode : KEYMAPS.jetbrains
  const keys = options?.editorKeys

  return mergeKeymap(preset, typeof keys === 'string' ? keys : undefined)
}

export const register = (on: On, options?: PluginOptions): void => {
  const merged = keymapOf(options)
  keymap = merged.keymap
  keymapErrors = merged.errors

  on('session.start', async ($, e, next) => {
    // The plugin's one command (one session.start hook per plugin).
    await $.command.register({
      name: 'ide-panels',
      description: 'Open every ide-panes pane (explorer and git)',
    })
    const root = await $.session.root()
    const saved = await $.store.get(modeKey(root))
    await update($, explorer, s => {
      const isSame = s.root === '' || s.root === root

      return {
        ...s,
        root,
        mode: isMode(saved) ? saved : 'files',
        expanded: isSame ? s.expanded : [],
        selected: isSame ? s.selected : undefined,
        cursor: isSame ? s.cursor : undefined,
        offset: isSame ? s.offset : 0,
        previewOffset: isSame ? (s.previewOffset ?? 0) : 0,
        // A reload or restart: the editor asks for its text again, and a
        // draft newer than the file comes back with it (loadEdit).
        edit:
          s.edit === undefined
            ? undefined
            : { ...s.edit, version: s.edit.version + 1, confirm: undefined, pending: undefined },
      }
    })
    resetEditing()
    // Bad `editorKeys` overrides are named once per load.
    if (keymapErrors.length > 0) await toast($, keymapErrors.join('; '))
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
    if (e.file_path === (await read($, explorer)).edit?.path) await checkDisk($)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    dropFile(e.file_path)
    if (e.file_path === (await read($, explorer)).edit?.path) await checkDisk($)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    dropFile(e.notebook_path)
    if (e.notebook_path === (await read($, explorer)).edit?.path) await checkDisk($)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    listings.clear()
    footers.clear()
    ignored.clear()
    unityRoots.clear()
    deleteFacts = undefined
    if (isIndexCommand(e.command)) indexes.clear()
    await checkDisk($)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('command.run', { command: 'ide-panels' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Explorer' })
    await $.ui.open({ id: GIT_PANE, title: 'Git' })
    await $.ui.open({ id: PANE, title: 'Explorer', focus: true })

    return { text: 'Opened Explorer and Git (ctrl+x tab, or click a tab, to switch).' }
  })

  // Closing the pane over unsaved text (the person, or another plugin) gets
  // the unsaved-changes bar instead; answering without `next` keeps it open.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'unload' && (await guarded($, 'pane'))) return { value: undefined }

    return next(e)
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
    // Over the Edit section the wheel and page keys scroll the editor.
    const isOverEdit = pointer === undefined ? Math.abs(e.by) !== 1 : pointer.column >= view.treeEnd
    if (view.isEditDrawn && isOverEdit) {
      sendCommand($, 'scroll', pointer === undefined ? Math.sign(e.by) * view.editRows : e.by)

      return {}
    }
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
    if (e.element === 'editor') return editorMessage($, e.data, e.surface)
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
    // The Edit section stands in for Preview where a `Client` can draw it
    // (terminal and desktop; checked by name too, as the table may carry more).
    const canEdit = Client !== undefined && (e.surface === 'terminal' || e.surface === 'desktop')
    const edit = canEdit ? state.edit : undefined
    // `new` takes a name in an `Input` and opens the Edit section on it, so it
    // needs both (not vscode, which has the Input but no editor; not mobile).
    const Input = 'Input' in elements ? elements.Input : undefined
    const canNew = canEdit && Input !== undefined
    const namingIn = canNew ? naming : undefined
    const isAsking = edit?.confirm !== undefined || edit?.conflict !== undefined
    // The delete bar waits behind the conflict and unsaved-changes bars.
    const deleting = isAsking ? undefined : state.deleting
    const facts = deleting === undefined ? undefined : await factsOf($, deleting, state.mode)
    const deleteText =
      deleting === undefined || facts === undefined
        ? ''
        : 'Delete ' +
          nameOf(deleting) +
          (facts.isDir ? '/' : '') +
          '?' +
          (facts.count === undefined ? '' : ` (${facts.count} entries)`) +
          (facts.hasMeta ? ' + .meta' : '') +
          (isEditIn(state.edit, deleting) && isEditDirty(state.edit) ? ' (open in editor, unsaved)' : '')
    // What the interactive line holds, one question at a time.
    const ask =
      edit?.conflict !== undefined
        ? 'conflict'
        : edit?.confirm !== undefined
          ? 'unsaved'
          : deleting !== undefined
            ? 'delete'
            : namingIn !== undefined
              ? 'naming'
              : undefined
    // Header lines (panel tabs, actions, and the interactive line while it
    // asks), the bordered sections (2 rows of frame each), then the footer row.
    const headerRows = ask === undefined ? 2 : 3
    const sectionRows = Math.max(5, bodyRows - headerRows - 1)
    const footer = await footerOf($, root)
    const counts = footer.counts
    const isClean = counts.added + counts.modified + counts.deleted === 0
    const homeDir = await $.env.get('HOME')
    // Each section is framed in the session color.
    const border = borderOf(await read($, sessionColor))
    // Rows inside a section's frame.
    const innerRows = sectionRows - 2
    treeRows = innerRows
    // The wheel moves the window off the selection, so it only clamps here.
    const win = windowOf(rows, -1, treeRows, state.offset)
    const current = index < 0 ? undefined : rows[index]
    const isUnity = state.mode === 'unity' && !isNotUnity
    const preview =
      current === undefined || edit !== undefined
        ? undefined
        : await loadPreview($, current, isUnity, root)
    // Reference section: a header line, up to `shown` refs and a "+n more"
    // line; Code gets the rest of the pane rows.
    const refs = preview?.type === 'code' ? preview.refs : []
    const shown =
      refs.length === 0
        ? 0
        : Math.min(refs.length, Math.max(1, Math.floor((innerRows - 1) / 2)))
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
    const previewRows = Math.max(1, innerRows - refLines)
    const previewOffset = clamp(state.previewOffset ?? 0, previewTotal - previewRows)
    view.treeEnd = Math.floor(e.props.bodyColumns * 0.35)
    view.treeMax = Math.max(0, rows.length - treeRows)
    view.previewMax = Math.max(0, previewTotal - previewRows)
    view.previewRows = previewRows
    view.editRows = innerRows
    view.editColumns = Math.max(1, e.props.bodyColumns - view.treeEnd - 2)
    view.isEditDrawn = edit !== undefined
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

    // The section's name sits on its top border. A bordered Box clips its
    // children, so the overlay sits after it in an unbordered wrapper of the
    // same size, at top={0}. A Button has no text color, so black Text is drawn
    // over it; the press still lands on the Button.
    const titled = (key: string, name: string) => (
      <Box position="absolute" top={0} left={1} backgroundColor={border.borderColor}>
        <Button
          key={key}
          plain
          label={' ' + name + ' '}
          onPress={pressed => copyName($, name, pressed.surface)}
        />
        <Box position="absolute" top={0} left={0}>
          <Text color="black">{' ' + name + ' '}</Text>
        </Box>
      </Box>
    )

    // Panel tabs, drawn as git's: the terminal prefixes a plain Button with its
    // hotkey, so no `(f)` suffixes. The active one does nothing (a mode switch
    // would close a clean editor and reset the scroll).
    const tabButton = (mode: Mode, hotkey: string, label: string) => (
      <Button
        key={'tab:' + mode}
        hotkey={hotkey}
        plain
        dimColor={state.mode === mode ? undefined : true}
        label={(state.mode === mode ? '▌' : ' ') + label}
        onPress={() => (state.mode === mode ? undefined : setMode($, mode))}
      />
    )

    return (
      <Box flexDirection="column" width="100%" minHeight={e.props.scroll.bodyRows} backgroundColor={BACKGROUND}>
        <Box key="header:tabs" flexDirection="row" gap={1}>
          {tabButton('files', 'f', 'Files')}
          {tabButton('unity', 'u', 'Unity')}
          {isNotUnity && (
            <Text dimColor>
              not a Unity project
            </Text>
          )}
        </Box>
        <Box key="header:actions" flexDirection="row" gap={1}>
          <Button
            key="refresh"
            hotkey="r"
            label="refresh (r)"
            onPress={() => {
              listings.clear()
              footers.clear()
              ignored.clear()
              unityRoots.clear()
              deleteFacts = undefined
              indexes.clear()
              $.ui.invalidate('ui.render')
            }}
          />
          {canEdit && edit === undefined && preview?.type === 'code' && (
            <Button
              key="edit"
              hotkey="e"
              label="edit (e)"
              onPress={() => startEdit($, preview.path)}
            />
          )}
          {canNew && (
            <Button
              key="new"
              hotkey="n"
              label="new (n)"
              onPress={() =>
                openNaming(
                  $,
                  current !== undefined
                    ? current.kind === 'dir'
                      ? current.path
                      : parentOf(current.path)
                    : state.selected !== undefined
                      ? parentOf(state.selected)
                      : root,
                )
              }
            />
          )}
          {current !== undefined && !isAsking && (
            <Button
              key="delete"
              hotkey="d"
              label="delete (d)"
              onPress={() => askDelete($, current.path)}
            />
          )}
        </Box>
        {/* The interactive line, only while something asks: the question or
            the name field on the left, its Buttons in the right corner. */}
        {ask === 'conflict' && edit?.conflict !== undefined ? (
          <Box key="header:ask" flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexDirection="row" flexShrink={1}>
              <Text color="yellow" wrap="truncate-end">
                {(edit.conflict === 'disk' ? 'Changed on disk since loaded: ' : 'Changed on disk by Claude: ') +
                  edit.path.slice(edit.path.lastIndexOf('/') + 1)}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              <Button key="ask:overwrite" label="overwrite" onPress={() => sendCommand($, 'overwrite')} />
              <Button key="ask:reload" label="reload" onPress={() => reloadEdit($)} />
              <Button
                key="ask:cancel"
                label="cancel"
                onPress={() => patchEdit($, edit.version, { conflict: undefined })}
              />
            </Box>
          </Box>
        ) : ask === 'unsaved' && edit !== undefined ? (
          <Box key="header:ask" flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexDirection="row" flexShrink={1}>
              <Text color="yellow" wrap="truncate-end">
                {'Unsaved changes in ' + edit.path.slice(edit.path.lastIndexOf('/') + 1)}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              <Button key="ask:save" label="save" onPress={() => sendCommand($, 'save')} />
              <Button key="ask:discard" label="discard" onPress={() => discard($)} />
              <Button
                key="ask:cancel"
                label="cancel"
                onPress={() => patchEdit($, edit.version, { confirm: undefined, pending: undefined })}
              />
            </Box>
          </Box>
        ) : ask === 'delete' ? (
          <Box key="header:ask" flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexDirection="row" flexShrink={1}>
              <Text color="red" wrap="truncate-end">
                {deleteText}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              <Button key="delete:confirm" label="delete" onPress={() => confirmDelete($)} />
              <Button key="delete:cancel" label="cancel" onPress={() => cancelDelete($)} />
            </Box>
          </Box>
        ) : ask === 'naming' && namingIn !== undefined && Input !== undefined ? (
          <Box key="header:ask" flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexDirection="row" flexGrow={1} flexShrink={1}>
              <Input
                key="new-file"
                label={'new file in ' + relativeDir(namingIn, root)}
                submitLabel="create"
                autoFocus
                onSubmit={value => createNew($, namingIn, value)}
              />
            </Box>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              <Button key="new:cancel" label="cancel" onPress={() => closeNaming($)} />
            </Box>
          </Box>
        ) : undefined}
        <Box flexDirection="row">
          <Box flexDirection="column" width="35%" height={sectionRows}>
          <Box {...border} flexDirection="row" height="100%">
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
          {titled('title:files', 'Files')}
          </Box>
          {edit !== undefined && Client !== undefined ? (
            <Box flexDirection="column" flexGrow={1} height={sectionRows}>
            <Box {...border} flexDirection="row" height="100%" flexGrow={1}>
              <Client
                key="editor"
                module="./editor-client.tsx"
                props={editorProps(edit, border.borderColor)}
                height={innerRows}
                flexGrow={1}
              />
            </Box>
            {titled('title:edit', (isEditDirty(edit) ? '● ' : '') + 'Edit')}
            {/* Line actions for terminals that do not report their chords. */}
            <Box position="absolute" top={0} right={1} flexDirection="row" gap={1}>
              <Button key="edit:save" plain label=" save " onPress={() => sendCommand($, 'save')} />
              <Button key="edit:close" plain label=" close " onPress={() => closeEdit($)} />
              {EDIT_COMMANDS.map(([label, command]) => (
                <Button
                  key={'edit:' + command}
                  plain
                  label={' ' + label + ' '}
                  onPress={() => sendCommand($, command)}
                />
              ))}
            </Box>
            </Box>
          ) : (
          <Box flexDirection="column" flexGrow={1} height={sectionRows}>
          <Box {...border} flexDirection="row" height="100%" flexGrow={1}>
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
          {titled('title:preview', 'Preview')}
          </Box>
          )}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" gap={2}>
          <Box flexShrink={1}>
            <Text key="footer:dir" wrap="truncate-start">
              <Text dimColor>{shortDir(root, homeDir)}</Text>
              {footer.branch !== undefined && <Text color="cyan">{` (${footer.branch})`}</Text>}
            </Text>
          </Box>
          {footer.branch !== undefined && (
            <Box flexShrink={0} paddingRight={1}>
              <Text key="footer:counts" dimColor={isClean}>
                <Text color={isClean ? undefined : 'green'}>{`+${counts.added}`}</Text>
                <Text> </Text>
                <Text color={isClean ? undefined : 'yellow'}>{`~${counts.modified}`}</Text>
                <Text> </Text>
                <Text color={isClean ? undefined : 'red'}>{`-${counts.deleted}`}</Text>
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
