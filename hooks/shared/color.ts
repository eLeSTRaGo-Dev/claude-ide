// The session color `/color` sets, as the prompt bar draws it (256-color
// codes captured from the terminal); '' is the default prompt bar color.
const CODES: Record<string, number> = {
  '': 45,
  red: 198,
  blue: 45,
  green: 82,
  yellow: 226,
  purple: 171,
  orange: 208,
  pink: 213,
  cyan: 51,
}

export const isSessionColor = (name: string): boolean => name in CODES

// The border props of a pane section in the session color.
export const borderOf = (name: string) =>
  ({
    borderStyle: 'round',
    borderColor: `ansi256(${CODES[name] ?? CODES['']})`,
  }) as const

// `/color`'s answer: "Session color set to: green" or "... reset to default".
export const parseColorAnswer = (text: string): string | undefined => {
  if (/reset to default/.test(text)) return ''
  const found = /set to: ([a-z]+)/.exec(text)

  return found?.[1] !== undefined && isSessionColor(found[1]) ? found[1] : undefined
}

// The last `agentColor` in a transcript (`grep -h '"agentColor"'` output).
export const lastAgentColor = (stdout: string): string | undefined => {
  const all = [...stdout.matchAll(/"agentColor":"([a-z]*)"/g)]
  const name = all.at(-1)?.[1]
  if (name === undefined) return undefined

  return name === 'default' ? '' : isSessionColor(name) ? name : undefined
}
