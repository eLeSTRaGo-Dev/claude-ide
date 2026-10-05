import { expect, test } from 'claude-code/testing'

import { strength, validate, validateEmail, validatePassword } from './validate'

test('email', () => {
  expect(validateEmail('')).toBeDefined()
  expect(validateEmail('nope')).toBeDefined()
  expect(validateEmail('a@b')).toBeDefined()
  expect(validateEmail('ada@example.com')).toBeUndefined()
})

test('password', () => {
  expect(validatePassword('short')).toBeDefined()
  expect(validatePassword('longenough')).toBeUndefined()
})

test('strength labels', () => {
  expect(strength('').label).toBe('weak')
  expect(strength('abc').label).toBe('weak')
  expect(strength('abcdefgh').label).toBe('ok')
  expect(strength('Abcdef12').label).toBe('ok')
  expect(strength('Abcdef12!xyz').label).toBe('strong')
})

test('validate collects every error', () => {
  expect(Object.keys(validate({})).sort()).toEqual(['email', 'name', 'password', 'terms'])
  expect(validate({ name: 'Ada', email: 'ada@x.io', password: 'secret123', terms: 'true' })).toEqual({})
})
