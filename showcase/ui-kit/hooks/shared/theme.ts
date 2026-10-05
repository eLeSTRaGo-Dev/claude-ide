import type { ThemeName } from '../../types'

// Design tokens, shadcn/ui-like: neutral surfaces, one accent.
export type Theme = {
  name: ThemeName
  bg: string // pane background
  surface: string // cards, inputs
  surfaceHover: string
  border: string
  borderStrong: string
  text: string
  muted: string // secondary text
  accent: string // primary actions
  accentText: string // text on accent
  accentHover: string
  danger: string
  success: string
  warning: string
  info: string
  focus: string // focus ring / active border
}

export const THEMES: Record<ThemeName, Theme> = {
  // Raw hex everywhere; `claude` mimics Claude Code's default dark palette.
  claude: {
    name: 'claude',
    bg: '#1f1e1d',
    surface: '#2a2927',
    surfaceHover: '#363431',
    border: '#3d3b38',
    borderStrong: '#5c5954',
    text: '#ececec',
    muted: '#9b978f',
    accent: '#d97757',
    accentText: '#1f1e1d',
    accentHover: '#e8906f',
    danger: '#e5484d',
    success: '#4cc38a',
    warning: '#f5a524',
    info: '#5b9cf5',
    focus: '#d97757',
  },
  dark: {
    name: 'dark',
    bg: '#09090b',
    surface: '#18181b',
    surfaceHover: '#27272a',
    border: '#27272a',
    borderStrong: '#3f3f46',
    text: '#fafafa',
    muted: '#a1a1aa',
    accent: '#fafafa',
    accentText: '#18181b',
    accentHover: '#d4d4d8',
    danger: '#ef4444',
    success: '#22c55e',
    warning: '#eab308',
    info: '#3b82f6',
    focus: '#a1a1aa',
  },
  light: {
    name: 'light',
    bg: '#ffffff',
    surface: '#f4f4f5',
    surfaceHover: '#e4e4e7',
    border: '#e4e4e7',
    borderStrong: '#a1a1aa',
    text: '#09090b',
    muted: '#71717a',
    accent: '#18181b',
    accentText: '#fafafa',
    accentHover: '#3f3f46',
    danger: '#dc2626',
    success: '#16a34a',
    warning: '#ca8a04',
    info: '#2563eb',
    focus: '#18181b',
  },
  nord: {
    name: 'nord',
    bg: '#2e3440',
    surface: '#3b4252',
    surfaceHover: '#434c5e',
    border: '#4c566a',
    borderStrong: '#616e88',
    text: '#eceff4',
    muted: '#a3abbd',
    accent: '#88c0d0',
    accentText: '#2e3440',
    accentHover: '#8fbcbb',
    danger: '#bf616a',
    success: '#a3be8c',
    warning: '#ebcb8b',
    info: '#81a1c1',
    focus: '#88c0d0',
  },
  dracula: {
    name: 'dracula',
    bg: '#282a36',
    surface: '#343746',
    surfaceHover: '#44475a',
    border: '#44475a',
    borderStrong: '#6272a4',
    text: '#f8f8f2',
    muted: '#a4a8c0',
    accent: '#bd93f9',
    accentText: '#282a36',
    accentHover: '#caa9fa',
    danger: '#ff5555',
    success: '#50fa7b',
    warning: '#f1fa8c',
    info: '#8be9fd',
    focus: '#ff79c6',
  },
  neon: {
    name: 'neon',
    bg: '#0b0221',
    surface: '#160a3a',
    surfaceHover: '#22104f',
    border: '#3b1d8f',
    borderStrong: '#7b2ff7',
    text: '#f0e9ff',
    muted: '#a993d6',
    accent: '#00f0ff',
    accentText: '#0b0221',
    accentHover: '#7df9ff',
    danger: '#ff2a6d',
    success: '#05ffa1',
    warning: '#ffe600',
    info: '#01cdfe',
    focus: '#ff2a6d',
  },
}

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

export const themeOf = (name: string | undefined): Theme =>
  THEMES[(name ?? 'claude') as ThemeName] ?? THEMES.claude
