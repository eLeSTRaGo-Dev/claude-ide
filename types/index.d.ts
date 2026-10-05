export type ExplorerState = {
  root: string
  mode: 'files' | 'unity'
  expanded: string[]
  selected?: string
  offset: number
  previewOffset: number // first preview line shown
}

export type GitState = {
  ref: string // 'all' or a branch name
  selected?: string // commit sha
  offset: number
  limit: number
  branchOffset: number // first branch row shown
  detailOffset: number // first diff line shown
}

declare module 'claude-code' {
  interface PluginState {
    'ide-panes': {
      explorer: ExplorerState
      git: GitState
      sessionColor: string // `/color` name; '' is the default
    }
  }
}
