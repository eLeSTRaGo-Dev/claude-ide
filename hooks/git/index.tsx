import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState } from '../../types'
import { window as windowOf } from '../explorer/tree'
import { borderOf } from '../shared/color'
import { scrollbar } from '../shared/scrollbar'
import {
  GIT_PANE,
  branchTree,
  remoteArgv,
  remoteSummary,
  shortDir,
  branchesArgv,
  changeCounts,
  changeDiffArgv,
  changeGlyph,
  changeRows,
  cellRuns,
  changeWords,
  fitStart,
  isUntracked,
  diffLines,
  infoHead,
  layoutGraph,
  logArgv,
  PALETTE_SIZE,
  parseBranches,
  parseLog,
  parseStatus,
  patchArgv,
  sliceDiff,
  splitShow,
  statArgv,
  statusArgv,
  trackLabel,
} from './git'
import type { Branch, BranchRow, Change, ChangeRow, Commit, RemoteAction } from './git'

type On = Parameters<Register>[0]

// Black behind the whole pane, as the console default.
const BACKGROUND = 'black'
// The `/color` of this session; set by the explorer's hooks.
const sessionColor = atom<'ide-panes', 'sessionColor'>(
  { plugin: 'ide-panes', key: 'sessionColor' } as const,
  '',
)
const PANE = GIT_PANE
// Background of the selected branch, as the explorer's selected row.
const SELECTED = 'ansi256(238)'

// Status letter colors in the changes list.
const GLYPH_COLOR: Record<string, string> = {
  A: 'green',
  M: 'yellow',
  D: 'red',
  R: 'blue',
  C: 'blue',
  '?': 'green',
}

// Lane-run colors, readable on black.
const LANE_COLORS = [
  'ansi256(75)',
  'ansi256(114)',
  'ansi256(176)',
  'ansi256(215)',
  'ansi256(80)',
  'ansi256(203)',
  'ansi256(185)',
  'ansi256(147)',
]

// Ref badges: tags yellow, remote branches dim red, the rest green.
const refColor = (ref: string, remotes: ReadonlySet<string>): string =>
  ref.startsWith('tag: ') ? 'yellow' : remotes.has(ref) ? 'red' : 'green'

const PAGE = 200
// Pane body columns from which the three-column layout is used.
const WIDE = 140

const git = atom<'ide-panes', 'git'>(
  { plugin: 'ide-panes', key: 'git' } as const,
  { ref: 'all', offset: 0, limit: PAGE, branchOffset: 0, detailOffset: 0 } satisfies GitState,
)

// Git output is cached here, not in $.state; `refresh` and Bash tool calls
// clear it.
let repoRoot: string | null | undefined
let branchCache: Branch[] | undefined
let statusCache: Change[] | undefined
const graphCache = new Map<string, Commit[]>()
const showCache = new Map<string, { head: string[]; diff: string }>()
const changeCache = new Map<string, { head: string[]; diff: string }>()
let hasHead: boolean | undefined
// Rows the graph and the changes list show; set by render, read by the focus hook.
let graphRows = 20
let changeRoom = 20
// The last drawing's geometry, set by render and read by the scroll hook: where
// each section sits (columns split at `branchEnd` and `graphEnd`; stacked, the
// details start at row `topRows`), each section's furthest offset and the rows
// the details show.
const view = {
  isWide: true,
  branchEnd: 0,
  graphEnd: 0,
  topRows: 0,
  branchMax: 0,
  graphMax: 0,
  changeMax: 0,
  detailMax: 0,
  detailRows: 1,
}

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max))

const clear = (): void => {
  repoRoot = undefined
  branchCache = undefined
  statusCache = undefined
  graphCache.clear()
  showCache.clear()
  changeCache.clear()
  hasHead = undefined
}

// Calls that threw (the engine aborts a git call when its render is
// superseded). Their empty answer is not the repo's, so it is not cached.
let threw = 0

// Read-only git call; undefined on an exit code outside `ok` or any failure.
const run = async (
  $: EngineInterface,
  cwd: string,
  argv: string[],
  ok: readonly number[] = [0],
): Promise<string | undefined> => {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs: 15000 })

    return ok.includes(ran.exitCode) ? ran.stdout : undefined
  } catch {
    threw += 1

    return undefined
  }
}

