# claude-ide

IDE-like panes inside Claude Code (plugin `ide-panes`).

## Run

```sh
claude --plugin-dir <path-to-this-repo>
```

## Commands

- `/ide-panels`: opens the Explorer (project tree and file preview; `m` switches files/Unity mode) and Git (branches, commit graph, diffs, fetch/pull) panes as tabs, explorer in front. The current branch shows in the status line.

Pane keys: `r` refresh, `m` mode (explorer), `a` all branches (git).
