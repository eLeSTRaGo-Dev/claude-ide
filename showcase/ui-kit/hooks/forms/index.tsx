import { atom, read, update } from 'claude-code'
import type { ElementTable, On } from 'claude-code'

import { THEMES } from '../shared/theme'
import { Alert, Btn, Card, Checkbox, Header, Page, Progress, RadioGroup, SelectField, Switch, TextField } from '../shared/ui'
import type { ThemeName } from '../../types'
import { DEFAULTS, strength, validate, validateField } from './validate'

const PANE = 'uik-forms'
// Declared per pane: the validator reads atoms from the file that uses them.
const kit = atom({ plugin: 'ui-kit', key: 'kit' } as const, { theme: 'claude' as ThemeName })
const forms = atom({ plugin: 'ui-kit', key: 'forms' } as const, { values: { ...DEFAULTS } as Record<string, string>, errors: undefined as Record<string, string> | undefined, submitted: false })

const ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'pm', label: 'PM' },
]
const PLANS = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'team', label: 'Team' },
]
const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ja', label: '日本語' },
]
const label = (opts: readonly { value: string; label: string }[], v: string | undefined) => opts.find(o => o.value === v)?.label ?? '-'

export function register(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const fel = el as unknown as ElementTable<'terminal'> // used only where hasInput
    const { Select } = fel
    const surface = e.surface
    const k = await read($, kit)
    const state = await read($, forms)
    const t = THEMES[k.theme]
    const cols = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    const values = state.values ?? {}
    const errors = state.errors
    const v = (key: string): string => values[key] ?? DEFAULTS[key] ?? ''
    const bool = (key: string) => v(key) === 'true'

    const set = (key: string, value: string) =>
      void update($, forms, s => {
        const next = { ...(s.values ?? {}), [key]: value }
        // After a failed submit an error clears live as soon as its field is fixed.
        const errs = s.errors !== undefined && s.errors[key] !== undefined ? { ...s.errors } : s.errors
        if (errs !== undefined && errs[key] !== undefined) {
          const msg = validateField(key, next)
          if (msg === undefined) delete errs[key]
          else errs[key] = msg
        }

        return { ...s, values: next, errors: errs, submitted: false }
      })
    const submit = () => {
      const errs = validate(values)
      const n = Object.keys(errs).length
      void update($, forms, s => ({ ...s, errors: errs, submitted: n === 0 }))
      void $.ui.toast(n === 0 ? `Account created for ${v('name').trim()}` : `Fix ${n} error${n === 1 ? '' : 's'} to continue`)
    }
    const reset = () => void update($, forms, () => ({ values: { ...DEFAULTS }, errors: undefined, submitted: false }))

    const hasInput = surface !== 'mobile'
    const two = cols >= 96
    const mainW = two ? Math.floor((cols - 2 - 2 - 1) * 0.6) : cols - 4
    const sideW = two ? cols - 2 - 2 - 1 - mainW : cols - 4
    const pw = v('password')
    const st = strength(pw)
    const stColor = st.label === 'weak' ? t.danger : st.label === 'ok' ? t.warning : t.success
    const err = (key: string) => errors?.[key]
    // Valid accent only for a filled field that passes.
    const ok = (key: string) => v(key) !== '' && validateField(key, values) === undefined

    const create = (
      <Box flexDirection="column" gap={1}>
        {hasInput ? (
          <>
            {TextField(fel, t, { key: 'name', label: 'Name', required: true, placeholder: 'Ada Lovelace', value: v('name'), helper: 'Your public display name.', error: err('name'), valid: ok('name'), onInput: x => set('name', x), surface })}
            {TextField(fel, t, { key: 'email', label: 'Email', required: true, placeholder: 'ada@example.com', value: v('email'), helper: 'We never share it.', error: err('email'), valid: ok('email'), onInput: x => set('email', x), surface })}
            {TextField(fel, t, { key: 'password', label: 'Password', required: true, placeholder: 'at least 8 characters', value: pw, helper: 'Input cannot mask: the echo below is masked.', error: err('password'), valid: ok('password'), onInput: x => set('password', x), surface })}
            <Box flexDirection="column">
              <Text color={t.muted}>echo  {'•'.repeat(pw.length) || '(empty)'}</Text>
              <Box key="strength" flexDirection="row" gap={1}>
                {Progress(el, t, { key: 'strength:bar', value: st.score, width: 20, color: stColor, showPercent: false })}
                <Text bold color={stColor}>{pw === '' ? '' : st.label}</Text>
              </Box>
            </Box>
            {SelectField(fel, t, { key: 'role', label: 'Role', value: v('role'), options: ROLES, onSelect: x => set('role', x) })}
          </>
        ) : null}
        <Box flexDirection="column">
          <Text bold color={t.text}>Plan</Text>
          {RadioGroup(el, t, { key: 'plan', options: PLANS, value: v('plan'), row: true, onChange: x => set('plan', x), surface })}
        </Box>
        <Box flexDirection="column">
          {Checkbox(el, t, { key: 'terms', label: 'Accept terms and conditions', checked: bool('terms'), error: err('terms') !== undefined, onChange: x => set('terms', String(x)), surface })}
          {err('terms') !== undefined ? <Text color={t.danger}>✕ {err('terms')}</Text> : null}
        </Box>
        {Switch(el, t, { key: 'newsletter', label: 'Send me the newsletter', on: bool('newsletter'), onChange: x => set('newsletter', String(x)), surface })}
        {state.submitted === true
          ? Alert(el, t, { key: 'success', tone: 'success', title: 'Account created', description: `Welcome, ${v('name').trim()} (${v('email').trim()}), ${label(PLANS, v('plan'))} plan.` })
          : errors !== undefined && Object.keys(errors).length > 0
            ? Alert(el, t, { key: 'failure', tone: 'destructive', title: 'Please fix the highlighted fields' })
            : null}
      </Box>
    )

    const summary = (
      <Box flexDirection="column">
        <Text color={t.muted}>This surface has no Input or Select: read-only summary.</Text>
        <Text color={t.text}>Name       {v('name') || '-'}</Text>
        <Text color={t.text}>Email      {v('email') || '-'}</Text>
        <Text color={t.text}>Password   {'•'.repeat(pw.length) || '-'}</Text>
        <Text color={t.text}>Role       {label(ROLES, v('role'))}</Text>
      </Box>
    )

    const row = (name: string, control: unknown) => (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={2}>
        <Text color={t.muted}>{name}</Text>
        {control as never}
      </Box>
    )

    return Page(
      el,
      t,
      <>
        {Header(el, t, { title: 'Forms', themeName: k.theme, surface, onTheme: name => void update($, kit, s => ({ ...s, theme: name })) })}
        <Box flexDirection={two ? 'row' : 'column'} gap={1} alignItems="flex-start">
          {Card(el, t, {
            key: 'card:create',
            title: 'Create account',
            description: 'Enter your details to get started.',
            width: mainW,
            children: hasInput ? create : <>{summary}{create}</>,
            footer: (
              <Box flexDirection="row" gap={1}>
                {Btn(el, t, { key: 'submit', label: 'Create account', variant: 'primary', size: 'sm', hotkey: 's', onPress: submit, surface })}
                {Btn(el, t, { key: 'reset', label: 'Reset', variant: 'ghost', size: 'sm', hotkey: 'r', onPress: reset, surface })}
              </Box>
            ),
          })}
          {Card(el, t, {
            key: 'card:settings',
            title: 'Settings',
            description: 'Inline fields: label left, control right.',
            width: sideW,
            children: (
              <Box flexDirection="column" gap={1}>
                {hasInput ? row('Language', <Select key="s:lang" options={LANGS} value={v('s:lang') || 'en'} onSelect={(x: string) => set('s:lang', x)} />) : row('Language', <Text color={t.text}>{label(LANGS, v('s:lang') || 'en')}</Text>)}
                {row('Notifications', Switch(el, t, { key: 's:notify', label: bool('s:notify') ? 'on' : 'off', on: bool('s:notify'), onChange: x => set('s:notify', String(x)), surface }))}
                {row('Compact mode', Switch(el, t, { key: 's:compact', label: bool('s:compact') ? 'on' : 'off', on: bool('s:compact'), onChange: x => set('s:compact', String(x)), surface }))}
              </Box>
            ),
          })}
        </Box>
      </>,
      rows,
    )
  })
}
