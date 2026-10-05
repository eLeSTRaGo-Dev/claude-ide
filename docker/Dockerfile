FROM node:22-bookworm-slim

ARG UID=1000
ARG GID=1000
ARG USER=dev

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl less procps \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g typescript \
 && (userdel -r node 2>/dev/null || true) && (groupdel node 2>/dev/null || true) \
 && groupadd -g $GID $USER \
 && useradd -m -u $UID -g $GID -s /bin/bash $USER \
 && mkdir -p /home/$USER/.claude && chown -R $UID:$GID /home/$USER

USER $USER
ENV HOME=/home/$USER
