# gfx-gallery

Showcase mod: what Claude Code's render surfaces can draw beyond Box/Text.

```sh
claude --plugin-dir showcase/gfx-gallery   # then /gfx
```

| Pane | Terminal | Desktop / vscode / mobile |
|---|---|---|
| Plasma | `Raster` animated by `$.ui.blit` at ~30 fps; half / quad / braille encoders | animated `Svg` (SMIL) |
| Charts | git contribution heat map, braille line chart, eighth-block bars (`Raster`) | `Svg` with hover tooltips |
| Mandelbrot | `Raster` + invisible `Client` overlay: click zoom, right-click out, drag pan | `Svg` (+ `Client` on desktop) |
| Host render | `rsvg-convert` / `magick` / `ffmpeg` on the host → `Image` (kitty protocol: kitty, Ghostty) or `Raster` fallback | `Svg` asset |

- Encoders (`hooks/shared/raster.ts`): half block 1x2 px per cell truecolor, quadrant 2x2, braille 2x4. Raster takes BMP glyphs only, so no sextants.
- `Image` needs a kitty-graphics terminal; gnome-terminal (VTE) shows its alt, so Host render falls back to `Raster`.
- Types: copy `../../.claude-plugin/types` here (or load the mod once); `tsc -p showcase/gfx-gallery`.
