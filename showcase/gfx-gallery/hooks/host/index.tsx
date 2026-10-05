import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { HostState } from '../../types'
import { encode, pixelsFor } from '../shared/raster'
import {
  ASSETS, VIDEO, VIDEO_FPS, VIDEO_FRAMES, ffmpegArgv, fitCells, frameFromRgb, hashOf, imagePixels,
  magickPngArgv, magickRgbArgv, rsvgArgv, shmPath, videoDir, videoFrame, assetOf,
} from './host'

const PANE = 'gfx-host'
const KEY = 'host'
const VIDEO_ASPECT = 16 / 9

const host = atom<'gfx-gallery', 'host'>(
  { plugin: 'gfx-gallery', key: 'host' } as const,
  { source: 'logo' } satisfies HostState,
)

type Path = 'image' | 'raster'
type Built = {
  sig: string
  kind: Path
  columns: number
  rows: number
  width: number // pixels of an Image source
  height: number
  renderer?: 'rsvg' | 'magick'
  file?: string // image: the png (still) or the frame dir (video)
  generation: number
  cells?: string[] // raster: one entry per still, per frame of a video
  error?: string
}

// Module-level caches; a reload starts them over (the files are re-made).
let built: Built | undefined
const inflight = new Map<string, Promise<Built>>()
let generation = 0
let forced = false // the person picked image or raster, so a deny does not switch it
let imageNote: string | undefined // why the Image path cannot draw here
let probedSig: string | undefined
let player: Timer | undefined
let frameNo = 0

const sh = async ($: EngineInterface, argv: string[]): Promise<boolean> => {
  try {
    return (await $.process.run(argv)).exitCode === 0
  } catch {
    return false
  }
}

const rm = async ($: EngineInterface, paths: string[]): Promise<void> => {
  if (paths.length > 0) await sh($, ['rm', '-rf', '--', ...paths])
}

async function readRgb($: EngineInterface, file: string, w: number, h: number) {
  const { base64 } = await $.fs.read(file, { as: 'bytes' })

  return frameFromRgb(Uint8Array.fromBase64(base64), w, h)
}

async function pngOf($: EngineInterface, svg: string, out: string, w: number, h: number) {
  if (await sh($, rsvgArgv(svg, out, w, h))) return 'rsvg' as const
  if (await sh($, magickPngArgv(svg, out, w, h))) return 'magick' as const

  return undefined
}

async function buildStill(
  $: EngineInterface, name: string, kind: Path, columns: number, rows: number, sig: string,
): Promise<Built> {
  const hash = hashOf(sig)
  const svg = `${$.plugin.root}/assets/${name}.svg`
  const px = kind === 'image' ? imagePixels(columns, rows) : pixelsFor('half', columns, rows)
  const base = { sig, kind, columns, rows, width: px.width, height: px.height, generation: ++generation }
  const png = shmPath(hash, 'png')
  const renderer = await pngOf($, svg, png, px.width, px.height)
  if (renderer === undefined) return { ...base, error: 'rsvg-convert and magick both failed' }
  if (kind === 'image') return { ...base, renderer, file: png }

  // Raster fallback: the png, as raw rgb at half-block size, then cells.
  const raw = shmPath(hash, 'rgb')
  try {
    if (!(await sh($, magickRgbArgv(png, raw, px.width, px.height)))) return { ...base, renderer, error: 'magick rgb failed' }
    const frame = await readRgb($, raw, px.width, px.height)

    return { ...base, renderer, cells: [encode(frame, 'half', columns, rows)] }
  } catch (error) {
    return { ...base, renderer, error: String(error) }
  } finally {
    await rm($, [png, raw])
  }
}

async function buildVideo(
  $: EngineInterface, kind: Path, columns: number, rows: number, sig: string,
): Promise<Built> {
  const dir = videoDir(hashOf(sig))
  const px = kind === 'image' ? imagePixels(columns, rows) : pixelsFor('half', columns, rows)
  const base = { sig, kind, columns, rows, width: px.width, height: px.height, generation: ++generation }
  await rm($, [dir])
  if (!(await sh($, ['mkdir', '-p', dir]))) return { ...base, error: 'mkdir failed' }
  if (!(await sh($, ffmpegArgv(dir, px.width, px.height)))) {
    await rm($, [dir])

    return { ...base, error: 'ffmpeg failed' }
  }
  if (kind === 'image') return { ...base, file: dir }
  try {
    const cells: string[] = []
    for (let i = 0; i < VIDEO_FRAMES; i++) {
      const frame = await readRgb($, videoFrame(dir, i), px.width, px.height)
      cells.push(encode(frame, 'half', columns, rows))
    }

    return { ...base, cells }
  } catch (error) {
    return { ...base, error: String(error) }
  } finally {
    await rm($, [dir])
  }
}

