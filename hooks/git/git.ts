// The git view's pane id, which `/ide-panels` opens.
export const GIT_PANE = 'ide-git'

export type Branch = {
  name: string
  sha: string
  upstream?: string
  track?: string
  isHead: boolean
  isRemote: boolean
}

export type Commit = {
  sha: string
  short: string
  refs: string[]
  author: string
  date: string
  subject: string
}

export type GraphLine = { graph: string; commit?: Commit }

const SEP = '\x1f'
const LOCAL = 'refs/heads/'
const REMOTE = 'refs/remotes/'

export const BRANCH_FORMAT =
  '%(HEAD)%1f%(refname)%1f%(objectname:short)%1f%(upstream:short)%1f%(upstream:track)'

export const GRAPH_FORMAT = '%x1f%H%x1f%h%x1f%D%x1f%an%x1f%ad%x1f%s'

export const SHOW_FORMAT = '%H%n%an <%ae>%n%ad%n%n%B'

const lines = (stdout: string): string[] =>
  stdout.split('\n').filter(line => line !== '')

// `refname` is the full ref name, so a local `fix/x` is told from a remote
// `origin/x`. Local branches come first; `origin/HEAD` is skipped.
export const parseBranches = (stdout: string): Branch[] => {
  const local: Branch[] = []
  const remote: Branch[] = []
  for (const line of lines(stdout)) {
    const [head = '', ref = '', sha = '', upstream = '', track = ''] =
      line.split(SEP)
    if (ref.startsWith(LOCAL)) {
      local.push({
        name: ref.slice(LOCAL.length),
        sha,
        upstream: upstream === '' ? undefined : upstream,
        track: track === '' ? undefined : track,
        isHead: head === '*',
        isRemote: false,
      })
    } else if (ref.startsWith(REMOTE)) {
      const name = ref.slice(REMOTE.length)
      if (name.endsWith('/HEAD') || !name.includes('/')) continue
      remote.push({ name, sha, isHead: false, isRemote: true })
    }
  }

  return [...local, ...remote]
}

// `%D` decorations: `HEAD -> develop, origin/develop, tag: v1`.
export const parseRefs = (decoration: string): string[] =>
  decoration === ''
    ? []
    : decoration
        .split(', ')
        .map(ref => ref.trim())
        .filter(ref => ref !== '' && !ref.endsWith('/HEAD'))

// A line with a separator is a commit: `<graph prefix>\x1f<fields>`. One
// without is a connector (`| |\`) kept so the graph stays continuous.
export const parseGraph = (stdout: string): GraphLine[] => {
  const result: GraphLine[] = []
  for (const raw of stdout.split('\n')) {
    if (raw === '') continue
    const parts = raw.split(SEP)
    if (parts.length < 7) {
      result.push({ graph: raw.trimEnd() })
      continue
    }
    const [graph = '', sha = '', short = '', refs = '', author = '', date = ''] =
      parts
    result.push({
      graph,
      commit: {
        sha,
        short,
        refs: parseRefs(refs),
        author,
        date,
        // a subject cannot hold the separator, but keep any stray tail
        subject: parts.slice(6).join(SEP),
      },
    })
  }

  return result
}

// `git show --stat --format=SHOW_FORMAT`: the whole output as text lines.
export const splitShow = (stdout: string): string[] =>
  stdout.replace(/\n+$/, '').split('\n')

// `git log --graph` and `git show` argv builders.
export const logArgv = (ref: string, limit: number): string[] => [
  'git',
  'log',
  '--graph',
  '--color=never',
  '--date=short',
  '-n',
  String(limit),
  '--format=' + GRAPH_FORMAT,
  ref === 'all' ? '--all' : ref,
]

export const branchesArgv = (): string[] => [
  'git',
  'for-each-ref',
  '--format=' + BRANCH_FORMAT,
  'refs/heads',
  'refs/remotes',
]

export const statArgv = (sha: string): string[] => [
  'git',
  'show',
  '--stat',
  '--color=never',
  '--format=' + SHOW_FORMAT,
  sha,
]

export const patchArgv = (sha: string): string[] => [
  'git',
  'show',
  '--color=never',
  '--format=',
  '--patch',
  sha,
]

