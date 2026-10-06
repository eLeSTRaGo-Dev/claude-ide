import { expect, test } from 'claude-code/testing'
import type { Inline, LinkRef } from './ast'
import { parseInlines } from './inlines'

/** Compact HTML-ish rendering of inlines for assertions. */
function show(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return n.text
        case 'emph':
          return `<em>${show(n.children)}</em>`
        case 'strong':
          return `<strong>${show(n.children)}</strong>`
        case 'strike':
          return `<del>${show(n.children)}</del>`
        case 'mark':
          return `<mark>${show(n.children)}</mark>`
        case 'kbd':
          return `<kbd>${show(n.children)}</kbd>`
        case 'underline':
          return `<u>${show(n.children)}</u>`
        case 'code':
          return `<code>${n.text}</code>`
        case 'link':
          return `<a href="${n.href}"${n.title ? ` title="${n.title}"` : ''}>${show(n.children)}</a>`
        case 'image':
          return `<img src="${n.src}" alt="${n.alt}"${n.title ? ` title="${n.title}"` : ''}>`
        case 'hardBreak':
          return '<br>'
        case 'softBreak':
          return '\n'
        case 'html':
          return `«${n.raw}»`
        case 'footnoteRef':
          return `[^${n.n}]`
      }
    })
    .join('')
}

const md = (s: string, refs?: Map<string, LinkRef>, fn?: (l: string) => number | undefined) =>
  show(parseInlines(s, refs, fn))

test('I1 emphasis with flanking rules', () => {
  expect(md('*a*')).toBe('<em>a</em>')
  expect(md('_a_')).toBe('<em>a</em>')
  expect(md('snake_case_word')).toBe('snake_case_word')
  expect(md('a * b *')).toBe('a * b *')
  expect(md('*a **b** c*')).toBe('<em>a <strong>b</strong> c</em>')
  expect(md('foo*bar*')).toBe('foo<em>bar</em>')
  expect(md('foo_bar_')).toBe('foo_bar_')
})

test('I2 strong', () => {
  expect(md('**a**')).toBe('<strong>a</strong>')
  expect(md('__a__')).toBe('<strong>a</strong>')
  expect(md('**a*b*c**')).toBe('<strong>a<em>b</em>c</strong>')
})

test('I3 strong + emphasis', () => {
  expect(md('***a***')).toBe('<em><strong>a</strong></em>')
  expect(md('***a** b*')).toBe('<em><strong>a</strong> b</em>')
  expect(md('*a **b***')).toBe('<em>a <strong>b</strong></em>')
  expect(md('**unclosed *x*')).toBe('**unclosed <em>x</em>')
})

test('I4 strikethrough', () => {
  expect(md('~~a~~')).toBe('<del>a</del>')
  expect(md('~a~')).toBe('<del>a</del>')
  expect(md('~~a~')).toBe('~~a~')
  expect(md('~~~a~~~')).toBe('~~~a~~~')
})

test('I5 code spans', () => {
  expect(md('`x`')).toBe('<code>x</code>')
  expect(md('`` a ` b ``')).toBe('<code>a ` b</code>')
  expect(md('` `` `')).toBe('<code>``</code>')
  expect(md('`  `')).toBe('<code>  </code>')
  expect(md('`a\nb`')).toBe('<code>a b</code>')
  expect(md('`*no*`')).toBe('<code>*no*</code>')
  expect(md('``unclosed`')).toBe('``unclosed`')
})

test('I6 inline links', () => {
  expect(md('[a](b "t")')).toBe('<a href="b" title="t">a</a>')
  expect(md('[a](<b c>)')).toBe('<a href="b c">a</a>')
  expect(md('[a](b(c))')).toBe('<a href="b(c)">a</a>')
  expect(md('[a]()')).toBe('<a href="">a</a>')
  expect(md('[*e*](u)')).toBe('<a href="u"><em>e</em></a>')
  expect(md('[a] (b)')).toBe('[a] (b)')
  expect(md('[a [b](c)](d)')).toBe('[a <a href="c">b</a>](d)')
  expect(md('[a](#some-heading)')).toBe('<a href="#some-heading">a</a>')
})

test('I7 reference links', () => {
  const refs = new Map([['B', { href: 'u', title: '' }]])
  expect(md('[a][B]', refs)).toBe('<a href="u">a</a>')
  expect(md('[a][b]', refs)).toBe('<a href="u">a</a>')
  expect(md('[b][]', refs)).toBe('<a href="u">b</a>')
  expect(md('[b]', refs)).toBe('<a href="u">b</a>')
  expect(md('[a][nope]', refs)).toBe('[a][nope]')
  expect(md('[nope]', refs)).toBe('[nope]')
  expect(md('![x][b]', refs)).toBe('<img src="u" alt="x">')
})

