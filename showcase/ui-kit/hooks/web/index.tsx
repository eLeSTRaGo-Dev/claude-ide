import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { WebState } from '../../types'
import { encode, pixelsFor } from './raster'
import {
  PANE, cellToPage, downscaleRgb, enqueue, fpsOf, parseLine, splitLines, viewportPx,
} from './protocol'
import type { Cmd, Queued } from './protocol'

const KEY = 'page'
const OVERLAY = 'page-pointer'
const FPS = 24
const RASTER_MS = 200 // the half-block fallback is repainted at ~5 fps

const web = atom<'ui-kit', 'web'>({ plugin: 'ui-kit', key: 'web' } as const, { url: '' } satisfies WebState)

type Frame = { file: string; width: number; height: number; n: number }

// Module-level: a reload starts these over (the bridge dies with the old module).
const S = {
  started: false,
  bridge: 'idle', // idle | starting | ready | error | exited
  message: undefined as string | undefined,
  tail: '',
  cmdFile: `/dev/shm/uik-web-cmd-${Date.now().toString(36)}.json`,
  seq: 0,
  queue: [] as Queued[],
  write: Promise.resolve() as Promise<void>,
  last: undefined as Frame | undefined,
  times: [] as number[],
  fps: 0,
  box: { columns: 0, rows: 0 },
  page: { width: 0, height: 0 }, // the viewport the bridge was last told
  probed: false,
  forced: false,
  imageNote: undefined as string | undefined,
  rasterAt: 0,
  rasterBusy: false,
  ticker: undefined as { cancel: () => void } | undefined,
  url: '',
}

const send = ($: EngineInterface, cmd: Cmd): void => {
  const next = enqueue(S.queue, ++S.seq, cmd)
  S.queue = next.queue
  S.write = S.write.then(() => $.fs.write(S.cmdFile, next.text)).catch(() => {})
}

async function readRgb($: EngineInterface, f: Frame, columns: number, rows: number): Promise<string> {
  const { base64 } = await $.fs.read(f.file, { as: 'bytes' })
  const px = pixelsFor('half', columns, rows)

  return encode(downscaleRgb(Uint8Array.fromBase64(base64), f.width, f.height, px.width, px.height), 'half', columns, rows)
}

const sourceOf = (f: Frame) =>
  ({ file: f.file, format: 'rgb', width: f.width, height: f.height, generation: f.n }) as const

async function onFrame($: EngineInterface, f: Frame): Promise<void> {
  const first = S.last === undefined
  S.last = f
  const now = Date.now()
  S.times = [...S.times.filter(t => now - t < 3000), now]
  if (first) {
    $.ui.invalidate('ui.render') // the Image is drawn from the first frame on
    return
  }
  const { columns, rows } = S.box
  if (columns === 0) return
  const state = await read($, web)
  if ((state.path ?? 'image') === 'image') {
    const res = await $.ui.blit({ requestId: PANE, key: KEY, source: sourceOf(f), columns, rows })
    if (res.deny?.includes('alt') === true && !S.forced) {
      S.imageNote = `Image drew its alt: ${res.deny}`
      await update($, web, s => ({ ...s, path: 'raster' as const }))
    }
  } else if (!S.rasterBusy && now - S.rasterAt >= RASTER_MS) {
    S.rasterBusy = true
    S.rasterAt = now
    try {
      await $.ui.blit({ requestId: PANE, key: KEY, cells: await readRgb($, f, columns, rows) })
    } catch {
      /* the frame was replaced; the next one comes */
    } finally {
      S.rasterBusy = false
    }
  }
}

function handleText($: EngineInterface, text: string): void {
  const { lines, tail } = splitLines(S.tail, text)
  S.tail = tail
  for (const line of lines) {
    const m = parseLine(line)
    if (m === undefined) continue
    if (m.kind === 'frame') void onFrame($, { file: m.file, width: m.width, height: m.height, n: m.n })
    else if (m.kind === 'url') {
      S.url = m.url
      $.ui.invalidate('ui.render')
    } else {
      S.bridge = m.status
      S.message = m.message
      void update($, web, s => ({ ...s, status: m.message ?? m.status }))
    }
  }
}

