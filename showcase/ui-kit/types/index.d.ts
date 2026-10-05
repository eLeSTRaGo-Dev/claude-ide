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
    }
  }
}
