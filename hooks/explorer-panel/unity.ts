import { join } from './tree'

export type GuidIndex = ReadonlyMap<string, string>

export type Ref =
  | { kind: 'resolved'; guid: string; path: string }
  | { kind: 'builtin'; guid: string }
  | { kind: 'unresolved'; guid: string }

// Extensions whose YAML text carries `guid:` references.
const REF_EXTENSIONS = [
  '.prefab',
  '.unity',
  '.asset',
  '.mat',
  '.controller',
  '.anim',
  '.overrideController',
]

export const hasRefs = (name: string): boolean =>
  REF_EXTENSIONS.some(ext => name.endsWith(ext))

const BUILTIN = /^0{16}[ef]0{15}$/
const GREP_LINE = /^(.+)\.meta:guid: ([0-9a-f]{32})\s*$/

// Parses `grep -r -m1 '^guid:'` output (`rel/path.meta:guid: <hex>` lines)
// into guid -> `root`-joined asset path. The first path wins a duplicate guid.
export const parseGrep = (stdout: string, root: string): Map<string, string> => {
  const index = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const found = GREP_LINE.exec(line)
    if (found === null) continue
    const [, rel, guid] = found
    if (rel !== undefined && guid !== undefined && !index.has(guid)) {
      index.set(guid, join(root, rel))
    }
  }

  return index
}

// The unique guids referenced by a Unity YAML file, in order of appearance.
export const refsOf = (yaml: string): string[] => {
  const seen = new Set<string>()
  for (const found of yaml.matchAll(/guid: ([0-9a-f]{32})/g)) {
    if (found[1] !== undefined) seen.add(found[1])
  }

  return [...seen]
}

export const classify = (guids: readonly string[], index: GuidIndex): Ref[] =>
  guids.map((guid): Ref => {
    if (BUILTIN.test(guid)) return { kind: 'builtin', guid }
    const path = index.get(guid)

    return path === undefined
      ? { kind: 'unresolved', guid }
      : { kind: 'resolved', guid, path }
  })

// Line 2 of a `.meta` file: `guid: <32 hex>`.
export const metaGuid = (text: string): string | undefined =>
  /^guid: ([0-9a-f]{32})\s*$/m.exec(text)?.[1]

// Bash commands that can move, add or remove `.meta` files.
export const isIndexCommand = (command: string): boolean =>
  /\b(git|mv|rm|cp|unity)\b/.test(command)