function start($: EngineInterface, url: string): void {
  if (S.started) return
  S.started = true
  S.bridge = 'starting'
  const { width, height } = S.page
  const argv = [
    'deno', 'run', '-A', `${$.plugin.root}/bridge/browser.ts`,
    '--url', url, '--size', `${width}x${height}`, '--cmd', S.cmdFile, '--fps', String(FPS),
  ]
  void (async () => {
    try {
      // The loop is the child's life: it ends with the child, or with the module.
      for await (const chunk of $.process.spawn({ argv })) {
        if ('text' in chunk) {
          if (chunk.stream === 'stdout') handleText($, chunk.text)
          else if (chunk.text.trim() !== '') S.message = chunk.text.trim().split('\n').pop()
        }
      }
      S.bridge = 'exited'
    } catch (error) {
      S.bridge = 'error'
      S.message = `cannot run deno: ${error}`
    }
    S.started = false
    $.ui.invalidate('ui.render')
  })()
  S.ticker ??= $.clock.every(1000, () => {
    const fps = fpsOf(S.times, Date.now())
    if (fps !== S.fps) {
      S.fps = fps
      $.ui.invalidate('ui.render')
    }
  })
}

const stop = async ($: EngineInterface): Promise<void> => {
  if (S.bridge === 'ready' || S.bridge === 'starting') send($, { quit: true })
  S.ticker?.cancel()
  S.ticker = undefined
  S.last = undefined
  S.probed = false
  S.times = []
  await $.process.run(['rm', '-f', '--', S.cmdFile]).catch(() => undefined)
}

