import type { Theme } from '../shared/theme'

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Halfway between two #rrggbb colors.
export const mix = (a: string, b: string): string => {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const hex = (x: number, y: number) => Math.round((x + y) / 2).toString(16).padStart(2, '0')

  return '#' + hex(ar, br) + hex(ag, bg) + hex(ab, bb)
}

// Lane and dot colors, one per palette index (PALETTE_SIZE in git.ts), derived
// from the theme's semantic colors so each theme tints the graph its own way.
export const lanePalette = (t: Theme): readonly string[] => [
  t.info,
  t.success,
  t.accent,
  t.warning,
  mix(t.info, t.success),
  t.danger,
  mix(t.warning, t.danger),
  mix(t.accent, t.info),
]

// Status letter colors of a change row.
export const glyphColor = (t: Theme, glyph: string): string =>
  glyph === 'A' || glyph === '?' ? t.success : glyph === 'M' ? t.warning : glyph === 'D' ? t.danger : t.info
