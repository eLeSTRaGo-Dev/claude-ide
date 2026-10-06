import { expect, test } from 'claude-code/testing'
import type { Block, Inline } from './ast'
import { normalize, parseBlocks, splitRow } from './blocks'

function ins(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return n.text
        case 'emph':
          return `*${ins(n.children)}*`
        case 'strong':
          return `**${ins(n.children)}**`
        case 'strike':
          return `~~${ins(n.children)}~~`
        case 'code':
          return `\`${n.text}\``
        case 'link':
          return `[${ins(n.children)}](${n.href})`
        case 'image':
          return `![${n.alt}](${n.src})`
        case 'hardBreak':
          return '⏎'
        case 'softBreak':
          return '↵'
        case 'footnoteRef':
          return `[${n.n}]`
        case 'html':
          return ''
        default:
          return `<${n.type}>${ins(n.children)}</${n.type}>`
      }
    })
    .join('')
}

/** One line per block, children indented two spaces. */
function tree(blocks: Block[], d = 0): string[] {
  const pad = '  '.repeat(d)
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`${pad}h${b.level}${b.setext ? ' setext' : ''}: ${ins(b.inlines)}`)
        break
      case 'paragraph':
        out.push(`${pad}p: ${ins(b.inlines)}`)
        break
      case 'thematicBreak':
        out.push(`${pad}hr`)
        break
      case 'quote':
        out.push(`${pad}quote${b.alert ? ' ' + b.alert : ''}`)
        out.push(...tree(b.children, d + 1))
        break
      case 'list':
        out.push(`${pad}${b.ordered ? `ol ${b.start}${b.marker}` : `ul ${b.marker}`} ${b.tight ? 'tight' : 'loose'}`)
        for (const it of b.items) {
          out.push(`${pad}  item${it.task ? ' ' + it.task : ''}`)
          out.push(...tree(it.children, d + 2))
        }
        break
      case 'code':
        out.push(`${pad}code${b.fenced ? ' fenced' : ''}${b.lang ? ' ' + b.lang : ''}${b.closed ? '' : ' unclosed'}: ${JSON.stringify(b.text)}`)
        break
      case 'table':
        out.push(`${pad}table ${b.align.map((a) => a ?? '-').join(',')}`)
        out.push(`${pad}  | ${b.header.map(ins).join(' | ')} |`)
        for (const r of b.rows) out.push(`${pad}  | ${r.map(ins).join(' | ')} |`)
        break
      case 'html':
        out.push(`${pad}html${b.comment ? ' comment' : ''}: ${b.comment ? '' : ins(b.inlines)}`)
        break
      case 'frontMatter':
        out.push(`${pad}frontMatter ${b.format}: ${JSON.stringify(b.text)}`)
        break
      case 'details':
        out.push(`${pad}details: ${ins(b.summary)}`)
        out.push(...tree(b.children, d + 1))
        break
    }
  }
  return out
}

const t = (src: string) => tree(parseBlocks(src).blocks)
const lines = (src: string) => parseBlocks(src).blocks.map((b) => [b.type, b.startLine, b.endLine])

test('M2 M4 normalization: BOM, CRLF, CR, tabs to 4-column stops', () => {
  expect(normalize('﻿a\r\nb\rc')).toBe('a\nb\nc')
  expect(normalize('\tx\nab\ty')).toBe('    x\nab  y')
  expect(t('\tcode')).toEqual(['code: "code"'])
  expect(t('-\tfoo')).toEqual(['ul - tight', '  item', '    p: foo'])
})

test('B1 ATX headings', () => {
  expect(t('# a\n## b ##\n###### c\n####### d\n#nospace\n# x #b\n#\n### #')).toEqual([
    'h1: a',
    'h2: b',
    'h6: c',
    'p: ####### d↵#nospace',
    'h1: x #b',
    'h1: ',
    'h3: ',
  ])
  expect(t('    # code')).toEqual(['code: "# code"'])
  expect(t('# *em* `c`')).toEqual(['h1: *em* `c`'])
})

