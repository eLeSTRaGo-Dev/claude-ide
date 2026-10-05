// Headless Chromium -> raw rgb frames in /dev/shm, driven by JSON commands.
//
//   deno run -A bridge/browser.ts --url file:///.../web/demo.html --size 1280x720 [--cmd FILE] [--fps 24]
//
// stdout, one JSON object per line:
//   { "frame": "/dev/shm/uik-web-<pid>-<slot>.rgb", "width", "height", "n" }
//   { "status": "starting" | "ready" | "error", "message"?: string }
//   { "url": "<current page url>" }
// Commands (JSON per line on stdin, and/or a command file the mod rewrites,
// `{ "seq": n, "cmd": {...} }[]` as a JSON array, polled every 25 ms; each seq runs once):
//   { "mouse": { type: "down"|"up"|"move", x, y, button? } }  page pixels
//   { "key": { key, ctrl?, shift?, meta? } }   { "scroll": dy }   { "goto": url }
//   { "back": true }  { "reload": true }  { "resize": [w, h] }  { "quit": true }
// The command file exists because $.process.spawn's `input` is one string, then closed.

import { keyParams, mouseParams } from './keys.ts'
import type { KeyEvent, MouseCmd } from './keys.ts'

const args = new Map<string, string>()
for (let i = 0; i < Deno.args.length; i += 2) args.set(Deno.args[i]!.replace(/^--/, ''), Deno.args[i + 1] ?? '')

const here = new URL('.', import.meta.url)
const DEMO = new URL('../web/demo.html', here).href
const url0 = args.get('url') ?? DEMO
const [W0, H0] = (args.get('size') ?? '1280x720').split('x').map(Number) as [number, number]
const FPS = Math.max(1, Math.min(60, Number(args.get('fps') ?? 24)))
const CMD_FILE = args.get('cmd')
// First existing of: $CHROMIUM, system Chromium/Chrome, puppeteer's cached headless shell.
const findBrowser = (): string | undefined => {
  const home = Deno.env.get('HOME') ?? ''
  const cached: string[] = []
  try {
    for (const v of Deno.readDirSync(`${home}/.cache/puppeteer/chrome-headless-shell`)) {
      cached.push(`${home}/.cache/puppeteer/chrome-headless-shell/${v.name}/chrome-headless-shell-linux64/chrome-headless-shell`)
    }
  } catch { /* none */ }
  const env = Deno.env.get('CHROMIUM')
  const all = [...(env ? [env] : []), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', ...cached.sort().reverse()]
  return all.find(p => { try { return Deno.statSync(p).isFile } catch { return false } })
}
const CHROMIUM = findBrowser() ?? '/usr/bin/chromium'
const SLOTS = 3
const pid = Deno.pid

const enc = new TextEncoder()
const out = (o: unknown) => Deno.stdout.writeSync(enc.encode(JSON.stringify(o) + '\n'))
const slotPath = (slot: number) => `/dev/shm/uik-web-${pid}-${slot}.rgb`

const cleanup = () => {
  for (let s = 0; s < SLOTS; s++) {
    for (const p of [slotPath(s), slotPath(s) + '.tmp']) {
      try { Deno.removeSync(p) } catch { /* gone */ }
    }
  }
}

let browser: { close: () => Promise<void> } | undefined
let quitting = false
const quit = async (code = 0): Promise<never> => {
  quitting = true // frames arriving while the browser closes are dropped
  cleanup()
  try { await Promise.race([browser?.close(), new Promise(r => setTimeout(r, 1500))]) } catch { /* ignore */ }
  cleanup()
  Deno.exit(code)
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  try { Deno.addSignalListener(sig, () => void quit(0)) } catch { /* unsupported signal */ }
}

out({ status: 'starting' })
try {
  if (!Deno.statSync(CHROMIUM).isFile) throw new Error()
} catch {
  out({ status: 'error', message: 'chromium not found (tried $CHROMIUM, chromium, google-chrome, puppeteer cache): install it (sudo pacman -S chromium) or set CHROMIUM' })
  Deno.exit(2)
}

const { default: puppeteer } = await import('npm:puppeteer-core@23')
const { decode } = await import('npm:fast-png@6')

let width = W0
let height = H0
const b = await puppeteer.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files'],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
})
browser = b
const page = await b.newPage()
await page.setViewport({ width, height, deviceScaleFactor: 1 })
const cdp = await page.createCDPSession()

// ---- frames: screencast -> decode -> rgb file, throttled to FPS, only on change.
let n = 0
let lastSent = 0
let pending: Uint8Array | undefined
let timer: ReturnType<typeof setTimeout> | undefined