const rootOf = async (
  $: EngineInterface,
  cwd: string,
): Promise<string | null> => {
  if (typeof repoRoot === 'string') return repoRoot
  // Not a repo is not cached: the next render looks again.
  const out = await run($, cwd, ['git', 'rev-parse', '--show-toplevel'])
  if (out === undefined) return null
  repoRoot = out.trim()

  return repoRoot
}

const branchesOf = async (
  $: EngineInterface,
  cwd: string,
): Promise<Branch[]> => {
  if (branchCache === undefined) {
    const before = threw
    const parsed = parseBranches((await run($, cwd, branchesArgv())) ?? '')
    if (threw !== before) return parsed
    branchCache = parsed
  }

  return branchCache
}

const statusOf = async (
  $: EngineInterface,
  cwd: string,
): Promise<Change[]> => {
  if (statusCache === undefined) {
    const before = threw
    const parsed = parseStatus((await run($, cwd, statusArgv())) ?? '')
    if (threw !== before) return parsed
    statusCache = parsed
  }

  return statusCache
}

const graphOf = async (
  $: EngineInterface,
  cwd: string,
  state: GitState,
): Promise<Commit[]> => {
  const key = state.ref + '\0' + state.limit
  let lines = graphCache.get(key)
  if (lines === undefined) {
    const before = threw
    lines = parseLog(
      (await run($, cwd, logArgv(state.ref, state.limit))) ?? '',
    )
    if (threw !== before) return lines
    graphCache.set(key, lines)
  }

  return lines
}

const detailsOf = async (
  $: EngineInterface,
  cwd: string,
  sha: string,
): Promise<{ head: string[]; diff: string }> => {
  let shown = showCache.get(sha)
  if (shown === undefined) {
    const before = threw
    const [stat, patch] = await Promise.all([
      run($, cwd, statArgv(sha)),
      run($, cwd, patchArgv(sha)),
    ])
    shown = {
      head: splitShow(stat ?? ''),
      diff: (patch ?? '').replace(/^\n+/, ''),
    }
    if (threw !== before) return shown
    showCache.set(sha, shown)
  }

  return shown
}

// Head lines and the diff of one change against HEAD, run from the repo root
// (status paths are relative to it). An untracked file is
// diffed with `--no-index`, which exits 1 when the files differ.
const changeDetailsOf = async (
  $: EngineInterface,
  cwd: string,
  change: Change,
): Promise<{ head: string[]; diff: string }> => {
  let shown = changeCache.get(change.path)
  if (shown === undefined) {
    const before = threw
    let head = hasHead
    if (head === undefined) {
      head = (await run($, cwd, ['git', 'rev-parse', '--verify', '--quiet', 'HEAD'])) !== undefined
      if (threw === before) hasHead = head
    }
    const out = await run(
      $,
      cwd,
      changeDiffArgv(change, head),
      isUntracked(change) ? [0, 1] : [0],
    )
    shown = {
      head: [
        change.path,
        changeWords(change),
        ...(change.from === undefined ? [] : ['from ' + change.from]),
      ],
      diff: (out ?? '').replace(/^\n+/, ''),
    }
    if (threw !== before) return shown
    changeCache.set(change.path, shown)
  }

  return shown
}

// The changes list as drawn now, from the cached status.
const rowsOf = (state: GitState): ChangeRow[] =>
  changeRows(
    statusCache ?? [],
    state.changeView ?? 'list',
    new Set(state.changeCollapsed ?? []),
  )

const fit = (text: string, width: number): string =>
  text.length > width ? text.slice(0, Math.max(1, width - 1)) + '…' : text

// Last status text set; null: nothing set yet (always set the first time).
let shown: string | undefined | null = null

