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

// The fraction a splitter drag lands on: the section's size at the grab plus
// the pointer's travel, clamped as `splitAt` draws it.
export const dragTo = (total: number, start: number, delta: number, min: number): number =>
  fractionOf(splitAt(total, fractionOf(Math.round(start + delta), total), min), total)

// A panel's split fractions as kept in `$.store` (`layout:<panel>`): each of
// `keys` that holds a finite number strictly between 0 and 1, the rest dropped;
// undefined when the value is not an object or none of them is valid.
export const layoutOf = (value: unknown, keys: readonly string[]): Record<string, number> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const layout: Record<string, number> = {}
  for (const key of keys) {
    const fraction = (value as Record<string, unknown>)[key]
    if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction < 1)
      layout[key] = fraction
  }

  return Object.keys(layout).length === 0 ? undefined : layout
}
