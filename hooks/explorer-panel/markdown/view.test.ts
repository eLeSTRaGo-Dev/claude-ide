import { expect, test } from 'claude-code/testing'
import { layout, plainRow } from './layout'
import { parse } from './parse'
import { anchorRow, expandPictures, isLinkable, linkHits, linkTarget, localPath, normalizePath } from './view'

test('table rows carry table: true, other rows do not', () => {
  const L = layout(parse('text\n\n| a | b |\n|---|---|\n| [x](https://t) | 2 |\n\nafter'), 40)
  const flags = L.rows.map(r => (r.kind === 'text' ? r.table === true : false))
  expect(flags).toEqual([false, false, true, true, true, true, true, false, false])
  // inside a quote the flag survives the prefix
  const Q = layout(parse('> | a |\n> |---|\n> | b |'), 40)
  expect(Q.rows.every(r => r.kind === 'text' && r.table === true)).toBe(true)
  // too narrow for the grid: the joined fallback is flagged too
  const N = layout(parse('| a | b | c | d | e |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |'), 8)
  expect(N.rows.every(r => r.kind === 'text' && r.table === true)).toBe(true)
})

test('normalizePath and localPath stay inside the root', () => {
  expect(normalizePath('/a/./b/../c')).toBe('/a/c')
  expect(normalizePath('/a/../..')).toBeUndefined()
  expect(localPath('docs/x.md', '/r/README.md', '/r')).toBe('/r/docs/x.md')
  expect(localPath('../y.md#top', '/r/docs/x.md', '/r')).toBe('/r/y.md')
  expect(localPath('/z.png', '/r/docs/x.md', '/r')).toBe('/r/z.png')
  expect(localPath('a%20b.md', '/r/x.md', '/r')).toBe('/r/a b.md')
  expect(localPath('../../etc/passwd', '/r/x.md', '/r')).toBeUndefined()
  expect(localPath('https://x', '/r/x.md', '/r')).toBeUndefined()
  expect(localPath('data:image/png;base64,AA', '/r/x.md', '/r')).toBeUndefined()
  expect(localPath('//host/x', '/r/x.md', '/r')).toBeUndefined()
})

test('linkTarget: anchor, file (with slug), url, outside', () => {
  expect(linkTarget('#Some%20Head', '/r/a.md', '/r')).toEqual({ kind: 'anchor', slug: 'Some Head' })
  expect(linkTarget('b.md', '/r/a.md', '/r')).toEqual({ kind: 'file', path: '/r/b.md' })
  expect(linkTarget('b.md#x', '/r/a.md', '/r')).toEqual({ kind: 'file', path: '/r/b.md', slug: 'x' })
  expect(linkTarget('mailto:a@b', '/r/a.md', '/r')).toEqual({ kind: 'url', url: 'mailto:a@b' })
  expect(linkTarget('../out.md', '/r/a.md', '/r')).toEqual({ kind: 'outside', written: '../out.md' })
})

test('anchorRow: as written, lowercased, or slugged', () => {
  const anchors = new Map([['some-head', 4]])
  expect(anchorRow(anchors, 'some-head')).toBe(4)
  expect(anchorRow(anchors, 'Some-Head')).toBe(4)
  expect(anchorRow(anchors, 'Some Head')).toBe(4)
  expect(anchorRow(anchors, 'nope')).toBeUndefined()
})

test('isLinkable: http(s) on the terminal, https elsewhere, never in tables', () => {
  expect(isLinkable('http://x', 'terminal', false)).toBe(true)
  expect(isLinkable('https://x', 'terminal', true)).toBe(false)
  expect(isLinkable('mailto:a@b', 'terminal', false)).toBe(false)
  expect(isLinkable('http://x', 'desktop', false)).toBe(false)
  expect(isLinkable('https://x', 'vscode', false)).toBe(true)
  expect(isLinkable('https://é', 'terminal', false)).toBe(false)
})

test('linkHits: runs positioned by columns, one href merged', () => {
  const L = layout(parse('ab [**c**d](x.md) 日 [e](#y)'), 40)
  const hits = linkHits(L.rows, () => true)
  expect(hits.map(h => [h.y, h.x, h.width, h.href, h.spans.map(s => s.text).join('')])).toEqual([
    [0, 3, 2, 'x.md', 'cd'],
    [0, 9, 1, '#y', 'e'],
  ])
  expect(linkHits(L.rows, href => href !== 'x.md').map(h => h.href)).toEqual(['#y'])
})

test('expandPictures: an image row becomes its picture rows, anchors move', () => {
  const L = layout(parse('![a](p.png)\n\n# H'), 20)
  const pic = { png: '/p.png', mtime: 1, columns: 10, rows: 3 }
  const V = expandPictures(L, new Map([[0, pic]]))
  expect(V.rows.map(r => r.kind)).toEqual(['picture', 'picture', 'picture', 'text', 'text', 'text'])
  expect(V.rows.map(r => (r.kind === 'picture' ? r.part : -1)).slice(0, 3)).toEqual([0, 1, 2])
  expect(V.anchors.get('h')).toBe(L.anchors.get('h')! + 2)
  expect(plainRow(L.rows[0]!)).toBe('🖼 a')
  // no pictures: the layout as it is
  expect(expandPictures(L, new Map()).rows).toBe(L.rows)
})