const rgbOf = (png: Uint8Array) => {
  const img = decode(png)
  const ch = img.channels
  const src = img.data as Uint8Array | Uint16Array
  const rgb = new Uint8Array(img.width * img.height * 3)
  for (let i = 0, j = 0; i < img.width * img.height; i++, j += 3) {
    rgb[j] = Number(src[i * ch]); rgb[j + 1] = Number(src[i * ch + 1]); rgb[j + 2] = Number(src[i * ch + 2])
  }

  return { rgb, w: img.width, h: img.height }
}

const flush = () => {
  timer = undefined
  const png = pending
  pending = undefined
  if (png === undefined || quitting) return
  lastSent = Date.now()
  try {
    const { rgb, w, h } = rgbOf(png)
    const slot = n % SLOTS
    const p = slotPath(slot)
    Deno.writeFileSync(p + '.tmp', rgb)
    Deno.renameSync(p + '.tmp', p) // atomic: the reader never sees half a frame
    n++
    out({ frame: p, width: w, height: h, n })
  } catch (error) {
    out({ status: 'error', message: `frame: ${error}` })
  }
}

cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
  pending = Uint8Array.from(atob(f.data), c => c.charCodeAt(0))
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  if (timer === undefined) timer = setTimeout(flush, Math.max(0, 1000 / FPS - (Date.now() - lastSent)))
})

const startCast = () => cdp.send('Page.startScreencast', { format: 'png', maxWidth: width, maxHeight: height, everyNthFrame: 1 })
const restartCast = async () => {
  await cdp.send('Page.stopScreencast').catch(() => {})
  await startCast()
}

page.on('framenavigated', f => { if (f === page.mainFrame()) out({ url: f.url() }) })

// ---- commands
const held = { value: 'none' as 'none' | 'left' | 'middle' | 'right' }
let mouseAt = { x: 0, y: 0 }

type Cmd = {
  mouse?: MouseCmd
  key?: KeyEvent
  scroll?: number
  goto?: string
  back?: boolean
  reload?: boolean
  resize?: [number, number]
  quit?: boolean
}

async function run(c: Cmd): Promise<void> {
  if (c.mouse !== undefined) {
    mouseAt = { x: c.mouse.x, y: c.mouse.y }
    await cdp.send('Input.dispatchMouseEvent', mouseParams(c.mouse, held) as never)
  } else if (c.key !== undefined) {
    const k = keyParams(c.key)
    await cdp.send('Input.dispatchKeyEvent', k.down as never)
    await cdp.send('Input.dispatchKeyEvent', k.up as never)
  } else if (c.scroll !== undefined) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mouseAt.x, y: mouseAt.y, deltaX: 0, deltaY: c.scroll } as never)
  } else if (c.goto !== undefined) {
    await page.goto(c.goto).catch(e => out({ status: 'error', message: `goto: ${e}` }))
  } else if (c.back === true) {
    await page.goBack().catch(() => {})
  } else if (c.reload === true) {
    await page.reload().catch(() => {})
  } else if (c.resize !== undefined) {
    const [w, h] = c.resize
    if (w >= 64 && h >= 64 && w <= 2048 && h <= 2048 && (w !== width || h !== height)) {
      width = w; height = h
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      await restartCast()
    }
  } else if (c.quit === true) {
    await quit(0)
  }
}

let chain: Promise<void> = Promise.resolve()
const enqueue = (c: Cmd) => { chain = chain.then(() => run(c)).catch(e => { out({ status: 'error', message: String(e) }) }) }

// stdin lines
void (async () => {
  const dec = new TextDecoder()
  let buf = ''
  try {
    for await (const chunk of Deno.stdin.readable) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line !== '') try { enqueue(JSON.parse(line)) } catch { /* not json */ }
      }
    }
  } catch { /* closed */ }
})()

// command file
if (CMD_FILE !== undefined) {
  let seen = 0
  setInterval(() => {
    let list: { seq: number; cmd: Cmd }[]
    try { list = JSON.parse(Deno.readTextFileSync(CMD_FILE)) } catch { return }
    if (!Array.isArray(list)) return
    for (const item of list) if (item.seq > seen) { seen = item.seq; enqueue(item.cmd) }
  }, 25)
}

await page.goto(url0).catch(e => out({ status: 'error', message: `goto: ${e}` }))
await startCast()
out({ status: 'ready', message: `${width}x${height}` })
await new Promise(() => {}) // run until a signal or a quit command
