# claude-ide

IDE-like panes inside Claude Code (plugin `ide-panes`).

## Run

```sh
claude --plugin-dir <path-to-this-repo>
```

## Commands

- `/ide-panels`: opens the Explorer (project tree and file preview; `f`/`u` switch files/Unity mode) and Git (branches, commit graph, diffs, fetch/pull) panes as tabs, explorer in front. The current branch shows in the status line.

Pane keys: `r` refresh, `f`/`u` mode (explorer), `s` Settings (both), `a` all branches (git).

Themes (claude, dark, light, nord, dracula, neon), editor keys and panel defaults live in the ⚙ Settings sheet (`s` in either pane).
