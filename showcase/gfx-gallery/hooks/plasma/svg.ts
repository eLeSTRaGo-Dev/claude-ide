// Animated SVG stand-ins for the Raster effects (desktop, vscode, mobile).
// Animation runs in the SVG itself (SMIL); `animated: false` draws it still.
import type { EffectKind } from './effects'

export const SVG_W = 640
export const SVG_H = 360

const BLOBS = [
  { c: '#ff2878', r: 150, x: [120, 480, 220, 120], y: [90, 240, 300, 90], dur: 11 },
  { c: '#ffbe3c', r: 130, x: [520, 160, 400, 520], y: [260, 100, 60, 260], dur: 13 },
  { c: '#3cdcc8', r: 140, x: [320, 540, 90, 320], y: [180, 70, 250, 180], dur: 17 },
  { c: '#2428d0', r: 170, x: [80, 300, 560, 80], y: [300, 120, 200, 300], dur: 19 },
  { c: '#9a1ee0', r: 120, x: [440, 100, 330, 440], y: [60, 200, 310, 60], dur: 15 },
]

const values = (xs: number[]): string => xs.join(';')

export function plasmaSvg(animated: boolean): string {
  const blobs = BLOBS.map((b, i) => {
    const move = animated
      ? `<animate attributeName="cx" values="${values(b.x)}" dur="${b.dur}s" repeatCount="indefinite"/>` +
        `<animate attributeName="cy" values="${values(b.y)}" dur="${b.dur}s" repeatCount="indefinite"/>` +
        `<animate attributeName="r" values="${b.r};${b.r * 1.35};${b.r}" dur="${b.dur / 2}s" repeatCount="indefinite"/>`
      : ''
    return `<circle cx="${b.x[0]}" cy="${b.y[0]}" r="${b.r}" fill="${b.c}" style="mix-blend-mode:screen">` +
      `<title>plasma blob ${i + 1}</title>${move}</circle>`
  }).join('')
  const hue = animated
    ? '<animate attributeName="values" values="0;360" dur="24s" repeatCount="indefinite"/>'
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">` +
    `<defs><filter id="p" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feGaussianBlur stdDeviation="38"/>` +
    `<feColorMatrix type="hueRotate" values="0">${hue}</feColorMatrix></filter></defs>` +
    `<rect width="${SVG_W}" height="${SVG_H}" fill="#14003c"/>` +
    `<g filter="url(#p)">${blobs}</g></svg>`
  )
}

export function fireSvg(animated: boolean): string {
  const n = 9
  const flames = Array.from({ length: n }, (_, i) => {
    const x = ((i + 0.5) * SVG_W) / n
    const h = 150 + ((i * 53) % 90)
    const dur = 0.9 + ((i * 37) % 7) / 10
    const sway = animated
      ? `<animate attributeName="ry" values="${h};${h * 1.4};${h * 0.8};${h}" dur="${dur}s" repeatCount="indefinite"/>` +
        `<animate attributeName="cx" values="${x};${x + 24};${x - 24};${x}" dur="${dur * 1.7}s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="0.9;0.6;1;0.9" dur="${dur * 0.8}s" repeatCount="indefinite"/>`
      : ''
    return `<ellipse cx="${x}" cy="${SVG_H}" rx="58" ry="${h}" fill="url(#f)"><title>flame ${i + 1}</title>${sway}</ellipse>`
  }).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">` +
    `<defs><linearGradient id="f" x1="0" y1="1" x2="0" y2="0">` +
    `<stop offset="0" stop-color="#ffffa0"/><stop offset="0.35" stop-color="#ffa000"/>` +
    `<stop offset="0.75" stop-color="#c81400" stop-opacity="0.8"/><stop offset="1" stop-color="#3c0000" stop-opacity="0"/>` +
    `</linearGradient><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs>` +
    `<rect width="${SVG_W}" height="${SVG_H}" fill="#050000"/>` +
    `<g filter="url(#b)" style="mix-blend-mode:screen">${flames}</g></svg>`
  )
}

export const svgFor = (kind: EffectKind, animated: boolean): string =>
  kind === 'fire' ? fireSvg(animated) : plasmaSvg(animated)
