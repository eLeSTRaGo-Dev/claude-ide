import { expect, test } from 'claude-code/testing'

import { svgFor } from './svg'

test('svg animates only while playing', () => {
  for (const kind of ['plasma', 'fire'] as const) {
    expect(svgFor(kind, true)).toContain('<animate ')
    expect(svgFor(kind, false)).not.toContain('<animate ')
    expect(svgFor(kind, true).startsWith('<svg')).toBe(true)
    expect(svgFor(kind, true).length).toBeLessThan(131072)
  }
})