function leftovers(old: Built | undefined, next: Built): string[] {
  return old?.file !== undefined && old.file !== next.file ? [old.file] : []
}

async function ensure(
  $: EngineInterface, source: string, kind: Path, columns: number, rows: number,
): Promise<Built> {
  const sig = `${source}|${kind}|${columns}x${rows}`
  if (built?.sig === sig) return built
  let job = inflight.get(sig)
  if (job === undefined) {
    job = (source === VIDEO ? buildVideo($, kind, columns, rows, sig) : buildStill($, source, kind, columns, rows, sig))
      .then(async next => {
        const old = built
        built = next
        await rm($, leftovers(old, next))

        return next
      })
      .finally(() => inflight.delete(sig))
    inflight.set(sig, job)
  }

  return job
}

const sourceOf = (b: Built, frame: number) =>
  b.kind === 'image' && b.file !== undefined
    ? b.cells === undefined && b.file.endsWith('.png')
      ? ({ file: b.file, format: 'png', generation: b.generation } as const)
      : ({ file: videoFrame(b.file, frame), format: 'rgb', width: b.width, height: b.height, generation: frame } as const)
    : undefined

function stopPlayer(): void {
  player?.cancel()
  player = undefined
}

async function stopAndClear($: EngineInterface, why?: string): Promise<void> {
  stopPlayer()
  await update($, host, s => ({ ...s, playing: false }))
  if (why !== undefined) $.ui.toast(why)
}

function play($: EngineInterface): void {
  stopPlayer()
  player = $.clock.every(Math.round(1000 / VIDEO_FPS), async () => {
    const b = built
    if (b === undefined || b.error !== undefined || b.sig.split('|')[0] !== VIDEO) return stopAndClear($)
    frameNo = (frameNo + 1) % VIDEO_FRAMES
    const res =
      b.cells !== undefined
        ? await $.ui.blit({ requestId: PANE, key: KEY, cells: b.cells[frameNo]!, columns: b.columns, rows: b.rows })
        : await $.ui.blit({ requestId: PANE, key: KEY, source: sourceOf(b, frameNo)!, columns: b.columns, rows: b.rows })
    if (res.deny !== undefined) return stopAndClear($, `video stopped: ${res.deny}`)
  })
}

// Draws the Image, then blits the keyed Image: a deny naming alt means this
// terminal has no kitty graphics, so an automatic choice moves to the Raster.
function probe($: EngineInterface, b: Built, tries = 0): void {
  if (b.kind !== 'image' || b.error !== undefined || probedSig === b.sig) return
  probedSig = b.sig
  $.clock.after(250, async () => {
    const source = sourceOf(b, frameNo)
    if (source === undefined || built !== b) return
    const res = await $.ui.blit({ requestId: PANE, key: KEY, source, columns: b.columns, rows: b.rows })
    if (res.deny === undefined) {
      imageNote = undefined

      return
    }
    if (res.deny.includes('alt')) {
      imageNote = `Image drew its alt: ${res.deny}`
      if (!forced) await update($, host, s => ({ ...s, path: 'raster' as const }))
      else $.ui.invalidate('ui.render')
    } else if (tries < 3) {
      probedSig = undefined
      probe($, b, tries + 1)
    } else {
      imageNote = res.deny
      $.ui.invalidate('ui.render')
    }
  })
}

