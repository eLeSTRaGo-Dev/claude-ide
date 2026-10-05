import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROPS = {
  title: 'Host render',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'
const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// Fakes the host programs: rsvg/magick/ffmpeg succeed; the rgb file is solid red
// at the size `magick` was asked for.
const fake = (on: On, calls: string[][] = []): void => {
  const sizes = new Map<string, [number, number]>()
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    const resize = e.argv.indexOf('-resize')
    const out = e.argv.at(-1) ?? ''
    if (e.argv[0] === 'magick' && resize >= 0 && out.startsWith('rgb:')) {
      const [w, h] = (e.argv[resize + 1] ?? '').replace('!', '').split('x').map(Number)
      sizes.set(out.slice(4), [w!, h!])
    }
    return { value: ok }
  })
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('.svg')) return { value: SVG }
    const [w, h] = sizes.get(e.path) ?? [1, 1]
    const bytes = new Uint8Array(w * h * 3)
    for (let i = 0; i < bytes.length; i += 3) bytes[i] = 255

    return { value: { base64: bytes.toBase64() } }
  })
  on('env.get', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

const mountAs = async ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'gfx-gallery', surface, component: 'Pane', props: PROPS, requestId: 'gfx-host', viewport: { columns: 120, rows: 40 } })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: draws the picture its surface can`, async ($, on) => {
    const calls: string[][] = []
    fake(on, calls)
    await $.session.start({ cwd: '/proj', surface, isInteractive: true })
    const ui = await mountAs($, surface)

    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Image', key: 'host' })).toBeDefined()
      expect(calls.some(c => c[0] === 'rsvg-convert')).toBe(true)
      // forcing raster draws cells from the magick rgb file
      await ui.press({ key: 'path:raster' })
      const raster = await ui.find({ type: 'Raster', key: 'host' })
      expect(raster).toBeDefined()
      expect(calls.some(c => c[0] === 'magick' && (c.at(-1) ?? '').startsWith('rgb:'))).toBe(true)
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(svg?.props.source).toContain('<svg')
      expect(await ui.find({ type: 'Image' })).toBeUndefined()
      expect(calls).toHaveLength(0)
    }
  })

  test(`${surface}: the source picker switches the asset`, async ($, on) => {
    fake(on)
    await $.session.start({ cwd: '/proj', surface, isInteractive: true })
    const ui = await mountAs($, surface)
    await ui.press({ key: 'src:diagram' })
    expect((await ui.find({ key: 'src:diagram' }))?.props.label).toBe('[diagram]')
  })
}

test('terminal: video source runs ffmpeg and offers play', async ($, on) => {
  const calls: string[][] = []
  fake(on, calls)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await mountAs($, 'terminal')
  await ui.press({ key: 'path:raster' })
  await ui.press({ key: 'src:video' })
  expect(calls.some(c => c[0] === 'ffmpeg' && c.includes('rawvideo'))).toBe(true)
  expect((await ui.find({ key: 'play' }))?.props.hotkey).toBe('p')
  expect(await ui.find({ type: 'Raster', key: 'host' })).toBeDefined()
})
