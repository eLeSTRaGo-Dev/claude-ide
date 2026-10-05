export type ExplorerState = {
  root: string
  mode: 'files' | 'unity'
  expanded: string[]
  selected?: string
  offset: number
}

declare module 'claude-code' {
  interface PluginState {
    'ide-panes': { explorer: ExplorerState }
  }
}
