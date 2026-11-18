#!/bin/bash
cd "$(dirname "$0")" || exit 1
NODE="$(command -v node || ls /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -1)"
if [ -z "$NODE" ]; then echo "node 를 찾을 수 없어요. nodejs.org 에서 설치해 주세요."; read -r -p "엔터를 누르면 닫혀요"; exit 1; fi
echo "켜졌어요 · 이 창을 닫지 마세요   (끄려면 이 창에서 Ctrl+C)"
exec "$NODE" server.mjs
