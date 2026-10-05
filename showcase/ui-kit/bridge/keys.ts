// Pure: the mod's key events and mouse commands as CDP Input.* parameters.
// Run with Deno; no imports so `deno test` and `deno check` need nothing.

export type KeyEvent = { key: string; ctrl?: boolean; shift?: boolean; meta?: boolean }

// name -> [DOM key, DOM code, windowsVirtualKeyCode]
const SPECIAL: Record<string, [string, string, number]> = {
  return: ['Enter', 'Enter', 13],
  enter: ['Enter', 'Enter', 13],
  tab: ['Tab', 'Tab', 9],
  backspace: ['Backspace', 'Backspace', 8],
  delete: ['Delete', 'Delete', 46],
  escape: ['Escape', 'Escape', 27],
  up: ['ArrowUp', 'ArrowUp', 38],
  down: ['ArrowDown', 'ArrowDown', 40],
  left: ['ArrowLeft', 'ArrowLeft', 37],
  right: ['ArrowRight', 'ArrowRight', 39],
  pageup: ['PageUp', 'PageUp', 33],
  pagedown: ['PageDown', 'PageDown', 34],
  home: ['Home', 'Home', 36],
  end: ['End', 'End', 35],
  space: [' ', 'Space', 32],
}

export const modifiers = (e: KeyEvent): number =>
  (e.meta ? 4 : 0) | (e.ctrl ? 2 : 0) | (e.shift ? 8 : 0)

/** The Input.dispatchKeyEvent params for a down/up pair of one key. */
export function keyParams(e: KeyEvent): { down: Record<string, unknown>; up: Record<string, unknown> } {
  const mods = modifiers(e)
  const special = SPECIAL[e.key.toLowerCase()]
  if (special !== undefined) {
    const [key, code, vk] = special
    const text = key === ' ' ? ' ' : key === 'Enter' ? '\r' : undefined
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods }

    return {
      down: { type: text !== undefined && mods === 0 ? 'keyDown' : 'rawKeyDown', ...base, ...(text !== undefined && mods === 0 ? { text } : {}) },
      up: { type: 'keyUp', ...base },
    }
  }
  const ch = [...e.key][0] ?? ''
  const upper = ch.toUpperCase()
  const vk = /^[a-z0-9]$/i.test(ch) ? upper.charCodeAt(0) : 0
  const base = { key: ch, code: /^[a-z]$/i.test(ch) ? `Key${upper}` : /^[0-9]$/.test(ch) ? `Digit${ch}` : '', windowsVirtualKeyCode: vk, modifiers: mods }
  const typed = mods === 0 || mods === 8

  return {
    down: { type: typed ? 'keyDown' : 'rawKeyDown', ...base, ...(typed ? { text: ch } : {}) },
    up: { type: 'keyUp', ...base },
  }
}

export type MouseCmd = { type: 'down' | 'up' | 'move'; x: number; y: number; button?: 'left' | 'middle' | 'right' }

/** The Input.dispatchMouseEvent params for a mouse command. */
export function mouseParams(m: MouseCmd, held: { value: 'none' | 'left' | 'middle' | 'right' }): Record<string, unknown> {
  const button = m.button ?? 'left'
  if (m.type === 'down') held.value = button
  const params = {
    type: m.type === 'down' ? 'mousePressed' : m.type === 'up' ? 'mouseReleased' : 'mouseMoved',
    x: Math.round(m.x),
    y: Math.round(m.y),
    button: m.type === 'move' ? held.value : button,
    buttons: m.type === 'up' ? 0 : held.value === 'left' ? 1 : held.value === 'right' ? 2 : held.value === 'middle' ? 4 : 0,
    clickCount: m.type === 'move' ? 0 : 1,
  }
  if (m.type === 'up') held.value = 'none'

  return params
}
