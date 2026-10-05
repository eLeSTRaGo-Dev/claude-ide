// Pure form validation for the Forms pane.
export type Values = Record<string, string>
export type Errors = Record<string, string>
export type Strength = { score: number; label: 'weak' | 'ok' | 'strong' }

export const DEFAULTS: Values = { role: 'developer', plan: 'free' }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const validateName = (v: string | undefined): string | undefined => ((v ?? '').trim() === '' ? 'Name is required' : undefined)

export const validateEmail = (v: string | undefined): string | undefined => {
  const s = (v ?? '').trim()
  if (s === '') return 'Email is required'

  return EMAIL.test(s) ? undefined : 'Enter a valid email address'
}

export const validatePassword = (v: string | undefined): string | undefined => {
  const s = v ?? ''
  if (s === '') return 'Password is required'

  return s.length >= 8 ? undefined : 'Use at least 8 characters'
}

export const validateTerms = (v: string | undefined): string | undefined => (v === 'true' ? undefined : 'You must accept the terms')

/** Password strength: length plus character classes, 0..1. */
export function strength(pw: string): Strength {
  if (pw === '') return { score: 0, label: 'weak' }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length
  const score = Math.min(1, Math.min(pw.length, 12) / 12 * 0.6 + (classes / 4) * 0.4)
  const label = pw.length < 8 || score < 0.5 ? 'weak' : score < 0.8 ? 'ok' : 'strong'

  return { score, label }
}

const FIELDS: Record<string, (v: string | undefined) => string | undefined> = {
  name: validateName,
  email: validateEmail,
  password: validatePassword,
  terms: validateTerms,
}

/** Error of one field, undefined when valid or not validated. */
export const validateField = (key: string, values: Values): string | undefined => FIELDS[key]?.(values[key])

/** All errors; empty object = valid. */
export function validate(values: Values): Errors {
  const out: Errors = {}
  for (const key of Object.keys(FIELDS)) {
    const msg = validateField(key, values)
    if (msg !== undefined) out[key] = msg
  }

  return out
}
