export type ThemeName = 'claude' | 'dark' | 'light' | 'nord' | 'dracula' | 'neon'

export type KitState = {
  theme: ThemeName
}

export type ComponentsState = {
  tab?: string // the Tabs demo's selected tab
  progress?: number // 0..1, the animated progress demo
}

export type FormsState = {
  values: Record<string, string> // field key → value
  errors?: Record<string, string> // field key → message, set on submit
  submitted?: boolean
}

export type OverlaysState = {
  modal?: 'info' | 'delete' // the in-pane modal shown
  menu?: string // the open dropdown's key
}

export type WidgetsState = {
  values: Record<string, number | boolean | string> // widget key → value
}

export type ChromeState = {
  pressed?: string // the last pressed chrome button
}

export type WebState = {
  url: string // the page the bridge shows
  path?: 'image' | 'raster' // kitty Image, or Raster fallback
  status?: string // bridge status line
}

export type GitState = {
  ref: string // 'all' or a branch name
  selected?: string // commit sha
  offset: number
  limit: number
  branchOffset: number // first branch row shown
  detailOffset: number // first diff line shown (Diff Preview)
  infoOffset?: number // first Info line shown
  infoLeft?: number // first Info column shown (its horizontal bar); 0 when the shown commit changes
  detailLeft?: number // first Diff Preview column shown (its horizontal bar); 0 when the shown file or commit changes
  collapsed?: string[] // branch folders closed (`l:fix`, `r:origin/team`)
  tab?: 'overview' | 'graph' | 'changelog' // the panel view; absent is `overview`. An old `'changes'` reads as `'changelog'`, any other unknown value as `overview`
  change?: string // path of the selected change
  changeOffset?: number // first change row shown
  changeView?: 'list' | 'tree' // absent is `list`
  changeCollapsed?: string[] // change folders closed (`c:src/ui`)
  diff?: string // sha open in the commit diff view; clearing it closes the view
  diffFile?: string // path of the selected file in the diff view
  split?: { side?: number; info?: number; files?: number; graph?: number } // dragged sizes as fractions: Branches' width, Info's height share (Overview), Files' width, Info's height share (Graph); absent is the default
  diffFileOffset?: number // first file row shown in the diff view
}

declare module 'claude-code' {
  interface PluginState {
    'ui-kit': {
      kit: KitState
      components: ComponentsState
      forms: FormsState
      overlays: OverlaysState
      widgets: WidgetsState
      chrome: ChromeState
      web: WebState
      git: GitState
    }
  }
}
