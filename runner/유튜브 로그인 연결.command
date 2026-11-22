#!/bin/bash
# YouTube 가 "봇이 아닌지 확인 (Sign in to confirm you're not a bot)" 으로 영상 받기를 막을 때, 맥마다 한 번만 더블클릭.
# 이 맥 Chrome 의 YouTube 로그인으로 받도록 yt-dlp 설정(~/.config/yt-dlp/config)에 한 줄을 넣어요.
# 하는 일: deno 확인 -> 전체 디스크 접근 권한 안내(터미널·node) -> 시험 -> 성공하면 설정 저장
Y="$HOME/.local/bin/yt-dlp"; [ -x "$Y" ] || Y="$(command -v yt-dlp)"
URL="https://www.youtube.com/shorts/0NefWlIDafY"
CONF="$HOME/.config/yt-dlp/config"
pause() { read -r -p "$1 (엔터) "; }
echo "===== YouTube 로그인 연결 ====="
[ -n "$Y" ] || { echo "yt-dlp 가 없어요. 실행기 설치·업데이트.command 를 먼저 더블클릭하세요."; pause "닫기"; exit 1; }
"$Y" -U >/dev/null 2>&1

echo; echo "▶ deno 확인 (YouTube 받기에 필요)"
if command -v deno >/dev/null 2>&1 || [ -x /opt/homebrew/bin/deno ]; then echo "  있어요"
elif command -v brew >/dev/null 2>&1; then brew install deno
else echo "  없어요. https://brew.sh 로 Homebrew 를 깔고 다시 눌러 주세요."; fi

echo; echo "▶ 로그인 없이 받아지는지 시험"
if "$Y" --ignore-config --no-warnings --simulate -q "$URL" 2>/dev/null; then
  echo "  지금은 막히지 않았어요. 그래도 나중에 막히지 않게 로그인 연결을 이어서 해요."
fi

echo; echo "▶ 이 맥의 Chrome 에서 YouTube 에 로그인돼 있어야 해요."
PROFILE="${1:-Default}"
echo "  쓸 Chrome 프로필: $PROFILE  (다르면 chrome://version 의 프로필 경로 끝 이름을 이 파일 뒤에 붙여 실행)"

try() { "$Y" --ignore-config --cookies-from-browser "chrome:$PROFILE" --no-warnings --simulate -q "$URL"; }
echo; echo "▶ Chrome 로그인으로 시험 (키체인 창이 뜨면 맥 암호 넣고 '항상 허용')"
if ! try; then
  NODE="$(command -v node || ls /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -1)"
  NODE_REAL="$(perl -MCwd -e 'print Cwd::abs_path(shift)' "$NODE" 2>/dev/null)"
  echo
  echo "  맥이 Chrome 데이터를 못 읽게 막고 있어요. 전체 디스크 접근 권한을 켜야 해요."
  echo "  1) 지금 열리는 설정 창(Full Disk Access / 전체 디스크 접근 권한)에서 '터미널'을 켜요. 없으면 + 로 응용 프로그램 > 유틸리티 > 터미널 추가."
  echo "  2) 같이 열리는 Finder 창에 선택된 node 파일을 그 목록으로 끌어다 놓고 켜요. (실행기가 쓰는 프로그램: $NODE_REAL)"
  echo "  3) 이 터미널을 Cmd+Q 로 완전히 끄고, 이 파일을 다시 더블클릭해요."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
  [ -n "$NODE_REAL" ] && open -R "$NODE_REAL"
  pause "닫기"; exit 1
fi

mkdir -p "$(dirname "$CONF")"; touch "$CONF"
grep -v -- "--cookies-from-browser" "$CONF" > "$CONF.tmp"; echo "--cookies-from-browser chrome:$PROFILE" >> "$CONF.tmp"; mv "$CONF.tmp" "$CONF"
echo; echo "다 됐어요. 이 맥의 실행기는 이제 Chrome 로그인으로 영상을 받아요. ($CONF)"
pause "닫기"
