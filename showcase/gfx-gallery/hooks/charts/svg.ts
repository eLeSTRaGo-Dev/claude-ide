// SVG strings for desktop / vscode / mobile (pure). Interactive: <title> tooltips, CSS :hover.
import { WEEKDAYS, fmt, monthLabels, niceMax } from './data'
import type { Grid } from './data'

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const STYLE = `<style>
:root{--fg:#57606a;--l0:#ebedf0;--l1:#9be9a8;--l2:#40c463;--l3:#30a14e;--l4:#216e39;--line:#1a7f37;--bar:#0969da;--hi:#1f2328}
@media (prefers-color-scheme: dark){:root{--fg:#8b949e;--l0:#2d333b;--l1:#0e4429;--l2:#006d32;--l3:#26a641;--l4:#39d353;--line:#39d353;--bar:#58a6ff;--hi:#f0f6fc}}
text{fill:var(--fg);font:10px sans-serif}
.d0{fill:var(--l0)}.d1{fill:var(--l1)}.d2{fill:var(--l2)}.d3{fill:var(--l3)}.d4{fill:var(--l4)}
.day:hover,.bar:hover{stroke:var(--hi);stroke-width:1.5}
.pt{fill:var(--line);opacity:0;stroke:none}.pt:hover{opacity:1}
.ln{fill:none;stroke:var(--line);stroke-width:1.5;stroke-linejoin:round}
.bar{fill:var(--bar)}
</style>`

const open = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${STYLE}`

const plural = (n: number): string => (n === 1 ? '1 commit' : `${n} commits`)

const CELL = 11
const STEP = 13

/** GitHub-style grid: week columns, weekday rows, `N commits on YYYY-MM-DD` tooltips. */
export function heatSvg(grid: Grid): string {
  const left = 28
  const top = 16
  const w = left + grid.weeks.length * STEP + 4
  const h = top + 7 * STEP + 2
  let s = open(w, h)
  for (const m of monthLabels(grid)) s += `<text x="${left + m.col * STEP}" y="10">${esc(m.label)}</text>`
  for (const d of [1, 3, 5]) s += `<text x="0" y="${top + d * STEP + 9}">${WEEKDAYS[d]}</text>`
  grid.weeks.forEach((week, wk) =>
    week.forEach((day, d) => {
      if (!day) return
      s += `<rect class="day d${day.level}" x="${left + wk * STEP}" y="${top + d * STEP}" width="${CELL}" height="${CELL}" rx="2"><title>${esc(`${plural(day.commits)} on ${day.key}`)}</title></rect>`
    }),
  )
  return s + '</svg>'
}

/** Line of `values` (mean commits per day per point) with hover dots; `labels[i]` titles point i. */
export function lineSvg(values: readonly number[], labels: readonly string[], width: number, height = 120): string {
  const left = 30
  const bottom = 16
  const plotW = Math.max(10, width - left - 6)
  const plotH = height - bottom - 6
  const top = niceMax(Math.max(0, ...values))
  const px = (i: number): number => left + (values.length < 2 ? 0 : (i / (values.length - 1)) * plotW)
  const py = (v: number): number => 6 + plotH - (Math.min(v, top) / top) * plotH
  let s = open(width, height)
  for (const f of [0, 0.5, 1]) {
    const y = py(top * f)
    s += `<line x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}" stroke="var(--fg)" stroke-opacity="0.2"/>`
    s += `<text x="${left - 4}" y="${y + 3}" text-anchor="end">${fmt(top * f)}</text>`
  }
  if (values.length > 0) {
    s += `<path class="ln" d="${values.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join('')}"/>`
  }
  values.forEach((v, i) => {
    s += `<circle class="pt" cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="4"><title>${esc(`${labels[i] ?? ''}: ${fmt(v)} commits/day`)}</title></circle>`
  })
  if (labels.length > 0) {
    s += `<text x="${left}" y="${height - 3}">${esc(labels[0]!)}</text>`
    s += `<text x="${left + plotW}" y="${height - 3}" text-anchor="end">${esc(labels[labels.length - 1]!)}</text>`
  }
  return s + '</svg>'
}

export function barsSvg(names: readonly string[], values: readonly number[], width: number, height = 110): string {
  const left = 30
  const plotW = Math.max(10, width - left - 6)
  const plotH = height - 30
  const top = niceMax(Math.max(0, ...values))
  const slot = plotW / Math.max(1, values.length)
  let s = open(width, height)
  for (const f of [0, 0.5, 1]) {
    const y = 6 + plotH - f * plotH
    s += `<text x="${left - 4}" y="${y + 3}" text-anchor="end">${fmt(top * f)}</text>`
  }
  values.forEach((v, i) => {
    const bh = (Math.min(v, top) / top) * plotH
    const x = left + i * slot + slot * 0.15
    s += `<rect class="bar" x="${x.toFixed(1)}" y="${(6 + plotH - bh).toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="2"><title>${esc(`${names[i] ?? ''}: ${plural(v)}`)}</title></rect>`
    s += `<text x="${(x + slot * 0.35).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(names[i] ?? '')}</text>`
  })
  return s + '</svg>'
}
