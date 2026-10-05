// Pure helpers: parse `git log`, bucket by day, scales. No `$`.

export type Commit = { ts: number; author: string; added: number; deleted: number }

export const DAY = 86400000

/** Output of `git log --format=@%ct%x09%an --shortstat` */
export const LOG_FORMAT = '@%ct%x09%an'

/** Commits from `@<unix>\t<author>` header lines, each followed by an optional shortstat line. */
export function parseLog(text: string): Commit[] {
  const out: Commit[] = []
  let cur: Commit | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith('@')) {
      const tab = line.indexOf('\t')
      const ts = Number(line.slice(1, tab < 0 ? undefined : tab))
      if (!Number.isFinite(ts)) { cur = undefined; continue }
      cur = { ts, author: tab < 0 ? '' : line.slice(tab + 1).trim(), added: 0, deleted: 0 }
      out.push(cur)
    } else if (cur !== undefined && line.includes('changed')) {
      cur.added = Number(/(\d+) insertion/.exec(line)?.[1] ?? 0)
      cur.deleted = Number(/(\d+) deletion/.exec(line)?.[1] ?? 0)
    }
  }
  return out
}

const pad = (n: number): string => (n < 10 ? '0' + n : String(n))

/** Local calendar day, `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight of the day holding `ms`, stepped by whole calendar days (DST safe). */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).getTime()
}

export type DayStat = { commits: number; added: number; deleted: number }

export function bucketByDay(commits: readonly Commit[]): Map<string, DayStat> {
  const days = new Map<string, DayStat>()
  for (const c of commits) {
    const key = dayKey(c.ts * 1000)
    const s = days.get(key) ?? { commits: 0, added: 0, deleted: 0 }
    s.commits++
    s.added += c.added
    s.deleted += c.deleted
    days.set(key, s)
  }
  return days
}

export type GridDay = { key: string; commits: number; level: number } | null
/** Columns are weeks (Sunday first), rows weekdays Sun..Sat; days after today are null. */
export type Grid = { weeks: GridDay[][]; max: number; total: number }

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** 0 for none, else 1..4 by share of the busiest day. */
export function levelFor(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)))
}

export function buildGrid(days: Map<string, DayStat>, nowMs: number, weeks: number): Grid {
  const today = startOfDay(nowMs)
  const sunday = addDays(today, -new Date(today).getDay())
  const first = addDays(sunday, -7 * (weeks - 1))
  let max = 0
  let total = 0
  const cells: { key: string; commits: number }[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: { key: string; commits: number }[] = []
    for (let d = 0; d < 7; d++) {
      const at = addDays(first, w * 7 + d)
      if (at > nowMs && dayKey(at) !== dayKey(nowMs)) continue
      const key = dayKey(at)
      const commits = days.get(key)?.commits ?? 0
      max = Math.max(max, commits)
      total += commits
      col[d] = { key, commits }
    }
    cells.push(col)
  }
  return {
    max,
    total,
    weeks: cells.map(col =>
      Array.from({ length: 7 }, (_, d): GridDay => {
        const c = col[d]
        return c === undefined ? null : { ...c, level: levelFor(c.commits, max) }
      }),
    ),
  }
}

/** Month names at the first week column whose Sunday starts a new month, skipping ones too close. */
export function monthLabels(grid: Grid): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = []
  let prev = -1
  let lastCol = -99
  grid.weeks.forEach((week, col) => {
    const day = week.find(d => d !== null)
    if (!day) return
    const month = Number(day.key.slice(5, 7)) - 1
    if (month !== prev) {
      if (prev !== -1 && col - lastCol >= 2) {
        out.push({ col, label: MONTHS[month]! })
        lastCol = col
      } else if (prev === -1) {
        out.push({ col, label: MONTHS[month]! })
        lastCol = col
      }
      prev = month
    }
  })
  return out
}

/** Per-day commit counts for the `days` days ending today, oldest first. */
export function dailySeries(days: Map<string, DayStat>, nowMs: number, count: number): number[] {
  const today = startOfDay(nowMs)
  return Array.from({ length: count }, (_, i) => days.get(dayKey(addDays(today, i - count + 1)))?.commits ?? 0)
}

/** Resample to `points` values: the mean per day of each bucket. */
export function resample(series: readonly number[], points: number): number[] {
  if (points <= 0) return []
  const out: number[] = []
  for (let p = 0; p < points; p++) {
    const lo = Math.floor((p * series.length) / points)
    const hi = Math.max(lo + 1, Math.floor(((p + 1) * series.length) / points))
    let sum = 0
    for (let i = lo; i < hi; i++) sum += series[i] ?? 0
    out.push(sum / (hi - lo))
  }
  return out
}

/** The 1, 2, 2.5, 5 x 10^k at or above `v`; 1 for nothing. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v - 1e-9) return m * p
  return 10 * p
}

export function fmt(v: number): string {
  if (v >= 100) return String(Math.round(v))
  const s = (Math.round(v * 10) / 10).toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

export function weekdayTotals(commits: readonly Commit[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const c of commits) out[new Date(c.ts * 1000).getDay()]!++
  return out
}

export function authorTotals(commits: readonly Commit[], top = 8): { name: string; count: number }[] {
  const by = new Map<string, number>()
  for (const c of commits) by.set(c.author, (by.get(c.author) ?? 0) + 1)
  return [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, top)
}

export function summary(commits: readonly Commit[]): { commits: number; added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const c of commits) { added += c.added; deleted += c.deleted }
  return { commits: commits.length, added, deleted }
}

/** Commits that fall inside the grid's span. */
export function inRange(commits: readonly Commit[], nowMs: number, weeks: number): Commit[] {
  const today = startOfDay(nowMs)
  const first = addDays(addDays(today, -new Date(today).getDay()), -7 * (weeks - 1))
  return commits.filter(c => c.ts * 1000 >= startOfDay(first))
}
