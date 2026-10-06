import { expect, test } from 'claude-code/testing'

import {
  cleanOutput,
  cleanText,
  codeChunks,
  convertArgv,
  convertedPath,
  engineArgv,
  engineOf,
  firstLine,
  fitCells,
  hasSourceView,
  hashOf,
  imageInfo,
  isPictureFile,
  parseEngines,
  pngSize,
  pngSizeFromHex,
  runFailure,
  svgSize,
} from './preview'
import type { CustomEngine } from './preview'

const pdf: CustomEngine = { cmd: ['pdftotext', '{path}', '-'], as: 'text' }

test('engineOf: markdown, image and svg by lowercased ext, else code', () => {
  expect(engineOf('README.md')).toBe('markdown')
  expect(engineOf('notes.MARKDOWN')).toBe('markdown')
  expect(engineOf('page.mdx')).toBe('markdown')
  for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp']) {
    expect(engineOf(name)).toBe('image')
  }
  expect(engineOf('logo.Svg')).toBe('svg')
  expect(engineOf('main.ts')).toBe('code')
  expect(engineOf('Makefile')).toBe('code')
  expect(engineOf('.md')).toBe('code')
  expect(engineOf('toString')).toBe('code')
  expect(engineOf('x.constructor')).toBe('code')
})

test('engineOf: a custom entry overrides the built-ins', () => {
  const svg: CustomEngine = { cmd: ['cat', '{path}'], as: 'text' }
  expect(engineOf('doc.PDF', { pdf })).toEqual({ custom: pdf })
  expect(engineOf('logo.svg', { svg })).toEqual({ custom: svg })
  expect(engineOf('a.md', { pdf })).toBe('markdown')
})

test('engineArgv substitutes {path} and {out} in every element', () => {
  expect(engineArgv(pdf, '/p/a.pdf', '/tmp/o.png')).toEqual(['pdftotext', '/p/a.pdf', '-'])
  const psd: CustomEngine = { cmd: ['magick', '{path}[0]', 'png:{out}'], as: 'png' }
  expect(engineArgv(psd, '/p/a.psd', '/tmp/o.png')).toEqual([
    'magick',
    '/p/a.psd[0]',
    'png:/tmp/o.png',
  ])
})

test('parseEngines: empty is nothing, bad JSON is one error', () => {
  expect(parseEngines('')).toEqual({ engines: {}, errors: [] })
  expect(parseEngines('  \n')).toEqual({ engines: {}, errors: [] })
  const bad = parseEngines('{nope')
  expect(bad.engines).toEqual({})
  expect(bad.errors.length).toBe(1)
  expect(parseEngines('[1]').errors.length).toBe(1)
})

test('parseEngines: valid entries, keys lowercased and undotted', () => {
  const { engines, errors } = parseEngines(
    JSON.stringify({
      PDF: { cmd: ['pdftotext', '{path}', '-'], as: 'text' },
      '.psd': { cmd: ['magick', '{path}[0]', '{out}'], as: 'png' },
    }),
  )
  expect(errors).toEqual([])
  expect(engines).toEqual({
    pdf: { cmd: ['pdftotext', '{path}', '-'], as: 'text' },
    psd: { cmd: ['magick', '{path}[0]', '{out}'], as: 'png' },
  })
})

test('parseEngines: each bad entry is left out with an error', () => {
  const { engines, errors } = parseEngines(
    JSON.stringify({
      ok: { cmd: ['cat', '{path}'], as: 'code' },
      a: { cmd: [], as: 'text' },
      b: { cmd: ['x', 1], as: 'text' },
      c: { cmd: 'cat', as: 'text' },
      d: { cmd: ['cat'], as: 'html' },
      e: { cmd: ['magick', '{path}', 'x.png'], as: 'png' },
      f: 'cat',
    }),
  )
  expect(Object.keys(engines)).toEqual(['ok'])
  expect(errors.length).toBe(6)
  expect(errors.some(e => e.includes('previewEngines.e') && e.includes('{out}'))).toBe(true)
})

test('fitCells keeps the aspect inside the room', () => {
  expect(fitCells(80, 20, 2)).toEqual({ columns: 80, rows: 20 })
  expect(fitCells(80, 10, 2)).toEqual({ columns: 40, rows: 10 })
  expect(fitCells(20, 30, 1)).toEqual({ columns: 20, rows: 10 })
  expect(fitCells(0, 0, 1)).toEqual({ columns: 1, rows: 1 })
})

