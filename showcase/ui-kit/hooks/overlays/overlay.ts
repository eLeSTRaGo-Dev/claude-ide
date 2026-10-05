// Pure layout math for the Overlays pane and the shared Modal/DropdownMenu.

/** Offset that centers `size` cells in `total` (never negative). */
export function centerOffset(total: number, size: number): number {
  return Math.max(0, Math.floor((total - size) / 2))
}

/** Greedy word wrap to `width` columns; a word longer than `width` is cut. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  let cur = ''
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let word = raw
    while (word.length > w) {
      if (cur !== '') {
        lines.push(cur)
        cur = ''
      }
      lines.push(word.slice(0, w))
      word = word.slice(w)
    }
    if (cur === '') cur = word
    else if (cur.length + 1 + word.length <= w) cur += ' ' + word
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur !== '') lines.push(cur)

  return lines.length > 0 ? lines : ['']
}

/** Card rows: border 2 + padding 2 + title + gap + body + gap + buttons. */
export const cardHeight = (bodyLines: number): number => 2 + 2 + 1 + 1 + bodyLines + 1 + 1

/** Card width for a pane `cols` wide: at most `max`, with a 3-cell margin a side. */
export const cardWidth = (cols: number, max = 48): number => Math.max(20, Math.min(max, cols - 6))

/** Where a centered card and its 1-cell drop shadow sit in a `cols` x `rows` area. */
export function modalBox(cols: number, rows: number, cardW: number, cardH: number) {
  const left = centerOffset(cols, cardW + 1)
  const top = centerOffset(rows, cardH + 1)

  return { top, left, shadowTop: top + 1, shadowLeft: left + 1 }
}

/** '#rrggbb' scaled toward black by `amount` (0..1); other strings come back unchanged. */
export function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null) return hex
  const n = parseInt(m[1] as string, 16)
  const k = 1 - Math.min(1, Math.max(0, amount))
  const c = (v: number) => Math.round(v * k).toString(16).padStart(2, '0')

  return '#' + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255)
}

/** Menu box size: widest row (icon, label, gap, shortcut) plus border and padding. */
export function menuSize(items: readonly { label: string; icon?: string; kbd?: string; separator?: boolean }[]) {
  const row = (i: { label: string; icon?: string; kbd?: string }) => 2 + i.label.length + (i.kbd !== undefined ? 2 + i.kbd.length + 2 : 0)
  const real = items.filter(i => i.separator !== true)

  return { width: Math.max(12, ...real.map(row)) + 4, height: items.length + 2 }
}
