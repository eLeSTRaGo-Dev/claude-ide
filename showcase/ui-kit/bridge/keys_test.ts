import { keyParams, mouseParams, modifiers } from './keys.ts'

const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
}

Deno.test('keys', () => {
  eq(modifiers({ key: 'a', ctrl: true, shift: true }), 10, 'mods')
  const a = keyParams({ key: 'a' })
  eq(a.down.type, 'keyDown', 'char down')
  eq(a.down.text, 'a', 'char text')
  eq(a.down.code, 'KeyA', 'code')
  eq(keyParams({ key: 'return' }).down.text, '\r', 'enter text')
  eq(keyParams({ key: 'up' }).down.type, 'rawKeyDown', 'arrow raw')
  eq(keyParams({ key: 'a', ctrl: true }).down.type, 'rawKeyDown', 'ctrl raw')
})

Deno.test('mouse', () => {
  const held = { value: 'none' as 'none' | 'left' | 'middle' | 'right' }
  const d = mouseParams({ type: 'down', x: 10.4, y: 5, button: 'left' }, held)
  eq([d.type, d.x, d.buttons], ['mousePressed', 10, 1], 'down')
  eq(mouseParams({ type: 'move', x: 1, y: 1 }, held).button, 'left', 'drag move')
  const u = mouseParams({ type: 'up', x: 1, y: 1, button: 'left' }, held)
  eq([u.type, u.buttons, held.value], ['mouseReleased', 0, 'none'], 'up')
  eq(mouseParams({ type: 'move', x: 1, y: 1 }, held).button, 'none', 'hover move')
})
