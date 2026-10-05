export type ExplorerState = {
  root: string
  mode: 'files' | 'unity'
  expanded: string[]
  selected?: string // the file shown in the preview (Enter or click)
  cursor?: string // the row the arrows are on (the focus ring)
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
  collapsed?: string[] // branch folders closed (`l:fix`, `r:origin/team`)
  tab?: 'graph' | 'changes' // the middle section; absent is `graph`
  change?: string // path of the selected change
  changeOffset?: number // first change row shown
  changeView?: 'list' | 'tree' // absent is `list`
  changeCollapsed?: string[] // change folders closed (`c:src/ui`)
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
