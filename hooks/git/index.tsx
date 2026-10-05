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
  branchesArgv,
  commitLabel,
  diffLines,
  logArgv,
  parseBranches,
  parseGraph,
  patchArgv,
  sliceDiff,
  splitShow,
  statArgv,
  trackLabel,
} from './git'
import type { Branch, BranchRow, GraphLine, RemoteAction } from './git'

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
const graphCache = new Map<string, GraphLine[]>()
const showCache = new Map<string, { head: string[]; diff: string }>()
// Rows the graph window shows; set by render, read by the focus hook.
let graphRows = 20
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
  detailMax: 0,
  detailRows: 1,
}

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max))

const clear = (): void => {
  repoRoot = undefined
  branchCache = undefined
  graphCache.clear()
  showCache.clear()
}

// Read-only git call; undefined on a non-zero exit or any failure.
const run = async (
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

const rootOf = async (
  $: EngineInterface,
  cwd: string,
): Promise<string | null> => {
  if (repoRoot === undefined) {
    const out = await run($, cwd, ['git', 'rev-parse', '--show-toplevel'])
    repoRoot = out === undefined ? null : out.trim()
  }

  return repoRoot
}

const branchesOf = async (
  $: EngineInterface,
  cwd: string,
): Promise<Branch[]> => {
  if (branchCache === undefined) {
    branchCache = parseBranches((await run($, cwd, branchesArgv())) ?? '')
  }

  return branchCache
}

const graphOf = async (
  $: EngineInterface,
  cwd: string,
  state: GitState,
): Promise<GraphLine[]> => {
  const key = state.ref + '\0' + state.limit
  let lines = graphCache.get(key)
  if (lines === undefined) {
    lines = parseGraph(
      (await run($, cwd, logArgv(state.ref, state.limit))) ?? '',
    )
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
    const [stat, patch] = await Promise.all([
      run($, cwd, statArgv(sha)),
      run($, cwd, patchArgv(sha)),
    ])
    shown = {
      head: splitShow(stat ?? ''),
      diff: (patch ?? '').replace(/^\n+/, ''),
    }
    showCache.set(sha, shown)
  }

  return shown
}

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

const keyOf = (line: GraphLine): string => 'commit:' + (line.commit?.sha ?? '')

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

  on('command.run', { command: 'git' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Git', focus: true })

    return { text: 'Git view opened.' }
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const element = e.element
    if (element !== undefined && element.startsWith('commit:')) {
      const sha = element.slice('commit:'.length)
      const state = await read($, git)
      const lines =
        graphCache.get(state.ref + '\0' + state.limit) ?? ([] as GraphLine[])
      const win = windowOf(
        lines,
        lines.findIndex(line => line.commit?.sha === sha),
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

    return next(e)
  })

  // Wheel: scrolls the section under the pointer. Keys: an arrow moves the
  // commit selection, a page key scrolls the details. The engine's own window
  // is never used, so the hook always answers `{}` without `next`.
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    const state = await read($, git)
    const pointer = e.pointer
    if (pointer !== undefined) {
      const isTop = view.isWide || pointer.row - 1 < view.topRows
      const part =
        isTop && pointer.column < view.branchEnd
          ? 'branchOffset'
          : isTop && (!view.isWide || pointer.column < view.graphEnd)
            ? 'offset'
            : 'detailOffset'
      const max =
        part === 'branchOffset'
          ? view.branchMax
          : part === 'offset'
            ? view.graphMax
            : view.detailMax
      const was = state[part] ?? 0
      const next = clamp(was + e.by, max)
      if (next !== was) await update($, git, s => ({ ...s, [part]: next }))
    } else if (Math.abs(e.by) === 1) {
      const lines = graphCache.get(state.ref + '\0' + state.limit) ?? []
      const commits = lines.filter(line => line.commit !== undefined)
      const at = commits.findIndex(line => line.commit?.sha === state.selected)
      const target = commits[clamp(at < 0 ? 0 : at + e.by, commits.length - 1)]
      const sha = target?.commit?.sha
      if (sha !== undefined && sha !== state.selected) {
        const win = windowOf(
          lines,
          lines.findIndex(line => line.commit?.sha === sha),
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
    const root = await rootOf($, cwd)
    if (root === null) {
      return (
        <Box flexDirection="column" width="100%" minHeight={e.props.scroll.bodyRows} backgroundColor={BACKGROUND}>
          <Text bold>Git</Text>
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
    const isWide = columns >= WIDE
    // Each section is framed in the session color.
    const border = borderOf(await read($, sessionColor))
    // One header row; wide: the graph keeps a row for `more`; stacked: the
    // graph and branches take the top ~55%, the details the rest.
    const area = Math.max(4, bodyRows - 1)
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
    const lines = await graphOf($, cwd, state)
    const index = lines.findIndex(line => line.commit?.sha === state.selected)
    const current = index >= 0 ? lines[index] : lines.find(line => line.commit)
    const selected = current?.commit
    // The wheel moves the window off the selection, so it only clamps here.
    const win = windowOf(lines, -1, graphRows, state.offset)
    const isMore = lines.filter(line => line.commit).length >= state.limit
    // A commit scrolled out of the window is not focused: autoFocus would move
    // the selection to whatever row the wheel brought in.
    const focusKey =
      selected === undefined || !win.rows.includes(current as GraphLine)
        ? undefined
        : keyOf(current as GraphLine)
    const details =
      selected === undefined ? undefined : await detailsOf($, cwd, selected.sha)
    const headRows = Math.max(3, Math.floor(detailInner / 2))
    const head = details === undefined ? [] : details.head.slice(0, headRows)
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

    const branchColumn = (
      <Box flexDirection="row" width={sideCols} flexShrink={0} height={topRows} {...border}>
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
    )

    const graphColumn = (
      <Box flexDirection="row" width={graphCols} flexShrink={0} height={topRows} {...border}>
        <Box flexDirection="column" flexGrow={1}>
        {lines.length === 0 && <Text dimColor>(no commits)</Text>}
        {win.rows.map((line, i) =>
          line.commit === undefined ? (
            <Text key={'graph:' + (win.offset + i)} dimColor wrap="truncate-end">
              {line.graph}
            </Text>
          ) : (
            <Button
              key={keyOf(line)}
              plain
              autoFocus={keyOf(line) === focusKey ? true : undefined}
              label={fit(
                (line.commit.sha === selected?.sha ? '>' : ' ') + commitLabel(line),
                graphWidth,
              )}
              onPress={() =>
                update($, git, s => ({
                  ...s,
                  selected: line.commit?.sha,
                  detailOffset: s.selected === line.commit?.sha ? s.detailOffset : 0,
                }))
              }
            />
          ),
        )}
        {isMore && (
          <Button
            key="more"
            plain
            label={`more (+${PAGE})`}
            onPress={() => update($, git, s => ({ ...s, limit: s.limit + PAGE }))}
          />
        )}
        </Box>
        {dragBar('sb:graph', lines.length, graphRows, win.offset)}
      </Box>
    )

    const detailColumn = (
      <Box flexDirection="row" flexGrow={1} height={detailRows} {...border}>
        <Box flexDirection="column" flexGrow={1}>
        {selected === undefined && <Text dimColor>Select a commit.</Text>}
        {head.map((text, i) => (
          <Text key={'head:' + i} bold={i === 0} wrap="truncate-end">
            {text}
          </Text>
        ))}
        {diff !== '' && (
          <Code source={diff} format="diff" wrap="truncate-end" />
        )}
        </Box>
        {dragBar('sb:details', diffTotal, diffRows, detailOffset, head.length)}
      </Box>
    )

    return (
      <Box flexDirection="column" width="100%" minHeight={e.props.scroll.bodyRows} backgroundColor={BACKGROUND}>
        <Box flexDirection="row" gap={1}>
          <Text bold>Git</Text>
          <Text dimColor wrap="truncate-start">
            {root}
          </Text>
          <Text>{head0 === undefined ? '(detached)' : head0.name}</Text>
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
      </Box>
    )
  })
}
