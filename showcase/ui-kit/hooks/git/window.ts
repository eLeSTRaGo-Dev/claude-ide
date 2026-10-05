export type Window<T> = { offset: number; rows: T[] }

// The slice of `height` rows that keeps `selectedIndex` visible with `margin`
// rows of context beyond it. Starts from `offset` so scrolling is minimal.
export const window = <T>(
  rows: readonly T[],
  selectedIndex: number,
  height: number,
  offset = 0,
  margin = 1,
): Window<T> => {
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
