export type Encoder = 'half' | 'quad' | 'braille'

export type PlasmaState = {
  playing: boolean
  encoder: Encoder
  effect: 'plasma' | 'fire'
}

export type ChartsState = {
  weeks: number // contribution grid span; absent is 52
}

export type MandelState = {
  cx: number // view center, real part
  cy: number // view center, imaginary part
  scale: number // complex units per pixel column
  encoder: Encoder
}

export type HostState = {
  source: string // bundled asset name under assets/
  renderer?: 'rsvg' | 'magick' // the host engine that worked last
  path?: 'image' | 'raster' // how it is shown: kitty Image, or Raster fallback
  playing?: boolean // ffmpeg frames
}

declare module 'claude-code' {
  interface PluginState {
    'gfx-gallery': {
      plasma: PlasmaState
      charts: ChartsState
      mandel: MandelState
      host: HostState
    }
  }
}