export function register(on: On) {
  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopPlayer()
    const old = built
    built = undefined
    probedSig = undefined
    if (old?.file !== undefined) await rm($, [old.file])

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, host)
    const isVideo = state.source === VIDEO
    const isTerminal = e.surface === 'terminal'
    const asset = assetOf(isVideo && !isTerminal ? ASSETS[0]!.name : state.source)

    const setSource = async (name: string) => {
      stopPlayer()
      frameNo = 0
      probedSig = undefined
      await update($, host, s => ({ ...s, source: name, playing: false }))
    }
    const setPath = async (path: Path | undefined) => {
      stopPlayer()
      frameNo = 0
      forced = path !== undefined
      imageNote = undefined
      probedSig = undefined
      await update($, host, s => {
        const { path: _old, ...rest } = s

        return { ...rest, playing: false, ...(path !== undefined ? { path } : {}) }
      })
    }

    const picker = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>source</Text>
        {[...ASSETS.map(a => ({ name: a.name, label: a.label })), ...(isTerminal ? [{ name: VIDEO, label: 'video' }] : [])].map(
          s => (
            <Button
              key={`src:${s.name}`}
              label={state.source === s.name ? `[${s.label}]` : s.label}
              onPress={() => setSource(s.name)}
            />
          ),
        )}
      </Box>
    )

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      let svg: string | undefined
      try {
        const text = String(await $.fs.read(`${$.plugin.root}/assets/${asset.name}.svg`))
        svg = text.length <= 131072 ? text : undefined
      } catch {
        svg = undefined
      }

      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Host render: {asset.label}</Text>
          {picker}
          <Text dimColor>
            This surface draws the SVG itself, as vectors (Svg element); no host program runs.
            {isVideo ? ' The video source is terminal only.' : ''}
          </Text>
          {svg === undefined ? (
            <Text color="red">asset unreadable or over 128k chars</Text>
          ) : (
            <Svg source={svg} alt={asset.label} width={Math.min(640, e.props.bodyColumns * 8)} />
          )}
        </Box>
      )
    }

    const path: Path = state.path ?? 'image'
    const room = { columns: e.props.bodyColumns, rows: Math.max(4, e.props.scroll.bodyRows - 6) }
    const { columns, rows } = fitCells(room.columns, room.rows, isVideo ? VIDEO_ASPECT : asset.aspect)
    const b = await ensure($, state.source, path, columns, rows)
    if (b.renderer !== undefined && state.renderer !== b.renderer) {
      const renderer = b.renderer
      $.clock.after(0, () => update($, host, s => ({ ...s, renderer })))
    }
    const { Raster, Image } = $.ui.resolve(e)
    const alt = `${asset.label} (rendered by ${b.renderer ?? 'none'}): this terminal cannot draw pictures`
    let picture
    if (b.error !== undefined) {
      picture = <Text color="red">render failed: {b.error}</Text>
    } else if (b.kind === 'raster' && b.cells !== undefined) {
      const cells = b.cells[isVideo ? frameNo : 0]!
      picture = <Raster key={KEY} columns={columns} rows={rows} cells={cells} />
    } else {
      const source = sourceOf(b, frameNo)
      if (source === undefined) picture = <Text color="red">no source</Text>
      else {
        picture = <Image key={KEY} source={source} columns={columns} rows={rows} alt={alt} />
        probe($, b)
      }
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text bold>Host render: {isVideo ? 'ffmpeg testsrc2' : asset.label}</Text>
          <Text dimColor>
            path {b.kind} {state.path === undefined ? '(auto)' : '(forced)'} / renderer {b.renderer ?? '-'} / {columns}x{rows} cells
          </Text>
        </Box>
        {picker}
        <Box flexDirection="row" gap={1}>
          <Text dimColor>show as</Text>
          <Button key="path:auto" label={state.path === undefined ? '[auto]' : 'auto'} onPress={() => setPath(undefined)} />
          <Button key="path:image" label={state.path === 'image' ? '[image]' : 'image'} onPress={() => setPath('image')} />
          <Button key="path:raster" label={state.path === 'raster' ? '[raster]' : 'raster'} onPress={() => setPath('raster')} />
          {isVideo ? (
            <Button
              key="play"
              label={state.playing === true ? 'pause' : 'play'}
              hotkey="p"
              onPress={async () => {
                const playing = state.playing !== true
                await update($, host, s => ({ ...s, playing }))
                if (playing) play($)
                else stopPlayer()
              }}
            />
          ) : undefined}
        </Box>
        <Text dimColor>{imageNote ?? (b.kind === 'image' ? 'Image: pixels via the kitty protocol, read from /dev/shm' : 'Raster: half-block cells decoded from magick rgb output')}</Text>
        {picture}
      </Box>
    )
  })
}
