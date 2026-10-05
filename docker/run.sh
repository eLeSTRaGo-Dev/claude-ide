#!/usr/bin/env bash
# Run Claude Code with --dangerously-skip-permissions inside a container.
# Only the project dir is writable from the host; auth lives in a docker volume.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE=claude-ide-sandbox
CLAUDE_BIN="$(readlink -f "$(command -v claude)")"

docker build -q -t "$IMAGE" \
  --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" \
  "$PROJECT/docker" >/dev/null

docker volume create claude-ide-home >/dev/null

if [ $# -eq 0 ]; then set -- claude --dangerously-skip-permissions --plugin-dir .; fi

TTY=(-i); [ -t 0 ] && TTY=(-it)

exec docker run --rm "${TTY[@]}" \
  --name "claude-ide-$$" \
  -v claude-ide-home:/home/dev/.claude \
  -v "$CLAUDE_BIN":/usr/local/bin/claude:ro \
  -v "$HOME/.claude/CLAUDE.md":/home/dev/.claude/CLAUDE.md:ro \
  -v "$HOME/.gitconfig":/home/dev/.gitconfig:ro \
  -v "$PROJECT":"$PROJECT" \
  -w "$PROJECT" \
  -e TERM -e COLORTERM -e CLAUDE_CONFIG_DIR=/home/dev/.claude \
  "$IMAGE" \
  "$@"
