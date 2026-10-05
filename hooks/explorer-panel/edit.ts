import { assemble } from './editor'
import type { Keymap } from './editor'

// Pure helpers of the Edit section's hook side: draft file names and the
// assembly of chunked messages from the editor client.

// FNV-1a, two seeds: 16 hex digits name a draft without a path in the file name.
const fnv = (text: string, seed: number): string => {
  let h = seed
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return h.toString(16).padStart(8, '0')
}

export const hashPath = (path: string): string =>
  fnv(path, 0x811c9dc5) + fnv(path, 0x01234567)

export const DRAFT_DIR = '.claude/ide-panes/drafts'

export const draftFile = (home: string, path: string): string =>
  `${home.replace(/\/$/, '')}/${DRAFT_DIR}/${hashPath(path)}.txt`

// Props of the editor client (editor-client.tsx), built by the hook.
export type EditorProps = {
  path: string
  language: string // '' when none (no comment prefix)
  color: string
  keymap: Keymap
  rows: number // the region's rows and columns as the hook laid them out
  columns: number
  version: number // a new one drops the buffer and loads again
  chunk: string // the text's chunk `index` of `total`; '' when none
  index: number // -1: nothing sent yet; `total`: all delivered
  total: number
  isDraft: boolean // the text is a draft: dirty from the start
  ack: string // id of the last message the hook took
  saved: number // seq of the last save the hook wrote
  command: string // a border Button's action, applied once per `commandSeq`
  commandSeq: number
  by: number // rows for `command: 'scroll'`
}

// Chunk size both ways: under the 100,000-char bound of props and posts,
// with room for JSON escapes and the other fields.
export const TRANSFER_CHUNK = 80_000

// One chunk of a text the client sends: a draft or a save.
export type ChunkMsg = {
  kind: 'draft' | 'save'
  version: number
  seq: number
  index: number
  total: number
  chunk: string
  force?: boolean // a save that overwrites a file changed on disk
}

export const parseChunk = (data: unknown): ChunkMsg | undefined => {
  const d = data as Partial<Record<keyof ChunkMsg, unknown>> | null
  if (d === null || typeof d !== 'object') return undefined
  const { kind, version, seq, index, total, chunk, force } = d
  if (kind !== 'draft' && kind !== 'save') return undefined
  if (typeof version !== 'number' || typeof seq !== 'number') return undefined
  if (typeof index !== 'number' || typeof total !== 'number') return undefined
  if (typeof chunk !== 'string') return undefined
  if (!Number.isInteger(index) || !Number.isInteger(total)) return undefined
  if (total < 1 || total > 64 || index < 0 || index >= total) return undefined

  return { kind, version, seq, index, total, chunk, ...(force === true ? { force: true } : {}) }
}

// The text being collected for one (kind, version, seq).
export type Incoming = {
  kind: ChunkMsg['kind']
  version: number
  seq: number
  parts: (string | undefined)[]
  // Set once the text was handed out, so a repeated last chunk does not
  // trigger the write again.
  isDone: boolean
}

// Adds a chunk; `text` is set only by the chunk that completes the text.
export const accept = (
  current: Incoming | undefined,
  msg: ChunkMsg,
): { incoming: Incoming; text?: string } => {
  const same =
    current !== undefined &&
    current.kind === msg.kind &&
    current.version === msg.version &&
    current.seq === msg.seq &&
    current.parts.length === msg.total
  const incoming: Incoming = same
    ? current
    : {
        kind: msg.kind,
        version: msg.version,
        seq: msg.seq,
        parts: Array.from({ length: msg.total }, () => undefined),
        isDone: false,
      }
  incoming.parts[msg.index] = msg.chunk
  if (incoming.isDone) return { incoming }
  const text = assemble(incoming.parts)
  if (text === undefined) return { incoming }
  incoming.isDone = true

  return { incoming, text }
}
