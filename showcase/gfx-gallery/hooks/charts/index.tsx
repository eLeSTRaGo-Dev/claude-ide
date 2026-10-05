import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  DAY, LOG_FORMAT, WEEKDAYS, addDays, bucketByDay, buildGrid, dailySeries, dayKey, fmt, inRange, monthLabels,
  niceMax, parseLog, resample, startOfDay, summary, weekdayTotals,
} from './data'
import type { Commit } from './data'
import { LEVELS, barCells, heatCells, lineCells } from './plots'
import { barsSvg, heatSvg, lineSvg } from './svg'

const PANE = 'gfx-charts'
const charts = atom({ plugin: 'gfx-gallery', key: 'charts' } as const, { weeks: 52 })

const FETCH_WEEKS = 53
const AXIS = 5 // y-axis label column
const LABEL = 4 // weekday label column of the heat map

// Per root; reset on reload. `refresh` clears it.
let cache: { root: string; commits: Commit[] | null } | undefined

async function load($: EngineInterface, root: string): Promise<Commit[] | null> {
  if (cache?.root === root) return cache.commits
  let commits: Commit[] | null = null
  try {
    const run = await $.process.run(
      ['git', 'log', `--since=${FETCH_WEEKS * 7} days ago`, `--format=${LOG_FORMAT}`, '--shortstat'],
      { cwd: root },
    )
    if (run.exitCode === 0) commits = parseLog(run.stdout)
  } catch {
    commits = null
  }
  cache = { root, commits }

  return commits
}

const center = (text: string, width: number): string => {
  const t = text.slice(0, width)
  const left = Math.floor((width - t.length) / 2)

  return ' '.repeat(left) + t + ' '.repeat(width - t.length - left)
}

/** Top, middle and bottom value labels in a column of `rows` rows. */
function axisLabels(top: number, rows: number): string[] {
  const out = Array.from({ length: rows }, () => ' '.repeat(AXIS))
  const put = (row: number, v: number) => { out[row] = (fmt(v) + ' ').padStart(AXIS) }
  put(0, top)
  if (rows >= 5) put(Math.floor((rows - 1) / 2), top / 2)
  put(rows - 1, 0)

  return out
}

export function register(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, charts)
    const root = await $.session.root()
    const now = await $.clock.now()
    const commits = await load($, root)
    const refresh = (
      <Button
        key="refresh"
        hotkey="r"
        label="refresh (r)"
        onPress={() => {
          cache = undefined
          $.ui.invalidate('ui.render')
        }}
      />
    )

    if (commits === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Not a git repository: nothing to chart.</Text>
          {refresh}
        </Box>
      )
    }

    const columns = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    const fitWeeks = Math.max(4, Math.floor((columns - LABEL) / 2))
    const weeks = Math.max(4, Math.min(state.weeks, fitWeeks, FETCH_WEEKS))
    const days = bucketByDay(commits)
    const grid = buildGrid(days, now, weeks)
    const shown = inRange(commits, now, weeks)
    const sum = summary(shown)
    const span = weeks * 7
    const header = (
      <Box flexDirection="row" gap={1}>
        {refresh}
        {[13, 26, 52].map(w => (
          <Button key={'w' + w} plain label={w === state.weeks ? `[${w}w]` : `${w}w`} onPress={() => update($, charts, s => ({ ...s, weeks: w }))} />
        ))}
        <Text dimColor>
          {sum.commits} commits, +{sum.added} -{sum.deleted}, {weeks} weeks
        </Text>
      </Box>
    )
    const perWeekday = weekdayTotals(shown)

    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const heat = heatCells(grid)
      const months = Array.from({ length: heat.columns }, () => ' ')
      for (const m of monthLabels(grid)) {
        for (let i = 0; i < m.label.length && m.col * 2 + i < months.length; i++) months[m.col * 2 + i] = m.label[i]!
      }
      const room = Math.max(0, rows - 14)
      const lineRows = Math.max(3, Math.ceil(room * 0.55))
      const barRows = Math.max(2, room - lineRows)
      const plotCols = Math.max(8, columns - AXIS - 1)
      const series = resample(dailySeries(days, now, span), plotCols * 2)
      const lineTop = niceMax(Math.max(0, ...series))
      const slot = Math.max(4, Math.min(10, Math.floor(plotCols / 7)))
      const bars = barCells(perWeekday, niceMax(Math.max(...perWeekday)), slot - 2, 2, barRows)
      const barTop = niceMax(Math.max(...perWeekday))
      const first = dayKey(addDays(startOfDay(now), -span + 1))
      const last = dayKey(now)
      const xAxis = first + ' '.repeat(Math.max(1, plotCols - first.length - last.length)) + last

      return (
        <Box flexDirection="column">
          {header}
          <Box flexDirection="row">
            <Text bold>Contributions </Text>
            <Text dimColor>less </Text>
            {LEVELS.map((c, i) => (
              <Text key={'lg' + i} color={'#' + c.toString(16).padStart(6, '0')}>
                {'█'}
              </Text>
            ))}
            <Text dimColor> more</Text>
          </Box>
          <Text dimColor>{' '.repeat(LABEL) + months.join('')}</Text>
          <Box flexDirection="row">
            <Box flexDirection="column" width={LABEL}>
              {WEEKDAYS.map((d, i) => (
                <Text key={d} dimColor>
                  {i % 2 === 1 ? d : ' '}
                </Text>
              ))}
            </Box>
            <Raster key="heat" columns={heat.columns} rows={heat.rows} cells={heat.cells} />
          </Box>
          <Text bold>Commits per day (mean)</Text>
          <Box flexDirection="row">
            <Box flexDirection="column" width={AXIS}>
              {axisLabels(lineTop, lineRows).map((l, i) => (
                <Text key={'ya' + i} dimColor>
                  {l}
                </Text>
              ))}
            </Box>
            <Raster key="line" columns={plotCols} rows={lineRows} cells={lineCells(series, lineTop, plotCols, lineRows)} />
          </Box>
          <Text dimColor>{' '.repeat(AXIS) + xAxis}</Text>
          <Text bold>Commits per weekday</Text>
          <Box flexDirection="row">
            <Box flexDirection="column" width={AXIS}>
              {axisLabels(barTop, barRows).map((l, i) => (
                <Text key={'yb' + i} dimColor>
                  {l}
                </Text>
              ))}
            </Box>
            <Raster key="bars" columns={bars.columns} rows={barRows} cells={bars.cells} />
          </Box>
          <Text dimColor>{' '.repeat(AXIS) + WEEKDAYS.map(d => center(d, slot)).join('')}</Text>
          <Text>{' '.repeat(AXIS) + perWeekday.map(n => center(String(n), slot)).join('')}</Text>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const width = Math.max(240, Math.min(columns * 8, 900))
    const points = Math.min(span, Math.max(20, Math.floor(width / 4)))
    const series = resample(dailySeries(days, now, span), points)
    const labels = series.map((_, i) => dayKey(now - (span - 1) * DAY * (1 - i / Math.max(1, points - 1))))
    const names = [...WEEKDAYS]

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Text bold>Contributions</Text>
        <Svg isInteractive alt={`Contribution heat map: ${sum.commits} commits in ${weeks} weeks`} source={heatSvg(grid)} />
        <Text bold>Commits per day (mean)</Text>
        <Svg isInteractive alt="Line chart of commits per day" source={lineSvg(series, labels, width)} width={width} />
        <Text bold>Commits per weekday</Text>
        <Svg isInteractive alt="Bar chart of commits per weekday" source={barsSvg(names, perWeekday, width)} width={width} />
      </Box>
    )
  })
}
