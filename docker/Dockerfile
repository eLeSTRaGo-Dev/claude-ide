FROM node:22-bookworm-slim

ARG UID=1000
ARG GID=1000
ARG USER=dev
ARG HOME=/home/dev

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl less procps \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g typescript \
 && (userdel -r node 2>/dev/null || true) && (groupdel node 2>/dev/null || true) \
 && groupadd -g $GID $USER \
 && useradd -m -d $HOME -u $UID -g $GID -s /bin/bash $USER \
 && mkdir -p $HOME/.claude && chown -R $UID:$GID $HOME

USER $USER
ENV HOME=$HOME
