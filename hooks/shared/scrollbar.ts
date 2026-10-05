export const THUMB = '┃'
export const TRACK = '│'

// A one-column scrollbar of `height` rows over `total` rows of which `visible`
// show from `offset`: the thumb is proportional (at least 1 row), its place
// follows offset / (total - visible). All blank when everything fits.
export const scrollbar = (
  total: number,
  visible: number,
  offset: number,
  height: number,
): string[] => {
  const rows = Math.max(0, Math.floor(height))
  if (total <= visible || visible <= 0 || rows === 0) {
    return Array.from({ length: rows }, () => ' ')
  }
  const thumb = Math.min(rows, Math.max(1, Math.round((rows * visible) / total)))
  const span = total - visible
  const ratio = Math.min(1, Math.max(0, offset / span))
  const top = Math.round((rows - thumb) * ratio)

  return Array.from({ length: rows }, (_, i) =>
    i >= top && i < top + thumb ? THUMB : TRACK,
  )
}