test('B2 setext headings vs thematic break', () => {
  expect(t('Title\n===\n\nSub\n---')).toEqual(['h1 setext: Title', 'h2 setext: Sub'])
  expect(t('a\nb\n===')).toEqual(['h1 setext: a↵b'])
  expect(t('---\n\na\n\n---')).toEqual(['hr', 'p: a', 'hr'])
  expect(t('- a\n---')).toEqual(['ul - tight', '  item', '    p: a', 'hr'])
  expect(t('> a\n---')).toEqual(['quote', '  p: a', 'hr'])
  expect(lines('x\ny\n--')).toEqual([['heading', 1, 3]])
})

test('B3 paragraphs and lazy whitespace', () => {
  expect(t('a\n  b\n\n\nc')).toEqual(['p: a↵b', 'p: c'])
  expect(t('  a  ')).toEqual(['p: a'])
})

test('B4 hard line breaks', () => {
  expect(t('a  \nb\\\nc  ')).toEqual(['p: a⏎b⏎c'])
  expect(t('a\\')).toEqual(['p: a\\'])
})

test('B5 blank lines collapse', () => {
  expect(t('\n\n\na\n\n\n\nb\n\n')).toEqual(['p: a', 'p: b'])
  expect(lines('\n\na\n\n\nb')).toEqual([
    ['paragraph', 3, 3],
    ['paragraph', 6, 6],
  ])
})

test('B6 thematic breaks', () => {
  expect(t('***\n- - -\n___\n _ _ _ \n**\n--- a')).toEqual(['hr', 'hr', 'hr', 'hr', 'p: **↵--- a'])
  expect(t('* * *\n')).toEqual(['hr'])
})

test('B7 block quotes: nesting and lazy continuation', () => {
  expect(t('> a\nb\n> c')).toEqual(['quote', '  p: a↵b↵c'])
  expect(t('> a\n>> b\n> c')).toEqual(['quote', '  p: a', '  quote', '    p: b↵c'])
  expect(t('> a\n\n> b')).toEqual(['quote', '  p: a', 'quote', '  p: b'])
  expect(t('> ```\nx')).toEqual(['quote', '  code fenced unclosed: ""', 'p: x'])
  expect(t('> - a\nb')).toEqual(['quote', '  ul - tight', '    item', '      p: a↵b'])
  expect(t('>a\n>\n>b')).toEqual(['quote', '  p: a', '  p: b'])
  expect(lines('> a\n>\n> b')).toEqual([['quote', 1, 3]])
})

test('B8 GitHub alerts; not in a nested quote', () => {
  expect(t('> [!NOTE]\n> Hi *there*')).toEqual(['quote note', '  p: Hi *there*'])
  expect(t('> [!tip]\n> a')).toEqual(['quote tip', '  p: a'])
  for (const k of ['IMPORTANT', 'WARNING', 'CAUTION'])
    expect(t(`> [!${k}]\n> x`)).toEqual([`quote ${k.toLowerCase()}`, '  p: x'])
  expect(t('> > [!NOTE]\n> > a')).toEqual(['quote', '  quote', '    p: [!NOTE]↵a'])
  expect(t('> [!NOPE]\n> a')).toEqual(['quote', '  p: [!NOPE]↵a'])
  expect(t('- > [!NOTE]\n  > a')).toEqual(['ul - tight', '  item', '    quote', '      p: [!NOTE]↵a'])
  expect(t('> [!WARNING]\n>\n> para one\n>\n> para two')).toEqual(['quote warning', '  p: para one', '  p: para two'])
})

