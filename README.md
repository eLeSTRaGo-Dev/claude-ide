# claude-ide

IDE-like panes inside Claude Code (plugin `ide-panes`).

## Run

```sh
claude --plugin-dir <path-to-this-repo>
```

## Commands

- `/explorer [mode unity|files]`: project tree and file preview
- `/git`: branches, commit graph and diffs; current branch in the status line

Pane keys: `r` refresh, `m` mode (explorer), `a` all branches (git).