test('hashOf: 8 hex digits, stable, distinct', () => {
  expect(hashOf('')).toBe('811c9dc5')
  expect(hashOf('/p/a.png:1')).toMatch(/^[0-9a-f]{8}$/)
  expect(hashOf('/p/a.png:1')).toBe(hashOf('/p/a.png:1'))
  expect(hashOf('/p/a.png:1')).not.toBe(hashOf('/p/a.png:2'))
})

test('convertArgv per tool: the coder named by the extension, first frame, at most 2048 px a side', () => {
  const fit = ['-thumbnail', '2048x2048>']
  expect(convertArgv('magick', '/p/a.gif', '/o.png')).toEqual(['magick', 'gif:/p/a.gif[0]', ...fit, 'png:/o.png'])
  expect(convertArgv('convert', '/p/a.gif', '/o.png')).toEqual(['convert', 'gif:/p/a.gif[0]', ...fit, 'png:/o.png'])
  expect(convertArgv('magick', '/p/A.JPG', '/o.png')?.[1]).toBe('jpeg:/p/A.JPG[0]')
  expect(convertArgv('magick', '/p/a.jpeg', '/o.png')?.[1]).toBe('jpeg:/p/a.jpeg[0]')
  expect(convertArgv('magick', '/p/a.webp', '/o.png')?.[1]).toBe('webp:/p/a.webp[0]')
  expect(convertArgv('magick', '/p/a.bmp', '/o.png')?.[1]).toBe('bmp:/p/a.bmp[0]')
  expect(convertArgv('magick', '/p/a.png', '/o.png')?.[1]).toBe('png:/p/a.png[0]')
  expect(convertArgv('magick', '/p/a.svg', '/o.png')?.[1]).toBe('svg:/p/a.svg[0]')
  // anything else never reaches ImageMagick (its content would pick the coder)
  for (const src of ['/p/a.pdf', '/p/a.ps', '/p/a.mvg', '/p/noext', '/p.png/x']) {
    expect(convertArgv('magick', src, '/o.png')).toBeUndefined()
  }
  expect(convertArgv('rsvg-convert', '/p/a.svg', '/o.png')).toEqual([
    'rsvg-convert',
    '-f',
    'png',
    '-o',
    '/o.png',
    '/p/a.svg',
  ])
})

test('pngSize reads the IHDR from base64 or bytes', () => {
  // 640x480 header
  expect(pngSize('iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAA=')).toEqual({ width: 640, height: 480 })
  // a whole 1x1 PNG
  expect(
    pngSize(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    ),
  ).toEqual({ width: 1, height: 1 })
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0,
    0, 0, 0, 200,
  ])
  expect(pngSize(bytes)).toEqual({ width: 256, height: 200 })
})

test('pngSize: undefined for a non-PNG or a short input', () => {
  expect(pngSize('R0lGODlhAQABAAAAAAAAAAAAAAAAAAAAAAA=')).toBe(undefined)
  expect(pngSize('iVBORw0KGgo=')).toBe(undefined)
  expect(pngSize('')).toBe(undefined)
})

test('fitCells fills a large room up to the Image limit', () => {
  expect(fitCells(300, 300, 1)).toEqual({ columns: 255, rows: 128 })
  expect(fitCells(200, 60, 2)).toEqual({ columns: 200, rows: 50 })
})

test('convertedPath: one file per path and mtime', () => {
  const a = convertedPath('/dev/shm', '/p/a.jpg', 1)
  expect(a).toMatch(/^\/dev\/shm\/ide-panes-preview-[0-9a-f]{8}\.png$/)
  expect(a).toBe(`/dev/shm/ide-panes-preview-${hashOf('/p/a.jpg\u00001')}.png`)
  expect(convertedPath('/dev/shm', '/p/a.jpg', 2)).not.toBe(a)
})

test('hasSourceView: svg and markdown', () => {
  expect(hasSourceView('svg')).toBe(true)
  expect(hasSourceView('image')).toBe(false)
  expect(hasSourceView('code')).toBe(false)
  expect(hasSourceView('markdown')).toBe(true)
})

test('imageInfo: dimensions when known', () => {
  expect(imageInfo('1.2 KiB', 640, 480)).toBe('640×480 px · 1.2 KiB')
  expect(imageInfo('1.2 KiB')).toBe('1.2 KiB')
})