test('I8 autolinks', () => {
  expect(md('<https://x>')).toBe('<a href="https://x">https://x</a>')
  expect(md('<a@b.c>')).toBe('<a href="mailto:a@b.c">a@b.c</a>')
  expect(md('see https://example.com/a?b=1.')).toBe(
    'see <a href="https://example.com/a?b=1">https://example.com/a?b=1</a>.',
  )
  expect(md('www.x.com.')).toBe('<a href="http://www.x.com">www.x.com</a>.')
  expect(md('(www.x.com/a)')).toBe('(<a href="http://www.x.com/a">www.x.com/a</a>)')
  expect(md('mail me@ex.org now')).toBe('mail <a href="mailto:me@ex.org">me@ex.org</a> now')
  expect(md('[t](https://a.b) https://c.d')).toBe('<a href="https://a.b">t</a> <a href="https://c.d">https://c.d</a>')
  expect(md('`https://x.y`')).toBe('<code>https://x.y</code>')
})

test('I9 images', () => {
  expect(md('![alt *x*](src.png "T")')).toBe('<img src="src.png" alt="alt x" title="T">')
})

test('I10 backslash escapes', () => {
  expect(md('\\*not\\*')).toBe('*not*')
  expect(md('\\_\\#\\[x\\]')).toBe('_#[x]')
  expect(md('\\a')).toBe('\\a')
})

test('I11 entities', () => {
  expect(md('&copy;&#169;&#xA9;')).toBe('©©©')
  expect(md('&amp; &lt; &nbsp;')).toBe('& <  ')
  expect(md('&nosuch; & x')).toBe('&nosuch; & x')
  expect(md('&#0;')).toBe('�')
})

test('B4 hard and soft breaks', () => {
  expect(md('a  \nb')).toBe('a<br>b')
  expect(md('a\\\nb')).toBe('a<br>b')
  expect(md('a\n   b')).toBe('a\nb')
  expect(md('a \nb')).toBe('a\nb')
})

test('I12 inline HTML tags', () => {
  expect(md('<kbd>Ctrl</kbd>+<kbd>C</kbd>')).toBe('<kbd>Ctrl</kbd>+<kbd>C</kbd>')
  expect(md('<b>x</b> <strong>y</strong> <i>z</i> <em>w</em>')).toBe(
    '<strong>x</strong> <strong>y</strong> <em>z</em> <em>w</em>',
  )
  expect(md('<u>u</u><s>s</s><del>d</del>')).toBe('<u>u</u><del>s</del><del>d</del>')
  expect(md('<code>a*b*</code>')).toBe('<code>ab</code>')
  expect(md('<mark>m</mark>')).toBe('<mark>m</mark>')
  expect(md('H<sub>2</sub>O x<sup>2</sup>')).toBe('H2O x2')
  expect(md('a<br>b<br/>c')).toBe('a<br>b<br>c')
  expect(md('<a href="https://x.y" title="t">go</a>')).toBe('<a href="https://x.y" title="t">go</a>')
  expect(md('<img src="p.png" alt="P">')).toBe('<img src="p.png" alt="P">')
  expect(md('<span class="x">t</span>')).toBe('t')
  expect(md('<foo>t</foo>')).toBe('«<foo>»t«</foo>»')
  expect(md('a <!-- c --> b')).toBe('a «<!-- c -->» b')
  expect(md('<b>unclosed')).toBe('«<b>»unclosed')
  expect(md('<b>*x</b>*')).toBe('<strong>*x</strong>*')
})

test('I13 footnote references', () => {
  const nums = new Map([['1', 1], ['NOTE', 2]])
  const fn = (l: string) => nums.get(l)
  expect(md('a[^1] b[^note] c[^x]', undefined, fn)).toBe('a[^1] b[^2] c[^x]')
  expect(md('[^1]')).toBe('[^1]')
})

test('performance: long pathological lines stay fast', () => {
  const t0 = Date.now()
  parseInlines('*a '.repeat(20000))
  parseInlines('`'.repeat(5000) + ' x '.repeat(5000))
  parseInlines('['.repeat(20000) + 'x' + ']'.repeat(20000))
  parseInlines('a_'.repeat(20000))
  parseInlines('<a '.repeat(20000))
  parseInlines('x'.repeat(100000) + '@')
  parseInlines('*a* '.repeat(30000) + '\n'.repeat(10))
  expect(Date.now() - t0).toBeLessThan(1500)
})
