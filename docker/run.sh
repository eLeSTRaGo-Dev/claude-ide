#!/usr/bin/env bash
# Run Claude Code with --dangerously-skip-permissions inside a container.
# Only the project dir is writable from the host; auth lives in a docker volume.
# From the host ~/.claude only skills, agents and commands are mounted, read-only
# at their host paths (so symlinked skills resolve). Everything else in the
# sandbox's ~/.claude (login, settings, plugins) lives in its own docker volume.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE=claude-ide-sandbox
CLAUDE_BIN="$(readlink -f "$(command -v claude)")"
CONF="$HOME/.claude"

docker build -q -t "$IMAGE" \
  --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" \
  --build-arg USER="$(id -un)" --build-arg HOME="$HOME" \
  "$PROJECT/docker" >/dev/null

docker volume create claude-ide-home >/dev/null

if [ $# -eq 0 ]; then set -- claude --dangerously-skip-permissions --plugin-dir .; fi

MOUNTS=()
ro() { [ -e "$1" ] && MOUNTS+=(-v "$1:$1:ro"); return 0; }
# Skills etc. one by one, skipping `synced` (claude.ai account skills, which the
# sandbox login syncs itself; mounting them too lists each twice).
for dir in skills agents commands; do
  for entry in "$CONF/$dir"/*; do
    [ -e "$entry" ] && [ "$(basename "$entry")" != synced ] || continue
    ro "$entry"
    # A symlink points outside ~/.claude: mount its target too.
    [ -L "$entry" ] && ro "$(readlink -f "$entry")"
  done
done

TTY=(-i); [ -t 0 ] && TTY=(-it)

exec docker run --rm "${TTY[@]}" \
  --name "claude-ide-$$" \
  -v claude-ide-home:"$CONF" \
  "${MOUNTS[@]}" \
  -v "$CLAUDE_BIN":/usr/local/bin/claude:ro \
  -v "$HOME/.gitconfig":"$HOME/.gitconfig":ro \
  -v "$PROJECT":"$PROJECT" \
  -w "$PROJECT" \
  -e TERM -e COLORTERM -e CLAUDE_CONFIG_DIR="$CONF" \
  "$IMAGE" \
  "$@"
