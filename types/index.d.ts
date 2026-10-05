export type ExplorerState = {
  root: string
  mode: 'files' | 'unity'
  expanded: string[]
  selected?: string
  offset: number
}

export type GitState = {
  ref: string // 'all' or a branch name
  selected?: string // commit sha
  offset: number
  limit: number
}

declare module 'claude-code' {
  interface PluginState {
    'ide-panes': { explorer: ExplorerState; git: GitState }
  }
}