export function register(on: On) {
  on('ui.close', { id: PANE }, async ($, e, next) => {
    await stop($)

    return next(e)
  })

  on('ui.message', { requestId: PANE }, async ($, e) => {
    if (e.element !== OVERLAY) return {}
    const d = e.data as { mouse?: { type: 'down' | 'up' | 'move'; x: number; y: number; button?: 'left' | 'middle' | 'right' }; key?: { key: string; ctrl?: boolean; shift?: boolean; meta?: boolean } } | null
    if (d === null || typeof d !== 'object' || S.box.columns === 0 || S.page.width === 0) return {}
    if (d.mouse !== undefined) {
      const p = cellToPage(d.mouse, S.box, S.page)
      send($, { mouse: { ...d.mouse, ...p } })
    } else if (d.key !== undefined) send($, { key: d.key })

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const state = await read($, web)
    const demo = `file://${$.plugin.root}/web/demo.html`
    const url = S.url !== '' ? S.url : state.url !== '' ? state.url : demo

    if (e.surface !== 'terminal') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Web</Text>
          <Text dimColor>The headless-browser pane streams pixels into a terminal Image (Ghostty or kitty); this surface has no such picture. Open the same page in a real browser (desktop allows only https links, so it shows the path):</Text>
          {e.surface === 'desktop' ? <Text>{demo}</Text> : <Link href={demo} label="demo.html" />}
        </Box>
      )
    }

    const { Image, Raster, Client } = $.ui.resolve(e as typeof e & { surface: 'terminal' })
    const columns = Math.max(10, e.props.bodyColumns)
    const rows = Math.max(4, e.props.scroll.bodyRows - 4)
    S.box = { columns, rows }
    const vp = viewportPx(columns, rows)

    if (S.page.width !== 0 && (S.page.width !== vp.width || S.page.height !== vp.height)) {
      S.page = vp
      if (S.bridge === 'ready') send($, { resize: [vp.width, vp.height] })
    } else S.page = vp
    if (!S.started && S.bridge !== 'error' && S.bridge !== 'exited') $.clock.after(0, () => start($, url))

    const path = state.path ?? 'image'
    const missing = S.bridge === 'error' && /chromium not found/.test(S.message ?? '')
    const cmd = (c: Cmd) => () => send($, c)
    const setPath = (p: 'image' | 'raster' | undefined) => {
      S.forced = p !== undefined
      S.imageNote = undefined
      S.probed = false
      return update($, web, s => {
        const { path: _old, ...rest } = s
        return { ...rest, ...(p !== undefined ? { path: p } : {}) }
      })
    }

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>Web</Text>
          <Text dimColor wrap="truncate">{url}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button key="reload" label="reload" hotkey="r" onPress={cmd({ reload: true })} />
          <Button key="back" label="back" hotkey="b" onPress={cmd({ back: true })} />
          <Button key="up" label="scroll up" onPress={cmd({ scroll: -240 })} />
          <Button key="down" label="scroll down" onPress={cmd({ scroll: 240 })} />
          <Button key="path:auto" label={state.path === undefined ? '[auto]' : 'auto'} onPress={() => setPath(undefined)} />
          <Button key="path:image" label={state.path === 'image' ? '[image]' : 'image'} onPress={() => setPath('image')} />
          <Button key="path:raster" label={state.path === 'raster' ? '[raster]' : 'raster'} onPress={() => setPath('raster')} />
        </Box>
        <Text dimColor wrap="truncate">
          {`${path} · ${S.fps} fps · ${vp.width}x${vp.height}px · ${S.bridge}${state.status !== undefined ? `: ${state.status}` : ''}`}
        </Text>
      </Box>
    )

    if (missing) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text color="yellow" bold>Chromium is not installed.</Text>
          <Text>Run: sudo pacman -S chromium   (or set CHROMIUM to its path), then press reload.</Text>
          <Button key="retry" label="retry" onPress={() => { S.bridge = 'idle'; S.message = undefined; return update($, web, s => ({ ...s, status: undefined })) }} />
        </Box>
      )
    }
    if (S.bridge === 'error' || S.bridge === 'exited') {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text color="red">{`bridge ${S.bridge}: ${S.message ?? 'no details'}`}</Text>
          <Button key="retry" label="retry" onPress={() => { S.bridge = 'idle'; S.message = undefined; return update($, web, s => ({ ...s, status: undefined })) }} />
        </Box>
      )
    }
    const f = S.last
    if (f === undefined) {
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>starting headless Chromium (the first run downloads puppeteer-core)...</Text>
        </Box>
      )
    }

    let picture
    if (path === 'raster') {
      let cells = ''
      try {
        cells = await readRgb($, f, columns, rows)
      } catch {
        cells = encode(downscaleRgb(new Uint8Array(0), 1, 1, 1, 1), 'half', 1, 1)
      }
      picture = <Raster key={KEY} columns={columns} rows={rows} cells={cells} />
    } else {
      picture = <Image key={KEY} source={sourceOf(f)} columns={columns} rows={rows} alt="the page (this terminal cannot draw pictures)" />
      if (!S.probed) {
        S.probed = true
        $.clock.after(250, async () => {
          const last = S.last
          if (last === undefined) return
          const res = await $.ui.blit({ requestId: PANE, key: KEY, source: sourceOf(last), columns, rows })
          if (res.deny?.includes('alt') === true) {
            S.imageNote = `Image drew its alt: ${res.deny}`
            if (!S.forced) await update($, web, s => ({ ...s, path: 'raster' as const }))
            else $.ui.invalidate('ui.render')
          } else if (res.deny !== undefined) {
            S.imageNote = res.deny
            $.ui.invalidate('ui.render')
          }
        })
      }
    }

    return (
      <Box flexDirection="column">
        {header}
        {S.imageNote !== undefined && path === 'image' ? <Text dimColor wrap="truncate">{S.imageNote}</Text> : undefined}
        <Box position="relative" width={columns} height={rows}>
          {picture}
          <Box position="absolute" top={0} left={0}>
            <Client key={OVERLAY} module="./overlay-client.tsx" width={columns} height={rows} />
          </Box>
        </Box>
      </Box>
    )
  })
}