test('B9 bullet lists: markers, tight vs loose, nesting with 2 and 4 spaces', () => {
  expect(t('- a\n- b\n* c')).toEqual(['ul - tight', '  item', '    p: a', '  item', '    p: b', 'ul * tight', '  item', '    p: c'])
  expect(t('- a\n\n- b')).toEqual(['ul - loose', '  item', '    p: a', '  item', '    p: b'])
  expect(t('- a\n  - b\n    - c')).toEqual([
    'ul - tight',
    '  item',
    '    p: a',
    '    ul - tight',
    '      item',
    '        p: b',
    '        ul - tight',
    '          item',
    '            p: c',
  ])
  expect(t('-   a\n    - b')).toEqual(['ul - tight', '  item', '    p: a', '    ul - tight', '      item', '        p: b'])
  // CommonMark: each marker sits left of the previous item's content column, so all are siblings
  expect(t('- a\n - b\n  - c\n   - d')).toEqual([
    'ul - tight',
    '  item',
    '    p: a',
    '  item',
    '    p: b',
    '  item',
    '    p: c',
    '  item',
    '    p: d',
  ])
  // a blank line between sub-items makes the inner list loose, the outer tight
  expect(t('- a\n  - b\n\n  - c\n- d')).toEqual([
    'ul - tight',
    '  item',
    '    p: a',
    '    ul - loose',
    '      item',
    '        p: b',
    '      item',
    '        p: c',
    '  item',
    '    p: d',
  ])
  expect(t('a\n- b')).toEqual(['p: a', 'ul - tight', '  item', '    p: b'])
  expect(t('a\n-')).toEqual(['h2 setext: a'])
  expect(t('-\n  foo')).toEqual(['ul - tight', '  item', '    p: foo'])
  expect(t('-\n\n  foo')).toEqual(['ul - tight', '  item', 'p: foo'])
})

test('B10 ordered lists', () => {
  expect(t('3. a\n4. b')).toEqual(['ol 3. tight', '  item', '    p: a', '  item', '    p: b'])
  expect(t('1) a\n2. b')).toEqual(['ol 1) tight', '  item', '    p: a', 'ol 2. tight', '  item', '    p: b'])
  expect(t('a\n2. b')).toEqual(['p: a↵2. b'])
  expect(t('a\n1. b')).toEqual(['p: a', 'ol 1. tight', '  item', '    p: b'])
  expect(t('1234567890. x')).toEqual(['p: 1234567890. x'])
})

test('B11 task list items', () => {
  expect(t('- [ ] todo\n- [x] done\n- [X] Done\n- [y] no\n- [ ]x')).toEqual([
    'ul - tight',
    '  item unchecked',
    '    p: todo',
    '  item checked',
    '    p: done',
    '  item checked',
    '    p: Done',
    '  item',
    '    p: [y] no',
    '  item',
    '    p: [ ]x',
  ])
})

test('B12 multi-block list items', () => {
  expect(t('1. para\n\n   second\n\n       code\n\n   > q\n   - sub')).toEqual([
    'ol 1. loose',
    '  item',
    '    p: para',
    '    p: second',
    '    code: "code"',
    '    quote',
    '      p: q',
    '    ul - tight',
    '      item',
    '        p: sub',
  ])
  expect(t('- a\n\n  b\n- c')).toEqual(['ul - loose', '  item', '    p: a', '    p: b', '  item', '    p: c'])
  expect(t('- ```\n  x\n\n  y\n  ```\n- z')).toEqual(['ul - tight', '  item', '    code fenced: "x\\n\\ny"', '  item', '    p: z'])
})

test('B13 fenced code: info, fence length, unclosed', () => {
  expect(t('```js extra\nlet a\n```')).toEqual(['code fenced js: "let a"'])
  expect(t('~~~\na\n```\n~~~')).toEqual(['code fenced: "a\\n```"'])
  expect(t('````\na\n```\nb\n`````')).toEqual(['code fenced: "a\\n```\\nb"'])
  expect(t('```\nunclosed\n\nstill')).toEqual(['code fenced unclosed: "unclosed\\n\\nstill"'])
  expect(t('``` a`b\n```')).toEqual(['p: ``` a`b', 'code fenced unclosed: ""'])
  expect(t('  ```\n  a\n b\nc\n  ```')).toEqual(['code fenced: "a\\nb\\nc"'])
  expect(t('```\n```')).toEqual(['code fenced: ""'])
  expect(t('para\n```\nx\n```')).toEqual(['p: para', 'code fenced: "x"'])
  expect(lines('```\nx\n```\nafter')).toEqual([
    ['code', 1, 3],
    ['paragraph', 4, 4],
  ])
})

test('B14 indented code', () => {
  expect(t('    a\n\n      b\n\n\nc')).toEqual(['code: "a\\n\\n  b"', 'p: c'])
  expect(t('p\n    not code')).toEqual(['p: p↵not code'])
  expect(lines('    a\n    b\n\n')).toEqual([['code', 1, 2]])
})

