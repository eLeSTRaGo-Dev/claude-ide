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
  detailOffset: number // first diff line shown (Diff Preview)
  infoOffset?: number // first Info line shown
  collapsed?: string[] // branch folders closed (`l:fix`, `r:origin/team`)
  tab?: 'overview' | 'graph' | 'changelog' // the panel view; absent is `overview`. An old `'changes'` reads as `'changelog'`, any other unknown value as `overview`
  change?: string // path of the selected change
  changeOffset?: number // first change row shown
  changeView?: 'list' | 'tree' // absent is `list`
  changeCollapsed?: string[] // change folders closed (`c:src/ui`)
  diff?: string // sha open in the commit diff view; clearing it closes the view
  diffFile?: string // path of the selected file in the diff view
  split?: { side?: number; info?: number; files?: number } // dragged sizes as fractions: Branches' width, Info's height share (Overview), Files' width; absent is the default
  diffFileOffset?: number // first file row shown in the diff view
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
