import { expect, test } from 'claude-code/testing'

import { borderOf, lastAgentColor, parseColorAnswer } from './color'

test('borderOf maps session colors to the prompt bar codes', () => {
  expect(borderOf('green').borderColor).toBe('ansi256(82)')
  expect(borderOf('').borderColor).toBe('ansi256(45)')
  expect(borderOf('nope').borderColor).toBe('ansi256(45)')
})

test('parseColorAnswer reads /color answers', () => {
  expect(parseColorAnswer('Session color set to: orange')).toBe('orange')
  expect(parseColorAnswer('Session color reset to default')).toBe('')
  expect(parseColorAnswer('Unknown color')).toBeUndefined()
})

test('lastAgentColor takes the last entry of a transcript', () => {
  const out =
    '{"type":"agent-color","agentColor":"green","sessionId":"x"}\n' +
    '{"type":"agent-color","agentColor":"pink","sessionId":"x"}\n'
  expect(lastAgentColor(out)).toBe('pink')
  expect(lastAgentColor('')).toBeUndefined()
})
