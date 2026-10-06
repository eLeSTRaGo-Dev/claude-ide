import { expect, test } from 'claude-code/testing'
import { MAX_CHARS, MAX_LINES, parse, truncate } from './parse'

test('parse combines blocks, refs and footnotes', () => {
  const r = parse('# T\r\n\r\nSee [x] and note[^1].\r\n\r\n[x]: https://x.y\r\n[^1]: Foot.\r\n')
  expect(r.truncated).toBe(false)
  expect(r.lineCount).toBe(6)
  expect(r.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph'])
  expect(r.refs.get('X')).toEqual({ href: 'https://x.y', title: '' })
  expect(r.footnotes).toHaveLength(1)
  const p = r.blocks[1]!
  expect(p.type === 'paragraph' ? p.inlines.map((i) => i.type) : []).toEqual(['text', 'link', 'text', 'footnoteRef', 'text'])
})

test('empty input', () => {
  expect(parse('')).toEqual({ blocks: [], refs: new Map(), footnotes: [], truncated: false, lineCount: 0 })
})

test('M5 truncates past 20 000 lines', () => {
  const src = Array.from({ length: MAX_LINES + 50 }, (_, i) => `line ${i}`).join('\n')
  const r = parse(src)
  expect(r.truncated).toBe(true)
  expect(r.lineCount).toBe(MAX_LINES)
  const exact = Array.from({ length: MAX_LINES }, () => 'x').join('\n') + '\n'
  expect(truncate(exact).truncated).toBe(false)
})

test('M5 truncates past 1 MiB at a line end', () => {
  const line = 'word '.repeat(200) + '\n' // 1001 chars
  const src = line.repeat(Math.ceil((MAX_CHARS * 1.5) / line.length))
  const cut = truncate(src)
  expect(cut.truncated).toBe(true)
  expect(cut.text.length).toBeLessThanOrEqual(MAX_CHARS)
  expect(cut.text.endsWith('word ')).toBe(true)
})

test('performance: a ~1 MiB mixed document parses well under a second', () => {
  const chunk = [
    '# Heading with *emphasis* and `code`',
    '',
    'A paragraph with **strong**, _emph_, ~~strike~~, a [link](https://example.com "t"), an',
    'autolink <https://x.y>, a bare www.example.com, an entity &copy; and a ref [r].',
    '',
    '> [!NOTE]',
    '> Quote with a lazy',
    'continuation line.',
    '',
    '- item one',
    '  - nested [ ] two',
    '- [x] task',
    '',
    '1. first',
    '2. second',
    '',
    '| a | b |',
    '|:--|--:|',
    '| 1 | 2 |',
    '',
    '```ts',
    'const x = 1',
    '```',
    '',
    '[r]: https://r.example',
    '',
  ].join('\n')
  const src = (chunk + '\n').repeat(Math.floor(1000000 / chunk.length))
  const t0 = Date.now()
  const r = parse(src)
  const ms = Date.now() - t0
  expect(r.blocks.length).toBeGreaterThan(1000)
  expect(ms).toBeLessThan(1000)
})

test('performance: one huge paragraph and one huge line', () => {
  const t0 = Date.now()
  parse('*a* _b_ [c] `d` '.repeat(60000))
  parse(('x'.repeat(80) + '\n').repeat(12000))
  parse('- '.repeat(100) + 'deep\n')
  parse('> '.repeat(500) + 'deep\n')
  expect(Date.now() - t0).toBeLessThan(1500)
})