test('B15 tables: alignment, escaped pipes, short and long rows, inline markup', () => {
  expect(t('| a | b | c |\n|:--|:-:|--:|\n| 1 | *2* | `3\\|4` |\n| x |\n| p | q | r | s |')).toEqual([
    'table left,center,right',
    '  | a | b | c |',
    '  | 1 | *2* | `3|4` |',
    '  | x |  |  |',
    '  | p | q | r |',
  ])
  expect(t('a | b\n--|--\n1 | 2\n\nafter')).toEqual(['table -,-', '  | a | b |', '  | 1 | 2 |', 'p: after'])
  expect(t('intro\n| a |\n| --- |\n| b |')).toEqual(['p: intro', 'table -', '  | a |', '  | b |'])
  expect(t('| a | b |\n| --- |')).toEqual(['p: | a | b |↵| --- |'])
  expect(t('| a |\n| - |\n| b |\n> q')).toEqual(['table -', '  | a |', '  | b |', 'quote', '  p: q'])
  expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  expect(lines('x\n\n| a |\n|---|\n| 1 |\n| 2 |')).toEqual([
    ['paragraph', 1, 1],
    ['table', 3, 6],
  ])
})

test('B16 link reference definitions', () => {
  const r = parseBlocks('[Foo]: /url "Title"\n[bar]:\n  <a b>\n\n[foo] and [BAR][] and [x][foo]')
  expect(tree(r.blocks)).toEqual(['p: [foo](/url) and [BAR](a b) and [x](/url)'])
  expect(r.refs.get('FOO')).toEqual({ href: '/url', title: 'Title' })
  expect(t('[a]: /u\n[a]: /v\n\n[a]')).toEqual(['p: [a](/u)'])
  expect(t('[a]: /u "t" junk\n\n[a]')).toEqual(['p: [a]: /u "t" junk', 'p: [a]'])
  expect(t('[a]: /u\n"t"\n\n[a]')).toEqual(['p: [a](/u)'])
  expect(t('[a]: /u\nnext line')).toEqual(['p: next line'])
  expect(t('[a]: /u\n===')).toEqual(['p: ==='])
  expect(t('> [q]: /q\n\n[q]')).toEqual(['quote', 'p: [q](/q)'])
})

test('B17 front matter', () => {
  expect(t('---\ntitle: x\ntags: [a]\n---\n# H')).toEqual(['frontMatter yaml: "title: x\\ntags: [a]"', 'h1: H'])
  expect(t('+++\na = 1\n+++\nbody')).toEqual(['frontMatter toml: "a = 1"', 'p: body'])
  expect(t('---\nno close')).toEqual(['hr', 'p: no close'])
  expect(lines('---\na: 1\n---\n\ntext')).toEqual([
    ['frontMatter', 1, 3],
    ['paragraph', 5, 5],
  ])
  expect(t('text\n---\na\n---')).toEqual(['h2 setext: text', 'h2 setext: a'])
})

test('B18 HTML comments', () => {
  expect(t('<!-- one\ntwo -->\npara')).toEqual(['html comment: ', 'p: para'])
  expect(lines('<!-- a\n\nb -->\nx')).toEqual([
    ['html', 1, 3],
    ['paragraph', 4, 4],
  ])
  expect(t('a <!-- hidden --> b')).toEqual(['p: a  b'])
})

test('B19 details / summary', () => {
  const src = '<details>\n<summary>More *info*</summary>\n\nBody **bold**\n\n- item\n\n</details>\n\nafter'
  expect(t(src)).toEqual(['details: More *info*', '  p: Body **bold**', '  ul - tight', '    item', '      p: item', 'p: after'])
  expect(lines(src)).toEqual([
    ['details', 1, 8],
    ['paragraph', 10, 10],
  ])
  expect(t('<details><summary>S</summary>inline body</details>')).toEqual(['details: S', '  p: inline body'])
  expect(t('<details>\n<summary>A</summary>\n\n<details>\n<summary>B</summary>\n\nx\n\n</details>\n\ny\n\n</details>')).toEqual([
    'details: A',
    '  details: B',
    '    p: x',
    '  p: y',
  ])
  expect(t('<details>\n<summary>open</summary>\n\nno close')).toEqual(['details: open', '  p: no close'])
})

