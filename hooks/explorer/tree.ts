export type Mode = 'files' | 'unity'

export type Entry = {
  name: string
  kind: 'file' | 'dir' | 'other'
  size: number
  mtimeMs: number
}

export type Row = {
  path: string
  name: string
  depth: number
  kind: Entry['kind']
  isExpanded: boolean
}

// Decides whether an entry of `parentPath` is shown in `mode`. `root` is the
// tree's root, so a filter can tell the top level apart.
export type EntryFilter = (
  entry: Entry,
  parentPath: string,
  mode: Mode,
  root: string,
) => boolean

// FileExplorer: everything but `.git`.
export const hideGit: EntryFilter = entry => entry.name !== '.git'

const UNITY_TOP = new Set(['Assets', 'Packages', 'ProjectSettings'])
const UNITY_NOISE = new Set(['Library', 'Temp', 'Logs', 'obj', 'UserSettings'])

// Unity: no `.git` or `.meta`; the top level shows only Assets, Packages and
// ProjectSettings; build and cache dirs are hidden at any depth.
export const unityFilter: EntryFilter = (entry, parentPath, _mode, root) => {
  if (entry.name === '.git' || entry.name.endsWith('.meta')) return false
  if (parentPath === root) {
    return entry.kind === 'dir' && UNITY_TOP.has(entry.name)
  }
  if (entry.kind !== 'dir') return true

  return !UNITY_NOISE.has(entry.name) && !/^Build/.test(entry.name)
}

export const filters: Record<Mode, EntryFilter> = {
  files: hideGit,
  unity: unityFilter,
}

export const filterFor = (mode: Mode): EntryFilter => filters[mode]

export const join = (dir: string, name: string): string =>
  dir.endsWith('/') ? dir + name : dir + '/' + name

export const parentOf = (path: string): string => {
  const cut = path.lastIndexOf('/')

  return cut <= 0 ? '/' : path.slice(0, cut)
}

const byName = (a: Entry, b: Entry): number => {
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()

  return left < right ? -1 : left > right ? 1 : a.name < b.name ? -1 : 1
}

// Dirs first, then case-insensitive name order.
export const sortEntries = (entries: readonly Entry[]): Entry[] => [
  ...entries.filter(entry => entry.kind === 'dir').sort(byName),
  ...entries.filter(entry => entry.kind !== 'dir').sort(byName),
]

export type FlattenOptions = {
  filter?: EntryFilter
  mode?: Mode
}

// The visible rows, depth first. A dir whose listing is not cached shows no
// children even when expanded.
export const flatten = (
  listings: ReadonlyMap<string, readonly Entry[]>,
  expanded: ReadonlySet<string>,
  root: string,
  options: FlattenOptions = {},
): Row[] => {
  const mode = options.mode ?? 'files'
  const filter = options.filter ?? filterFor(mode)
  const rows: Row[] = []
  const walk = (dir: string, depth: number): void => {
    const entries = listings.get(dir) ?? []
    const shown = entries.filter(entry => filter(entry, dir, mode, root))
    for (const entry of sortEntries(shown)) {
      const path = join(dir, entry.name)
      const isExpanded = entry.kind === 'dir' && expanded.has(path)
      rows.push({ path, name: entry.name, depth, kind: entry.kind, isExpanded })
      if (isExpanded) walk(path, depth + 1)
    }
  }
  walk(root, 0)

  return rows
}

export type Window = { offset: number; rows: Row[] }

// The slice of `height` rows that keeps `selectedIndex` visible with `margin`
// rows of context beyond it. Starts from `offset` so scrolling is minimal.
export const window = (
  rows: readonly Row[],
  selectedIndex: number,
  height: number,
  offset = 0,
  margin = 1,
): Window => {
  const room = Math.max(1, Math.floor(height))
  const last = Math.max(0, rows.length - room)
  let start = Math.min(Math.max(0, offset), last)
  if (selectedIndex >= 0) {
    const m = Math.min(margin, Math.floor((room - 1) / 2))
    if (selectedIndex - m < start) start = selectedIndex - m
    if (selectedIndex + m > start + room - 1) start = selectedIndex + m - room + 1
    start = Math.min(Math.max(0, start), last)
  }

  return { offset: start, rows: rows.slice(start, start + room) }
}

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  cs: 'csharp',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  html: 'html',
  css: 'css',
  xml: 'xml',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  sql: 'sql',
}

// Highlighter language for a file name; undefined lets `Code` infer from path.
export const languageOf = (name: string): string | undefined => {
  const dot = name.lastIndexOf('.')

  return dot < 0 ? undefined : LANGUAGES[name.slice(dot + 1).toLowerCase()]
}

export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024
export const SNIFF_CHARS = 8192

// Text with a NUL in its first 8 KiB is treated as binary.
export const isBinary = (text: string): boolean =>
  text.slice(0, SNIFF_CHARS).includes('\0')

export const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`

// Code's `source` is capped at 10000 characters; keep the first `lines` lines.
export const clip = (text: string, lines: number, chars = 10000): string => {
  const kept = text.split('\n').slice(0, Math.max(1, lines)).join('\n')

  return kept.length > chars ? kept.slice(0, chars) : kept
}
