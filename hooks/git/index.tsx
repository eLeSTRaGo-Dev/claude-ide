import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState } from '../../types'
import { window as windowOf } from '../explorer/tree'
import {
  branchesArgv,
  clipDiff,
  commitLabel,
  logArgv,
  parseBranches,
  parseGraph,
  patchArgv,
  splitShow,
  statArgv,
  trackLabel,
} from './git'
import type { Branch, GraphLine } from './git'

type On = Parameters<Register>[0]

const PANE = 'ide-git'
const PAGE = 200
// Pane body columns from which the three-column layout is used.
const WIDE = 140

const git = atom<'ide-panes', 'git'>(
  { plugin: 'ide-panes', key: 'git' } as const,
  { ref: 'all', offset: 0, limit: PAGE } satisfies GitState,
)

// Git output is cached here, not in $.state; `refresh` clears it.
let repoRoot: string | null | undefined
let branchCache: Branch[] | undefined
const graphCache = new Map<string, GraphLine[]>()
const showCache = new Map<string, { head: string[]; diff: string }>()
// Rows the graph window shows; set by render, read by the focus hook.
let graphRows = 20

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

const keyOf = (line: GraphLine): string => 'commit:' + (line.commit?.sha ?? '')

export const register = (on: On): void => {
  // The `git` command is registered by the explorer's session.start hook: the
  // validator allows one unmatched session.start hook per plugin.
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
        await update($, git, s => ({ ...s, selected: sha, offset: win.offset }))
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const state = await read($, git)
    const cwd = await $.session.cwd()
    const root = await rootOf($, cwd)
    if (root === null) {
      return (
        <Box flexDirection="column">
          <Text bold>Git</Text>
          <Text dimColor>Not a git repository</Text>
          <Button key="refresh" label="refresh" onPress={() => {
            clear()
            $.ui.invalidate('ui.render')
          }} />
        </Box>
      )
    }

    const columns = e.props.bodyColumns
    const bodyRows = e.props.scroll.bodyRows
    const isWide = columns >= WIDE
    // One header row; wide: the graph keeps a row for `more`; stacked: the
    // graph and branches take the top ~55%, the details the rest.
    const area = Math.max(4, bodyRows - 1)
    const topRows = isWide ? area : Math.max(3, Math.floor(area * 0.55))
    const detailRows = isWide ? area : Math.max(3, area - topRows)
    graphRows = Math.max(3, topRows - 1)
    const graphWidth = isWide
      ? Math.floor(columns * 0.4) - 2
      : columns - Math.floor(columns * 0.3) - 2
    const sideWidth = isWide ? Math.floor(columns * 0.2) : Math.floor(columns * 0.3)

    const branches = await branchesOf($, cwd)
    const lines = await graphOf($, cwd, state)
    const index = lines.findIndex(line => line.commit?.sha === state.selected)
    const current = index >= 0 ? lines[index] : lines.find(line => line.commit)
    const selected = current?.commit
    const win = windowOf(lines, index, graphRows, state.offset)
    const isMore = lines.filter(line => line.commit).length >= state.limit
    const focusKey = selected === undefined ? undefined : keyOf(current as GraphLine)
    const details =
      selected === undefined ? undefined : await detailsOf($, cwd, selected.sha)
    const headRows = Math.max(3, Math.floor(detailRows / 2))
    const head = details === undefined ? [] : details.head.slice(0, headRows)
    const diffRows = Math.max(1, detailRows - head.length)
    const head0 = branches.find(branch => branch.isHead)
    const branchRows = windowOf(
      branches,
      branches.findIndex(branch => branch.name === state.ref),
      Math.max(3, topRows - 1),
    ).rows

    const select = (ref: string) =>
      update($, git, s => ({
        ...s,
        ref,
        offset: 0,
        selected: undefined,
        limit: PAGE,
      }))

    const branchColumn = (
      <Box flexDirection="column" width={isWide ? '20%' : '30%'}>
        <Button
          key="all"
          plain
          label={(state.ref === 'all' ? '>' : ' ') + ' all'}
          onPress={() => select('all')}
        />
        {branchRows.map(branch => (
          <Button
            key={'branch:' + branch.name}
            plain
            dimColor={branch.isRemote}
            label={fit(
              (state.ref === branch.name ? '>' : ' ') +
                (branch.isHead ? '* ' : '  ') +
                branch.name +
                (trackLabel(branch.track) === ''
                  ? ''
                  : ' ' + trackLabel(branch.track)),
              sideWidth,
            )}
            onPress={() => select(branch.name)}
          />
        ))}
      </Box>
    )

    const graphColumn = (
      <Box flexDirection="column" flexGrow={isWide ? undefined : 1} width={isWide ? '40%' : undefined}>
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
    )

    const detailColumn = (
      <Box flexDirection="column" flexGrow={1}>
        {selected === undefined && <Text dimColor>Select a commit.</Text>}
        {head.map((text, i) => (
          <Text key={'head:' + i} bold={i === 0} wrap="truncate-end">
            {text}
          </Text>
        ))}
        {details !== undefined && clipDiff(details.diff, diffRows) !== '' && (
          <Code
            source={clipDiff(details.diff, diffRows)}
            format="diff"
            wrap="truncate-end"
          />
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>Git</Text>
          <Text dimColor wrap="truncate-start">
            {root}
          </Text>
          <Text>{head0 === undefined ? '(detached)' : head0.name}</Text>
          <Button
            key="refresh"
            label="refresh"
            onPress={() => {
              clear()
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
        {isWide ? (
          <Box flexDirection="row" gap={1}>
            {branchColumn}
            {graphColumn}
            {detailColumn}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
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