// "[ahead 1, behind 2]" -> "+1 -2"
export const trackLabel = (track: string | undefined): string => {
  if (track === undefined) return ''
  const ahead = /ahead (\d+)/.exec(track)?.[1]
  const behind = /behind (\d+)/.exec(track)?.[1]
  if (/gone/.test(track)) return 'gone'

  return [ahead ? '+' + ahead : '', behind ? '-' + behind : '']
    .filter(Boolean)
    .join(' ')
}

export const commitLabel = (line: GraphLine): string => {
  const { commit } = line
  if (commit === undefined) return line.graph
  const refs = commit.refs.length > 0 ? ' (' + commit.refs.join(', ') + ')' : ''

  return `${line.graph}${commit.short}${refs} ${commit.subject}`
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

type Parsed = {
  kind: 'file' | 'hunk' | 'body'
  // file lines: index of the `diff` line opening the block
  block: number
  // body lines: the hunk header's index and the old/new numbers of the line
  head: number
  old: number
  next: number
}

// Every line of a diff told apart: hunk headers, file header lines (`diff`,
// `index`, `---`, `+++`, ...) and hunk body lines. Bodies are followed by the
// header's counts, so a removed `-- x` is not taken for a `---` line.
const parseDiff = (all: readonly string[]): Parsed[] => {
  const parsed: Parsed[] = []
  let block = 0
  let head = -1
  let left = { old: 0, next: 0 }
  let old = 0
  let next = 0
  all.forEach((line, i) => {
    const isBody = left.old > 0 || left.next > 0
    if (isBody && !HUNK.test(line)) {
      parsed.push({ kind: 'body', block, head, old, next })
      if (line.startsWith('-')) {
        left.old--
        old++
      } else if (line.startsWith('+')) {
        left.next--
        next++
      } else if (line.startsWith(' ')) {
        left.old--
        left.next--
        old++
        next++
      }

      return
    }
    const match = HUNK.exec(line)
    if (match !== null) {
      head = i
      old = Number(match[1])
      next = Number(match[3])
      left = {
        old: match[2] === undefined ? 1 : Number(match[2]),
        next: match[4] === undefined ? 1 : Number(match[4]),
      }
      parsed.push({ kind: 'hunk', block, head, old, next })

      return
    }
    if (line.startsWith('diff ')) block = i
    parsed.push({ kind: 'file', block, head, old, next })
  })

  return parsed
}

type OpenHunk = {
  at: number
  head: number
  old: number
  next: number
  section: string
  context: number
  removed: number
  added: number
  isKept: boolean
}

export const diffLines = (diff: string): string[] =>
  diff === '' ? [] : diff.replace(/\n+$/, '').split('\n')

// `rows` lines of a unified diff from line `offset`, still a valid diff: a hunk
// cut at either end gets its header start/counts rewritten (a hunk entered
// mid-way gets a header of its own), and file header lines are kept only with a
// hunk after them (`Code format="diff"` rejects both). '' when no hunk shows.
export const sliceDiff = (diff: string, offset: number, rows: number): string => {
  const all = diffLines(diff)
  const parsed = parseDiff(all)
  const from = Math.min(Math.max(0, Math.floor(offset)), all.length)
  const to = Math.min(all.length, from + Math.max(1, Math.floor(rows)))
  const out: string[] = []
  let pending: string[] = []
  let open = undefined as OpenHunk | undefined
  const close = (): void => {
    if (open === undefined) return
    const { at, old, next, context, removed, added, isKept } = open
    const oldCount = context + removed
    const newCount = context + added
    if (!isKept) {
      const oldStart = oldCount === 0 ? Math.max(0, old - 1) : old
      const newStart = newCount === 0 ? Math.max(0, next - 1) : next
      out[at] = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${open.section}`
    }
    open = undefined
  }
  const header = (index: number) => HUNK.exec(all[index] ?? '')
  for (let i = from; i < to; i++) {
    const line = all[i] ?? ''
    const p = parsed[i]
    if (p === undefined) continue
    if (p.kind === 'file') {
      close()
      if (line.startsWith('diff ') && p.block === i) pending = []
      if (p.block >= from) pending.push(line)
    } else if (p.kind === 'hunk') {
      close()
      out.push(...pending)
      pending = []
      const match = header(i)
      open = {
        at: out.length,
        head: i,
        old: p.old,
        next: p.next,
        section: match?.[5] ?? '',
        context: 0,
        removed: 0,
        added: 0,
        isKept: true,
      }
      out.push(line)
    } else {
      if (open === undefined || open.head !== p.head) {
        if (line.startsWith('\\')) continue
        close()
        const match = header(p.head)
        open = {
          at: out.length,
          head: p.head,
          old: p.old,
          next: p.next,
          section: match?.[5] ?? '',
          context: 0,
          removed: 0,
          added: 0,
          isKept: false,
        }
        out.push('')
      }
      if (line.startsWith('-')) open.removed++
      else if (line.startsWith('+')) open.added++
      else if (line.startsWith(' ')) open.context++
      out.push(line)
    }
  }
  // a hunk shown from its own header but cut short at the bottom
  if (open !== undefined && open.isKept) {
    const match = header(open.head)
    const oldFull = match?.[2] === undefined ? 1 : Number(match[2])
    const newFull = match?.[4] === undefined ? 1 : Number(match[4])
    if (open.context + open.removed !== oldFull || open.context + open.added !== newFull) {
      open.isKept = false
    }
  }
  close()

  return out.some(line => HUNK.test(line)) ? out.join('\n') : ''
}

// The first `rows` lines of a unified diff, still a valid diff.
export const clipDiff = (diff: string, rows: number): string =>
  sliceDiff(diff, 0, rows)

// One row of the branch list grouped by `/`: a folder or a branch, with its
// depth under the root. Local branches come first, then each remote.
export type BranchRow =
  | { kind: 'folder'; key: string; name: string; depth: number; isOpen: boolean }
  | { kind: 'branch'; branch: Branch; name: string; depth: number }

type Node = { folders: Map<string, Node>; leaves: { name: string; branch: Branch }[] }

const nodeOf = (): Node => ({ folders: new Map(), leaves: [] })

// `collapsed` holds folder keys (`l:fix` / `r:origin/feature`) the person closed.
export const branchTree = (
  branches: readonly Branch[],
  collapsed: ReadonlySet<string>,
): BranchRow[] => {
  const local = nodeOf()
  const remote = nodeOf()
  for (const branch of branches) {
    const parts = branch.name.split('/')
    let node = branch.isRemote ? remote : local
    for (const part of parts.slice(0, -1)) {
      const next = node.folders.get(part) ?? nodeOf()
      node.folders.set(part, next)
      node = next
    }
    node.leaves.push({ name: parts[parts.length - 1] ?? branch.name, branch })
  }
  const rows: BranchRow[] = []
  const walk = (node: Node, prefix: string, depth: number): void => {
    for (const leaf of node.leaves) {
      rows.push({ kind: 'branch', branch: leaf.branch, name: leaf.name, depth })
    }
    for (const name of [...node.folders.keys()].sort()) {
      const key = prefix + (prefix.endsWith(':') ? '' : '/') + name
      const isOpen = !collapsed.has(key)
      rows.push({ kind: 'folder', key, name, depth, isOpen })
      if (isOpen) walk(node.folders.get(name) as Node, key, depth + 1)
    }
  }
  walk(local, 'l:', 0)
  walk(remote, 'r:', 0)

  return rows
}

// The two calls that touch the repo: fetch every remote, and a pull that
// only fast-forwards (it fails rather than merging).
export type RemoteAction = 'fetch' | 'pull'

export const remoteArgv = (action: RemoteAction): string[] =>
  action === 'fetch' ? ['git', 'fetch', '--all'] : ['git', 'pull', '--ff-only']

// A short line for a toast from a finished fetch or pull.
export const remoteSummary = (
  action: RemoteAction,
  exitCode: number,
  stdout: string,
  stderr: string,
): string => {
  const lines = (exitCode === 0 ? stdout + '\n' + stderr : stderr + '\n' + stdout)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('Fetching '))
  const detail = exitCode === 0 ? (lines.at(-1) ?? 'done') : (lines[0] ?? 'exit ' + exitCode)

  return `git ${action}: ${exitCode === 0 ? '' : 'failed: '}${detail}`
}