test('B20 other HTML blocks', () => {
  expect(t('<div align="center">\n<b>Hi</b> there<br>next\n</div>')).toEqual(['html: **Hi** there⏎next'])
  expect(t('<hr>')).toEqual(['hr'])
  expect(t('<p align="center"><img src="logo.png" alt="Logo"></p>')).toEqual(['html: ![Logo](logo.png)'])
  expect(t('<pre>\nline <b>1</b>\nline 2\n</pre>')).toEqual(['code: "line 1\\nline 2"'])
  expect(t('<script>\nalert(1)\n</script>\nafter')).toEqual(['html comment: ', 'p: after'])
  expect(t('para\n<span>x</span>')).toEqual(['p: para↵x'])
  expect(t('<div>\n*md*\n\n*md2*')).toEqual(['html: *md*', 'p: *md2*'])
})

test('B20 HTML block tags break lines, cells get a separator', () => {
  expect(t('<table><tr><td>cell</td><td>cell</td></tr></table>')).toEqual(['html: cell │ cell'])
  expect(t('<table>\n  <tr><th>HTML</th><th>table</th></tr>\n  <tr><td>a</td><td>b</td></tr>\n</table>')).toEqual([
    'html: HTML │ table⏎a │ b',
  ])
  expect(t('<div>a</div><div>b</div>')).toEqual(['html: a⏎b'])
  expect(t('<div>a</div>\n<div>b<br></div>')).toEqual(['html: a⏎b⏎'])
})

test('B21 footnote definitions numbered in reference order', () => {
  const r = parseBlocks('b[^b] a[^a] b again[^b] none[^zz]\n\n[^a]: Alpha\n[^b]: Beta\n    more beta\n\n    second para\n[^unused]: x')
  expect(tree(r.blocks)).toEqual(['p: b[1] a[2] b again[1] none[^zz]'])
  expect(r.footnotes.map((f) => [f.label, f.n])).toEqual([
    ['b', 1],
    ['a', 2],
  ])
  expect(tree(r.footnotes[0]!.children)).toEqual(['p: Beta↵more beta', 'p: second para'])
  expect(tree(r.footnotes[1]!.children)).toEqual(['p: Alpha'])
  expect([r.footnotes[0]!.startLine, r.footnotes[0]!.endLine]).toEqual([4, 7])
  const nested = parseBlocks('x[^1]\n\n[^1]: see[^2]\n[^2]: two')
  expect(nested.footnotes.map((f) => f.n)).toEqual([1, 2])
})

test('P3 constructs fall through as plain blocks', () => {
  expect(t('$$\nx^2\n$$')).toEqual(['p: $$↵x^2↵$$'])
  expect(t('```mermaid\ngraph TD\n```')).toEqual(['code fenced mermaid: "graph TD"'])
  expect(t('Term\n: def')).toEqual(['p: Term↵: def'])
  expect(t('[TOC]')).toEqual(['p: [TOC]'])
})

test('heading slugs follow GitHub rules with duplicate suffixes', () => {
  const r = parseBlocks('# Hello, World!\n## Hello World\n## hello world\n### `code` & *em*\n# Привет мир')
  expect(r.blocks.map((b) => (b.type === 'heading' ? b.slug : ''))).toEqual([
    'hello-world',
    'hello-world-1',
    'hello-world-2',
    'code--em',
    'привет-мир',
  ])
})

test('source line ranges for containers', () => {
  expect(lines('# a\n\n- x\n- y\n\n  z\n\n> q\nlazy')).toEqual([
    ['heading', 1, 1],
    ['list', 3, 6],
    ['quote', 8, 9],
  ])
  const list = parseBlocks('- x\n- y\n  y2').blocks[0]
  expect(list?.type === 'list' ? list.items.map((i) => [i.startLine, i.endLine]) : null).toEqual([
    [1, 1],
    [2, 3],
  ])
})
