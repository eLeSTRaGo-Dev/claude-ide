import { deleteTarget } from './tree'
import type { Row } from './tree'

// `marked` with `path` added, or removed when already there.
export const toggleMark = (marked: readonly string[], path: string): string[] =>
  marked.includes(path) ? marked.filter(p => p !== path) : [...marked, path]

// The paths of `rows` from `anchor` to `path`, both included, in row order.
// An anchor not among the rows marks `path` alone.
export const rangeOf = (
  rows: readonly Row[],
  anchor: string | undefined,
  path: string,
): string[] => {
  const from = anchor === undefined ? -1 : rows.findIndex(row => row.path === anchor)
  const to = rows.findIndex(row => row.path === path)
  if (from < 0 || to < 0) return [path]
  const [start, end] = from <= to ? [from, to] : [to, from]

  return rows.slice(start, end + 1).map(row => row.path)
}

// The paths a multi-delete hands to `rm -rf`, in input order: duplicates and
// paths under another listed dir dropped, each checked by `deleteTarget`
// (the first refusal is returned).
export const deleteTargets = (
  paths: readonly string[],
  root: string,
): { paths: string[] } | { error: string } => {
  const unique = [...new Set(paths)]
  const kept = unique.filter(p => !unique.some(other => p.startsWith(other + '/')))
  for (const p of kept) {
    const target = deleteTarget(p, root)
    if ('error' in target) return target
  }

  return { paths: kept }
}

// `marked` without the paths that are gone (deleted, or no longer listed).
export const pruneMarks = (
  marked: readonly string[],
  isGone: (path: string) => boolean,
): string[] => marked.filter(p => !isGone(p))
