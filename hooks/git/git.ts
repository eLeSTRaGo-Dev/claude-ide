export const GIT_COMMAND = {
  name: 'git',
  description: 'Open the git view',
} as const

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

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

// The first `rows` lines of a unified diff, still a valid diff: the last hunk's
// header counts are rewritten to the lines kept, and file header lines left
// with no hunk after them are dropped (`Code format="diff"` rejects both).
export const clipDiff = (diff: string, rows: number): string => {
  const all = diff.replace(/\n+$/, '').split('\n')
  const kept = all.slice(0, Math.max(1, rows))
  let hunk = -1
  kept.forEach((line, i) => {
    if (HUNK.test(line)) hunk = i
  })
  if (hunk < 0) return ''
  let removed = 0
  let added = 0
  let context = 0
  for (const line of kept.slice(hunk + 1)) {
    if (line.startsWith('-')) removed++
    else if (line.startsWith('+')) added++
    else if (line.startsWith(' ')) context++
  }
  const match = HUNK.exec(kept[hunk] ?? '')
  if (match === null) return ''
  kept[hunk] =
    `@@ -${match[1]},${context + removed} +${match[2]},${context + added} @@` +
    (match[3] ?? '')

  return kept.join('\n')
}