// Current branch (a short sha when detached) in the status line; cleared
// outside a repo. Skips the update when the text is unchanged.
const showBranch = async ($: EngineInterface, cwd: string): Promise<void> => {
  let name = (await run($, cwd, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
  if (name === 'HEAD') {
    name = (await run($, cwd, ['git', 'rev-parse', '--short', 'HEAD']))?.trim()
  }
  const text = name === undefined || name === '' ? undefined : '⎇ ' + name
  if (text === shown) return
  shown = text
  await $.ui.status(text)
}

// The fetch or pull running now; a second press waits for it to finish.
let busy: RemoteAction | undefined

// Runs a fetch or pull (no credential prompt: it fails instead of hanging),
// reports it in a toast and reloads every cached view of the repo.
const remote = async ($: EngineInterface, action: RemoteAction): Promise<void> => {
  if (busy !== undefined) return
  busy = action
  $.ui.invalidate('ui.render')
  const cwd = await $.session.cwd()
  let text: string
  try {
    const ran = await $.process.run(remoteArgv(action), {
      cwd,
      env: { GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 120000,
    })
    text = remoteSummary(action, ran.exitCode, ran.stdout, ran.stderr)
  } catch (error) {
    text = `git ${action}: failed: ${error instanceof Error ? error.message : String(error)}`
  }
  busy = undefined
  clear()
  await showBranch($, cwd)
  await $.ui.toast(text)
  $.ui.invalidate('ui.render')
}

const touched = ($: EngineInterface): void => {
  statusCache = undefined
  showCache.clear()
  changeCache.clear()
  hasHead = undefined
  $.ui.invalidate('ui.render')
}

// A section's name, as the user can quote it in chat; pressing a title copies it.
const copyName = async (
  $: EngineInterface,
  name: string,
  surface: Parameters<EngineInterface['ui']['copy']>[0]['surface'],
): Promise<void> => {
  const text = 'Git › ' + name
  const copied = await $.ui.copy({ text, surface })
  await $.ui.toast(
    copied.isCopied ? `Copied: ${text}` : `Copy failed: ${copied.reason}`,
  )
}

const keyOf = (commit: Commit): string => 'commit:' + commit.sha

export const register = (on: On): void => {
  // The explorer owns the plugin's only session.start hook, so the status line
  // is first set on the first prompt (or Bash call) of a session.
  on('prompt.submit', async ($, e, next) => {
    await showBranch($, await $.session.cwd())

    return next(e)
  })

  // Refresh after Bash may have run git; never denies or rewrites the call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    clear()
    await showBranch($, await $.session.cwd())
    $.ui.invalidate('ui.render')

    return ran
  })

  // The working tree changed: the status counts and the shown commits are
  // reread. Never denies or rewrites the call.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    touched($)

    return ran
  })
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    touched($)

    return ran
  })
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    touched($)

    return ran
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const element = e.element
    if (element !== undefined && element.startsWith('commit:')) {
      const sha = element.slice('commit:'.length)
      const state = await read($, git)
      const lines = graphCache.get(state.ref + '\0' + state.limit) ?? []
      const win = windowOf(
        lines,
        lines.findIndex(commit => commit.sha === sha),
        graphRows,
        state.offset,
      )
      if (state.selected !== sha || state.offset !== win.offset) {
        await update($, git, s => ({
          ...s,
          selected: sha,
          offset: win.offset,
          detailOffset: s.selected === sha ? s.detailOffset : 0,
        }))
      }
    }

    if (element !== undefined && element.startsWith('change:')) {
      const path = element.slice('change:'.length)
      const state = await read($, git)
      const rows = rowsOf(state)
      const win = windowOf(
        rows,
        rows.findIndex(row => row.kind === 'leaf' && row.item.path === path),
        changeRoom,
        state.changeOffset ?? 0,
      )
      if (state.change !== path || state.changeOffset !== win.offset) {
        await update($, git, s => ({
          ...s,
          change: path,
          changeOffset: win.offset,
          detailOffset: s.change === path ? s.detailOffset : 0,
        }))
      }
    }

    return next(e)
  })

  // Wheel: scrolls the section under the pointer. Keys: an arrow moves the
  // commit selection, a page key scrolls the details. The engine's own window
  // is never used, so the hook always answers `{}` without `next`.
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    const state = await read($, git)
    const isChanges = state.tab === 'changes'
    const pointer = e.pointer
    if (pointer !== undefined) {
      const isTop = view.isWide || pointer.row - 1 < view.topRows
      const middle = isChanges ? 'changeOffset' : 'offset'
      const part =
        isTop && pointer.column < view.branchEnd
          ? 'branchOffset'
          : isTop && (!view.isWide || pointer.column < view.graphEnd)
            ? middle
            : 'detailOffset'
      const max =
        part === 'branchOffset'
          ? view.branchMax
          : part === 'offset'
            ? view.graphMax
            : part === 'changeOffset'
              ? view.changeMax
              : view.detailMax
      const was = state[part] ?? 0
      const next = clamp(was + e.by, max)
      if (next !== was) await update($, git, s => ({ ...s, [part]: next }))
    } else if (Math.abs(e.by) === 1 && isChanges) {
      const rows = rowsOf(state)
      const leaves = rows.flatMap(row => (row.kind === 'leaf' ? [row.item.path] : []))
      const at = leaves.indexOf(state.change ?? leaves[0] ?? '')
      const path = leaves[clamp(at < 0 ? 0 : at + e.by, leaves.length - 1)]
      if (path !== undefined && path !== state.change) {
        const win = windowOf(
          rows,
          rows.findIndex(row => row.kind === 'leaf' && row.item.path === path),
          changeRoom,
          state.changeOffset ?? 0,
        )
        await update($, git, s => ({
          ...s,
          change: path,
          changeOffset: win.offset,
          detailOffset: 0,
        }))
        await $.ui.focus({ requestId: PANE, key: 'change:' + path })
      }
    } else if (Math.abs(e.by) === 1) {
      const lines = graphCache.get(state.ref + '\0' + state.limit) ?? []
      const at = lines.findIndex(commit => commit.sha === state.selected)
      const sha = lines[clamp(at < 0 ? 0 : at + e.by, lines.length - 1)]?.sha
      if (sha !== undefined && sha !== state.selected) {
        const win = windowOf(
          lines,
          lines.findIndex(commit => commit.sha === sha),
          graphRows,
          state.offset,
        )
        await update($, git, s => ({
          ...s,
          selected: sha,
          offset: win.offset,
          detailOffset: 0,
        }))
        await $.ui.focus({ requestId: PANE, key: 'commit:' + sha })
      }
    } else {
      const was = state.detailOffset ?? 0
      const detailOffset = clamp(
        was + Math.sign(e.by) * view.detailRows,
        view.detailMax,
      )
      if (detailOffset !== was) await update($, git, s => ({ ...s, detailOffset }))
    }
    $.ui.invalidate('ui.render')

    return {}
  })

  // A scrollbar dragged: the window moves, the selection stays (as the wheel).
  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as { offset?: unknown } | null
    const to = typeof data?.offset === 'number' ? data.offset : NaN
    if (!Number.isFinite(to)) return {}
    const parts = {
      'sb:branches': ['branchOffset', view.branchMax],
      'sb:graph': ['offset', view.graphMax],
      'sb:changes': ['changeOffset', view.changeMax],
      'sb:details': ['detailOffset', view.detailMax],
    } as const
    const part = parts[e.element as keyof typeof parts]
    if (part === undefined) return {}
    const value = clamp(Math.round(to), part[1])
    await update($, git, s => ({ ...s, [part[0]]: value }))
    $.ui.invalidate('ui.render')

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Code } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    const state = await read($, git)
    const cwd = await $.session.cwd()
    const before = threw
    const root = await rootOf($, cwd)
    if (root === null) {
      // An aborted lookup says nothing about the repo and nothing else redraws
      // this: look again shortly. A real "not a repo" waits for refresh.
      if (threw !== before) $.clock.after(1000, () => $.ui.invalidate('ui.render'))

      return (
        <Box flexDirection="column" width="100%" minHeight={e.props.scroll.bodyRows} backgroundColor={BACKGROUND}>
          <Text dimColor>Not a git repository</Text>
          <Button key="refresh" hotkey="r" label="refresh (r)" onPress={() => {
            clear()
            $.ui.invalidate('ui.render')
          }} />
        </Box>
      )
    }

    const columns = e.props.bodyColumns
    const bodyRows = e.props.scroll.bodyRows
    const home = await $.env.get('HOME')
    const changes = await statusOf($, cwd)
    const counts = changeCounts(changes)
    const isClean = counts.added + counts.modified + counts.deleted === 0
    const isChanges = state.tab === 'changes'
    const changeMode = state.changeView ?? 'list'
    const isWide = columns >= WIDE
    // Each section is framed in the session color.
    const border = borderOf(await read($, sessionColor))
    // One header row and one footer row; wide: the graph keeps a row for
    // `more`; stacked: the graph and branches take the top ~55%, the details
    // the rest.
    const area = Math.max(4, bodyRows - 2)
    const topRows = isWide ? area : Math.max(3, Math.floor(area * 0.55))
    const detailRows = isWide ? area : Math.max(3, area - topRows)
    // Each section is framed: 2 rows and 2 columns go to the border.
    const topInner = Math.max(3, topRows - 2)
    const detailInner = Math.max(3, detailRows - 2)
    graphRows = Math.max(2, topInner - 1)
    // Fixed cell widths (not percentages) so labels, hit-testing and the
    // drawn columns agree.
    const sideCols = Math.floor(columns * (isWide ? 0.2 : 0.3))
    const graphCols = isWide ? Math.floor(columns * 0.4) : columns - sideCols
    const graphWidth = graphCols - 5
    // the scrollbar takes one more column in each section
    const sideWidth = sideCols - 3

    const branches = await branchesOf($, cwd)
    const lines = isChanges ? [] : await graphOf($, cwd, state)
    // Lanes take whatever the graph column leaves beyond ~20 columns of text.
    const maxLanes = Math.max(1, Math.floor((graphWidth - 20) / 2))
    const laid = layoutGraph(lines, maxLanes)
    const index = lines.findIndex(commit => commit.sha === state.selected)
    const selected = index >= 0 ? lines[index] : lines[0]
    // The wheel moves the window off the selection, so it only clamps here.
    const win = windowOf(laid, -1, graphRows, state.offset)
    // Rows are padded to the widest lanes in view, so the text lines up
    // without leaving room for lanes scrolled out of it.
    const laneCols = win.rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
    const isMore = lines.length >= state.limit
    // A commit scrolled out of the window is not focused: autoFocus would move
    // the selection to whatever row the wheel brought in.
    const focusKey =
      selected === undefined || !win.rows.some(row => row.commit === selected)
        ? undefined
        : keyOf(selected)
    const remotes = new Set(branches.filter(branch => branch.isRemote).map(branch => branch.name))
    changeRoom = Math.max(2, topInner)
    const crows = isChanges ? rowsOf(state) : []
    const leaves = crows.flatMap(row => (row.kind === 'leaf' ? [row.item] : []))
    const chosen = leaves.find(change => change.path === state.change) ?? leaves[0]
    const cwin = windowOf(crows, -1, changeRoom, state.changeOffset ?? 0)
    const changeFocus =
      chosen !== undefined &&
      cwin.rows.some(row => row.kind === 'leaf' && row.item.path === chosen.path)
        ? 'change:' + chosen.path
        : undefined
    const details = isChanges
      ? chosen === undefined
        ? undefined
        : await changeDetailsOf($, root, chosen)
      : selected === undefined
        ? undefined
        : await detailsOf($, cwd, selected.sha)
    const headRows = Math.max(6, Math.floor(detailInner / 2))
    const headAll =
      details === undefined
        ? []
        : isChanges || selected === undefined
          ? details.head
          : infoHead(details.head, selected)
    const head = headAll.slice(0, headRows)
    const diffRows = Math.max(1, detailInner - head.length)
    const diffTotal = details === undefined ? 0 : diffLines(details.diff).length
    const detailOffset = clamp(state.detailOffset ?? 0, diffTotal - diffRows)
    const diff =
      details === undefined ? '' : sliceDiff(details.diff, detailOffset, diffRows)
    const head0 = branches.find(branch => branch.isHead)
    const branchRoom = Math.max(2, topInner - 1)
    const tree = branchTree(branches, new Set(state.collapsed ?? []))
    const branchWin = windowOf(tree, -1, branchRoom, state.branchOffset ?? 0)
    const branchRows = branchWin.rows
    view.isWide = isWide
    view.branchEnd = sideCols
    view.graphEnd = sideCols + graphCols
    view.topRows = topRows
    view.branchMax = Math.max(0, tree.length - branchRoom)
    view.graphMax = Math.max(0, lines.length - graphRows)
    view.changeMax = Math.max(0, crows.length - changeRoom)
    view.detailMax = Math.max(0, diffTotal - diffRows)
    view.detailRows = diffRows
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

    // Draggable on surfaces that draw a `Client`, the Text column elsewhere;
    // `lead` blank rows sit above the bar (the section's header rows).
    const dragBar = (
      key: string,
      total: number,
      rows: number,
      offset: number,
      lead = 0,
    ) =>
      Client === undefined || total <= rows ? (
        bar([...Array.from({ length: lead }, () => ' '), ...scrollbar(total, rows, offset, rows)])
      ) : (
        <Box flexDirection="column" width={1} flexShrink={0}>
          {Array.from({ length: lead }, (_, i) => (
            <Text key={'lead:' + i}> </Text>
          ))}
          <Client
            key={key}
            module="../shared/scrollbar-client.tsx"
            props={{ total, visible: rows, offset, height: rows, color: border.borderColor }}
            width={1}
            height={rows}
          />
        </Box>
      )

    const select = (ref: string) =>
      update($, git, s => ({
        ...s,
        tab: 'graph' as const,
        ref,
        offset: 0,
        detailOffset: 0,
        selected: undefined,
        limit: PAGE,
      }))

    const toggle = (key: string) =>
      update($, git, s => {
        const shut = s.collapsed ?? []

        return {
          ...s,
          collapsed: shut.includes(key) ? shut.filter(k => k !== key) : [...shut, key],
        }
      })

    const showTab = (tab: 'graph' | 'changes') =>
      update($, git, s => ({
        ...s,
        tab,
        detailOffset: 0,
        ...(tab === 'graph' ? { offset: 0 } : { changeOffset: 0 }),
      }))

    const toggleChange = (key: string) =>
      update($, git, s => {
        const shut = s.changeCollapsed ?? []

        return {
          ...s,
          changeCollapsed: shut.includes(key) ? shut.filter(k => k !== key) : [...shut, key],
        }
      })

    // The section's name sits on its top border; the middle section's name follows
    // the active tab. A bordered Box clips its children, so the overlay sits after
    // it in an unbordered wrapper of the same size, at top={0}. A Button has no
    // text color, so black Text is drawn over it; the press still lands on the Button.
    const titled = (key: string, name: string) => (
      <Box position="absolute" top={0} left={1} backgroundColor={border.borderColor}>
        <Button
          key={key}
          plain
          label={' ' + name + ' '}
          onPress={press => copyName($, name, press.surface)}
        />
        <Box position="absolute" top={0} left={0}>
          <Text color="black">{' ' + name + ' '}</Text>
        </Box>
      </Box>
    )

    const branchColumn = (
      <Box flexDirection="column" width={sideCols} flexShrink={0} height={topRows}>
      <Box {...border} flexDirection="row" height="100%">
        <Box flexDirection="column" flexGrow={1}>
        <Button
          key="all"
          hotkey="a"
          plain
          label={(state.ref === 'all' ? '▌' : ' ') + 'all'}
          onPress={() => select('all')}
        />
        {branchRows.map((row: BranchRow) => {
          // Rails per depth as in the explorer; a folder opens or closes.
          const rails = '│ '.repeat(row.depth)
          const room = Math.max(4, sideWidth - 1 - rails.length)
          if (row.kind === 'folder') {
            return (
              <Box key={'bline:' + row.key} flexDirection="row">
                <Text> </Text>
                {row.depth > 0 && <Text dimColor>{rails}</Text>}
                <Button
                  key={'bdir:' + row.key}
                  plain
                  dimColor={row.key.startsWith('r:')}
                  label={fit((row.isOpen ? '▾ ' : '▸ ') + row.name + '/', room)}
                  onPress={() => toggle(row.key)}
                />
              </Box>
            )
          }
          const { branch } = row
          const isSelected = state.ref === branch.name

          return (
            <Box
              key={'bline:' + branch.name}
              flexDirection="row"
              backgroundColor={isSelected ? SELECTED : undefined}
            >
              <Text color={border.borderColor}>{isSelected ? '▌' : ' '}</Text>
              {row.depth > 0 && <Text dimColor>{rails}</Text>}
              <Button
                key={'branch:' + branch.name}
                plain
                dimColor={branch.isRemote}
                label={fit(
                  (branch.isHead ? '* ' : '  ') +
                    row.name +
                    (trackLabel(branch.track) === '' ? '' : ' ' + trackLabel(branch.track)),
                  room,
                )}
                onPress={() => select(branch.name)}
              />
            </Box>
          )
        })}
        </Box>
        {dragBar('sb:branches', tree.length, branchRoom, branchWin.offset, 1)}
      </Box>
      {titled('title:branches', 'Branches')}
      </Box>
    )

    const graphColumn = (
      <Box flexDirection="column" width={graphCols} flexShrink={0} height={topRows}>
      <Box {...border} flexDirection="row" height="100%">
        {isChanges ? (
        <Box flexDirection="column" flexGrow={1}>
          {crows.length === 0 && <Text dimColor>Working tree clean</Text>}
          {cwin.rows.map(row => {
            const rails = '│ '.repeat(row.depth)
            if (row.kind === 'folder') {
              return (
                <Box key={'cline:' + row.key} flexDirection="row">
                  <Text> </Text>
                  {row.depth > 0 && <Text dimColor>{rails}</Text>}
                  <Button
                    key={'cdir:' + row.key}
                    plain
                    label={fit((row.isOpen ? '▾ ' : '▸ ') + row.name + '/', graphWidth - 1 - rails.length)}
                    onPress={() => toggleChange(row.key)}
                  />
                </Box>
              )
            }
            const change = row.item
            const isSelected = change.path === chosen?.path
            const glyph = changeGlyph(change)
            const label = fitStart(row.name, Math.max(4, graphWidth - 3 - rails.length))
            const slash = label.lastIndexOf('/')

            return (
              <Box
                key={'cline:' + change.path}
                flexDirection="row"
                backgroundColor={isSelected ? SELECTED : undefined}
              >
                <Text color={border.borderColor}>{isSelected ? '▌' : ' '}</Text>
                {row.depth > 0 && <Text dimColor>{rails}</Text>}
                <Text color={GLYPH_COLOR[glyph] ?? 'white'} dimColor={glyph === '?' ? true : undefined}>
                  {glyph}
                </Text>
                <Text> </Text>
                {slash >= 0 && <Text dimColor>{label.slice(0, slash + 1)}</Text>}
                <Button
                  key={'change:' + change.path}
                  plain
                  autoFocus={'change:' + change.path === changeFocus ? true : undefined}
                  label={label.slice(slash + 1)}
                  onPress={() =>
                    update($, git, s => ({
                      ...s,
                      change: change.path,
                      detailOffset: s.change === change.path ? s.detailOffset : 0,
                    }))
                  }
                />
              </Box>
            )
          })}
        </Box>
        ) : (
        <Box flexDirection="column" flexGrow={1}>
          {lines.length === 0 && <Text dimColor>(no commits)</Text>}
          {win.rows.map(row => {
            const { commit } = row
            const isSelected = commit.sha === selected?.sha
            const pick = () =>
              update($, git, s => ({
                ...s,
                selected: commit.sha,
                detailOffset: s.selected === commit.sha ? s.detailOffset : 0,
              }))
            // refs that fit ~40% of what the lanes leave, the rest as `…`
            const room = graphWidth - laneCols - 9
            const refs: string[] = []
            let used = 0
            for (const ref of commit.refs) {
              if (used + ref.length + 1 > Math.floor(room * 0.4)) {
                refs.push('…')
                break
              }
              refs.push(ref)
              used += ref.length + 1
            }

            return (
              <Box
                key={'row:' + commit.sha}
                flexDirection="row"
                backgroundColor={isSelected ? SELECTED : undefined}
              >
                {cellRuns(row.cells, laneCols + 1).map((seg, i) => (
                  <Text key={'lane:' + i} color={LANE_COLORS[seg.color % PALETTE_SIZE]}>
                    {seg.text}
                  </Text>
                ))}
                <Button
                  key={keyOf(commit)}
                  plain
                  dimColor
                  autoFocus={keyOf(commit) === focusKey ? true : undefined}
                  label={(isSelected ? '>' : ' ') + commit.short}
                  onPress={pick}
                />
                <Text> </Text>
                {refs.map((ref, i) => (
                  <Text key={'ref:' + i} color={refColor(ref, remotes)} dimColor={remotes.has(ref) ? true : undefined}>
                    {ref + ' '}
                  </Text>
                ))}
                <Button
                  key={'subject:' + commit.sha}
                  plain
                  label={fit(commit.subject, Math.max(4, room - used))}
                  onPress={pick}
                />
              </Box>
            )
          })}
          {isMore && (
            <Button
              key="more"
              plain
              label={`more (+${PAGE})`}
              onPress={() => update($, git, s => ({ ...s, limit: s.limit + PAGE }))}
            />
          )}
        </Box>
        )}
        {isChanges
          ? dragBar('sb:changes', crows.length, changeRoom, cwin.offset)
          : dragBar('sb:graph', lines.length, graphRows, win.offset)}
      </Box>
        {titled(isChanges ? 'title:changes' : 'title:commits', isChanges ? 'Changes' : 'Commits')}
        {/* No `(g)` suffixes: the terminal already prefixes a plain Button with its hotkey. */}
        <Box position="absolute" top={0} right={1} flexDirection="row" gap={1}>
          <Button
            key="tab:graph"
            hotkey="g"
            plain
            dimColor={isChanges ? true : undefined}
            label={(isChanges ? ' ' : '▌') + 'Graph'}
            onPress={() => showTab('graph' as const)}
          />
          <Button
            key="tab:changes"
            hotkey="c"
            plain
            dimColor={isChanges ? undefined : true}
            label={
              (isChanges ? '▌' : ' ') +
              'Changes' +
              (changes.length > 0 ? ' ' + changes.length : '')
            }
            onPress={() => showTab('changes')}
          />
          {isChanges && (
            <Button
              key="view"
              hotkey="v"
              plain
              label={`view: ${changeMode}`}
              onPress={() =>
                update($, git, s => ({
                  ...s,
                  changeView: changeMode === 'list' ? ('tree' as const) : ('list' as const),
                  changeOffset: 0,
                }))
              }
            />
          )}
        </Box>
      </Box>
    )

    const detailColumn = (
      <Box flexDirection="column" flexGrow={1} height={detailRows}>
      <Box {...border} flexDirection="row" height="100%" flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>
        {details === undefined && (
          <Text dimColor>{isChanges ? 'Select a change.' : 'Select a commit.'}</Text>
        )}
        {head.map((text, i) => (
          <Text key={'head:' + i} bold={i === 0} wrap="truncate-end">
            {text}
          </Text>
        ))}
        {diff !== '' && (
          <Code source={diff} format="diff" wrap="truncate-end" />
        )}
        {isChanges && details !== undefined && diff === '' && (
          <Text dimColor>
            {/^(Binary files|GIT binary patch)/m.test(details.diff)
              ? 'Binary file.'
              : 'No textual changes.'}
          </Text>
        )}
        </Box>
        {dragBar('sb:details', diffTotal, diffRows, detailOffset, head.length)}
      </Box>
      {titled('title:info', 'Info')}
      </Box>
    )

    return (
      <Box flexDirection="column" width="100%" minHeight={e.props.scroll.bodyRows} backgroundColor={BACKGROUND}>
        <Box flexDirection="row" gap={1}>
          <Button
            key="refresh"
            hotkey="r"
            label="refresh (r)"
            onPress={() => {
              clear()
              $.ui.invalidate('ui.render')
            }}
          />
          <Button
            key="fetch"
            hotkey="f"
            label={busy === 'fetch' ? 'fetching…' : 'fetch (f)'}
            onPress={() => remote($, 'fetch')}
          />
          <Button
            key="pull"
            hotkey="p"
            label={busy === 'pull' ? 'pulling…' : 'pull (p)'}
            onPress={() => remote($, 'pull')}
          />
        </Box>
        {isWide ? (
          <Box flexDirection="row">
            {branchColumn}
            {graphColumn}
            {detailColumn}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row">
              {branchColumn}
              {graphColumn}
            </Box>
            {detailColumn}
          </Box>
        )}
        <Box flexDirection="row" justifyContent="space-between" gap={2}>
          <Box flexShrink={1}>
            <Text key="footer:dir" wrap="truncate-start">
              <Text dimColor>{shortDir(root, home)}</Text>
              <Text color="cyan">{` (${head0?.name ?? 'detached'})`}</Text>
            </Text>
          </Box>
          <Box flexShrink={0} paddingRight={1}>
            <Text key="footer:counts" dimColor={isClean}>
              <Text color={isClean ? undefined : 'green'}>{`+${counts.added}`}</Text>
              <Text> </Text>
              <Text color={isClean ? undefined : 'yellow'}>{`~${counts.modified}`}</Text>
              <Text> </Text>
              <Text color={isClean ? undefined : 'red'}>{`-${counts.deleted}`}</Text>
            </Text>
          </Box>
        </Box>
      </Box>
    )
  })
}
