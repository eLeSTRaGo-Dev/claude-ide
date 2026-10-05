// Cells for the first part of `total` at `fraction`, clamped so each side keeps
// `min` (when `total` cannot hold two `min`s, the halves). The epsilon keeps a
// fraction made by `fractionOf` from rounding one cell short.
export const splitAt = (total: number, fraction: number, min: number): number => {
  const hi = total - min
  if (hi < min) return Math.max(0, Math.floor(total / 2))
  const cells = Math.floor(total * fraction + 1e-9)

  return Math.min(hi, Math.max(min, cells))
}

export const fractionOf = (cells: number, total: number): number =>
  total <= 0 ? 0 : cells / total