test('svgSize: width/height, else viewBox, else undefined', () => {
  expect(svgSize('<svg xmlns="x" width="120" height="40px"><g/></svg>')).toEqual({ width: 120, height: 40 })
  expect(svgSize("<svg viewBox='0 0 24 12'></svg>")).toEqual({ width: 24, height: 12 })
  expect(svgSize('<svg width="100%" height="100%" viewBox="0,0,10,20"/>')).toEqual({ width: 10, height: 20 })
  expect(svgSize('<svg></svg>')).toBe(undefined)
  expect(svgSize('not svg')).toBe(undefined)
})

test('firstLine: the first non-blank line, trimmed', () => {
  expect(firstLine('\n  \n  Syntax Error: no pages \nmore\n')).toBe('Syntax Error: no pages')
  expect(firstLine(' \n\n')).toBeUndefined()
})

test("runFailure: the engine's timeout reads timed out, else the first line", () => {
  expect(runFailure('tprobe: $.process.run(sleep) aborted: still running after 10000ms')).toBe('timed out')
  expect(runFailure('process timed out')).toBe('timed out')
  expect(runFailure('spawn pdftotext ENOENT\nstack')).toBe('spawn pdftotext ENOENT')
  expect(runFailure('')).toBe('failed')
})

test('pngSizeFromHex: od -An -tx1 -N24 output', () => {
  // the 200x100 header, as od prints it (16 bytes a line, leading spaces)
  const od = ' 89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52\n 00 00 00 c8 00 00 00 64\n'
  expect(pngSizeFromHex(od)).toEqual({ width: 200, height: 100 })
  expect(pngSizeFromHex(od.toUpperCase())).toEqual({ width: 200, height: 100 })
  // short (a tiny file) or not a PNG
  expect(pngSizeFromHex(' 89 50 4e 47\n')).toBeUndefined()
  expect(pngSizeFromHex(' ff d8 ff e0 00 10 4a 46 49 46 00 01 01 00 00 01\n 00 01 00 00 ff db 00 43\n')).toBeUndefined()
  expect(pngSizeFromHex('')).toBeUndefined()
})

test('cleanText: tab and newline stay, other control characters become spaces', () => {
  expect(cleanText('a\tb\nc')).toBe('a\tb\nc')
  expect(cleanText('a\fb\rc\u0000d\u007fe\u0085f')).toBe('a b c d e f')
  expect(cleanText('héllo 世界')).toBe('héllo 世界')
})

test('cleanOutput: ANSI escapes dropped, CRLF as LF, form feed a space', () => {
  expect(cleanOutput('\x1b[31mred\x1b[0m plain\n')).toBe('red plain\n')
  expect(cleanOutput('\x1b[1;38;5;208mx\x1b[m')).toBe('x')
  expect(cleanOutput('\x1b]8;;https://e.x\x07link\x1b]8;;\x07')).toBe('link')
  expect(cleanOutput('\x1b]0;title\x1b\\after')).toBe('after')
  expect(cleanOutput('a\x1b(Bb \x1bc')).toBe('ab ')
  expect(cleanOutput('page 1\r\n\fpage 2\n')).toBe('page 1\n page 2\n')
  // what is left is drawable: tab and newline only
  expect(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(cleanOutput('\x1b[2J\x1b[H\f\x07\x1b'))).toBe(false)
})

test('codeChunks: runs under the limit, every line kept in order', () => {
  expect(codeChunks([])).toEqual([])
  expect(codeChunks(['a', 'b', ''])).toEqual([['a', 'b', '']])
  // 3 + 1 + 3 = 7 is not under 7
  expect(codeChunks(['aaa', 'bbb', 'c'], 7)).toEqual([['aaa'], ['bbb', 'c']])
  expect(codeChunks(['aa', 'bb'], 6)).toEqual([['aa', 'bb']])
  // a line alone at the limit is cut under it
  expect(codeChunks(['x'.repeat(12), 'y'], 10)).toEqual([['x'.repeat(9)], ['y']])
  const wide = Array.from({ length: 120 }, (_, i) => String(i % 10).repeat(250))
  const runs = codeChunks(wide)
  expect(runs.length).toBeGreaterThan(1)
  for (const run of runs) expect(run.join('\n').length).toBeLessThan(10000)
  expect(runs.flat()).toEqual(wide)
})

test('isPictureFile: built-in images and svg only, a custom engine overrides', () => {
  for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.svg']) expect(isPictureFile(name)).toBe(true)
  for (const name of ['doc.pdf', 'x.ps', 'y.mvg', 'notes.md', 'noext', 'a.png.txt']) expect(isPictureFile(name)).toBe(false)
  expect(isPictureFile('a.png', { png: { cmd: ['x', '{path}'], as: 'text' } })).toBe(false)
})
