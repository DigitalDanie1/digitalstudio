#!/bin/bash
# 실행기를 맥 로그인 때마다 자동으로 켜 두는 설정 (한 번만 더블클릭)
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
LABEL="com.digitalstudio.runner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/digitalstudio-runner.log"
pause() { read -r -p "엔터를 누르면 닫혀요"; }
find_bin() { command -v "$1" 2>/dev/null || ls "/opt/homebrew/bin/$1" "/usr/local/bin/$1" 2>/dev/null | head -1; }

echo "== 1. 필요한 프로그램 확인 =="
need=""
[ -z "$(find_bin node)" ] && need="$need node"
[ -x "$HOME/.local/bin/ffmpeg" ] || [ -n "$(find_bin ffmpeg)" ] || need="$need ffmpeg"
[ -x "$HOME/.local/bin/yt-dlp" ] || [ -n "$(find_bin yt-dlp)" ] || need="$need yt-dlp"
if [ -n "$need" ]; then
  BREW="$(find_bin brew)"
  if [ -z "$BREW" ]; then
    echo "Homebrew가 없어요. https://brew.sh 의 설치 명령을 터미널에 붙여 넣어 설치한 뒤, 이 파일을 다시 더블클릭하세요."
    echo "(필요한 것:$need)"; pause; exit 1
  fi
  echo "설치 중:$need  (몇 분 걸릴 수 있어요)"
  "$BREW" install $need || { echo "설치 실패"; pause; exit 1; }
fi
NODE="$(find_bin node)"
NODE_REAL="$(perl -MCwd -e 'print Cwd::abs_path(shift)' "$NODE")"
mkdir -p "$HOME/.local/bin"
for b in ffmpeg yt-dlp; do
  [ -x "$HOME/.local/bin/$b" ] || ln -sf "$(find_bin $b)" "$HOME/.local/bin/$b"
done
echo "node   : $("$NODE" -v)"
echo "ffmpeg : $("$HOME/.local/bin/ffmpeg" -version 2>/dev/null | head -1 | cut -c1-30)"
echo "yt-dlp : $("$HOME/.local/bin/yt-dlp" --version 2>/dev/null)"

echo "== 2. 이미 켜진 실행기 끄기 =="
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
pkill -f "node.*server.mjs" 2>/dev/null && sleep 1

echo "== 3. 자동 실행 등록 =="
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>ko_KR.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
: > "$LOG"
launchctl bootstrap "gui/$(id -u)" "$PLIST" || { echo "등록 실패"; pause; exit 1; }

echo "== 4. 확인 =="
ok=""
for i in $(seq 1 12); do
  sleep 1
  curl -s -o /dev/null -m 2 http://127.0.0.1:4777/health && { ok=1; break; }
done
if grep -q "EPERM\|Operation not permitted" "$LOG"; then
  echo ""
  echo "맥이 바탕화면 폴더 접근을 막았어요. 이렇게 허용해 주세요:"
  echo " 1) 지금 열리는 '전체 디스크 접근 권한' 화면에서 + 를 누르세요"
  echo " 2) Cmd+Shift+G 를 누르고 Cmd+V 로 아래 경로를 붙여 넣은 뒤 열기, 그리고 스위치를 켜세요"
  echo "    $NODE_REAL"
  echo " 3) 이 파일을 다시 더블클릭하세요"
  printf "%s" "$NODE_REAL" | pbcopy
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
elif [ -n "$ok" ]; then
  echo ""
  echo "끝났어요. 이제 크롬에서 작업판만 열면 돼요. 맥을 다시 켜도 자동으로 켜져요."
  echo "(문제가 생기면 로그: $LOG)"
else
  echo "실행기가 응답하지 않아요. 로그 마지막 줄:"
  tail -n 15 "$LOG"
fi
pause
