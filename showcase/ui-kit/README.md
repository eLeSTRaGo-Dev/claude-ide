# ui-kit

Showcase mod: web-like UI inside Claude Code panes, shadcn/ui-style, six themes.

```sh
claude --plugin-dir showcase/ui-kit   # then /ui-kit
```

| Pane | What it shows |
|---|---|
| Components | Button variants (primary, secondary, outline, ghost, danger, link, pill, icon), badges, chips, tabs, progress, alerts, cards, avatars, kbd |
| Forms | sign-up form: labeled Inputs, helper/error text, Select, radios, checkbox, switch, live password strength, validation |
| Overlays | in-pane modal (backdrop + shadow), dialog pane (`closeOnEscape`, `holdToasts`), `$.ui.ask`, dropdown menus (press and hover-revealed), tooltips, toasts |
| Widgets | `Client` widgets: sliders (single, range), animated toggle, hold-to-repeat stepper, star rating, HSV color picker, segmented control |
| Chrome | gradient/rounded/shadowed controls painted in a `Raster`, real Buttons positioned over the pixels |
| Web | headless Chrome renders `web/demo.html`; frames via `/dev/shm` to a keyed `Image` (kitty/Ghostty) or `Raster` fallback; clicks and keys forwarded |

- Shared library: `hooks/shared/ui.tsx` (pure, element table + theme in); tokens in `hooks/shared/theme.ts`.
- Terminal rule learned live: a Button paints its own cells, so a label is the Button's own label inside a Box with `backgroundColor` (inherited); fills are darkened (`onDefaultFg`) since a Button's label uses the terminal's default foreground. Colored glyphs sit in a Text beside the Button.
- Web needs Deno and a Chrome/Chromium (`$CHROMIUM`, `/usr/bin/chromium`, `google-chrome(-stable)` or puppeteer's cached headless shell). Standalone: `deno run -A bridge/browser.ts --size 800x500`. Commands reach the bridge through a polled file (`$.process.spawn` input is one-shot).
- Desktop draws native Buttons/Inputs, so styling shows mainly on the terminal.
