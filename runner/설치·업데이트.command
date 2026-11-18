#!/bin/bash
# 실행기를 설치하거나 새 버전으로 바꿔요. 더블클릭하면 돼요.
# 시험용: --no-start (켜기·끄기 건너뜀)  --no-tools (yt-dlp·ffmpeg 확인 건너뜀)
# 바꿀 수 있는 환경변수: FIELDNOTE_INSTALL_DIR  FIELDNOTE_RUNNER_HOME  FIELDNOTE_RUNNER_DATA  FIELDNOTE_RUNNER_PORT

NO_START=0; NO_TOOLS=0
for a in "$@"; do case "$a" in --no-start) NO_START=1;; --no-tools) NO_TOOLS=1;; esac; done

SRC="$(cd "$(dirname "$0")" && pwd -P)"
HOME_ROOT="${FIELDNOTE_RUNNER_HOME:-$HOME/Desktop/유투브}"
DATA="${FIELDNOTE_RUNNER_DATA:-$HOME_ROOT/에피소드}"
TARGET="${FIELDNOTE_INSTALL_DIR:-$HOME_ROOT/실행기}"
PORT="${FIELDNOTE_RUNNER_PORT:-4777}"
BIN="$HOME/.local/bin"
STAMP="$(date +%Y%m%d-%H%M)"
FILES=(server.mjs steps.mjs util.mjs images.mjs test.mjs README.md "실행기 켜기.command")

say() { echo; echo "▶ $*"; }
finish() { echo; if [ -t 0 ]; then read -r -p "엔터를 누르면 닫혀요"; fi; exit "${1:-0}"; }

echo "===== 실행기 설치·업데이트 ====="

# a. node
say "node 확인"
NODE="$(command -v node || ls /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -1)"
if [ -z "$NODE" ]; then
  echo "node 가 없어요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 더블클릭하세요."
  finish 1
fi
echo "  $NODE 있어요"

# b, c. yt-dlp, ffmpeg
if [ "$NO_TOOLS" = 0 ]; then
  mkdir -p "$BIN"
  say "yt-dlp 확인"
  if [ -x "$BIN/yt-dlp" ]; then
    "$BIN/yt-dlp" -U >/dev/null 2>&1 || true
    echo "  있어요 (새 버전 확인 끝)"
  else
    echo "  없어서 내려받아요 (조금 걸려요)"
    if curl -fL --progress-bar -o "$BIN/yt-dlp.part" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"; then
      chmod +x "$BIN/yt-dlp.part"; mv "$BIN/yt-dlp.part" "$BIN/yt-dlp"
      echo "  설치했어요"
    else
      rm -f "$BIN/yt-dlp.part"
      echo "  내려받지 못했어요. 인터넷을 확인하고 다시 눌러 보세요. (영상 받기만 안 돼요)"
    fi
  fi

  say "ffmpeg 확인"
  if [ -x "$BIN/ffmpeg" ]; then
    echo "  있어요"
  else
    FF="$(command -v ffmpeg)"
    if [ -z "$FF" ] && command -v brew >/dev/null 2>&1; then
      echo "  없어서 brew 로 설치해요 (몇 분 걸려요)"
      brew install ffmpeg && FF="$(command -v ffmpeg)"
    fi
    if [ -n "$FF" ]; then
      ln -sf "$FF" "$BIN/ffmpeg"; echo "  연결했어요 ($FF)"
    else
      echo "  ffmpeg 를 설치하지 못했어요. 영상 만들기가 안 돼요."
      echo "  ① https://brew.sh 에서 Homebrew 를 설치하고 ② 이 파일을 다시 더블클릭하세요."
    fi
  fi
fi

# d. 켜져 있는 실행기
if [ "$NO_START" = 0 ]; then
  say "켜져 있는 실행기 확인"
  PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)"
  if [ -n "$PIDS" ]; then
    RUNNING="$(curl -s --max-time 3 "http://127.0.0.1:$PORT/status" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).episodes.some(e=>e.running)?"yes":"no")}catch{console.log("no")}})')"
    if [ "$RUNNING" = "yes" ]; then
      echo "  지금 작업이 돌고 있어요. 실행 중인 작업이 끝난 뒤 다시 누르세요."
      finish 1
    fi
    echo "  끄는 중"
    kill $PIDS 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 || break; sleep 0.5; done
  else
    echo "  꺼져 있어요"
  fi
fi

# e. 파일 넣기
say "파일 넣는 중 → $TARGET"
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd -P)"
if [ "$SRC" = "$TARGET" ]; then
  echo "  이미 이 폴더가 설치 폴더예요. 복사는 건너뛰어요."
else
  CHANGED=0
  for f in "${FILES[@]}"; do cmp -s "$SRC/$f" "$TARGET/$f" || CHANGED=1; done
  HAS_OLD="$(ls -A "$TARGET" 2>/dev/null | grep -v '^backup-' | head -1)"
  if [ "$CHANGED" = 1 ] && [ -n "$HAS_OLD" ]; then
    BK="$(dirname "$TARGET")/실행기-옛날-$STAMP"
    N=1; while [ -e "$BK" ]; do N=$((N+1)); BK="$(dirname "$TARGET")/실행기-옛날-$STAMP-$N"; done
    mkdir -p "$BK" && rsync -a --exclude 'backup-*' "$TARGET"/ "$BK"/
    echo "  옛 버전은 여기에 보관했어요: $BK"
  fi
  for f in "${FILES[@]}"; do cp -p "$SRC/$f" "$TARGET/$f"; done
  [ -e "$TARGET/styles.json" ] || cp -p "$SRC/styles.json" "$TARGET/styles.json"
  echo "  넣었어요 (내 그림체 styles.json 과 anthropic-key.txt 는 그대로 둬요)"
fi
chmod +x "$TARGET/실행기 켜기.command" "$TARGET/설치·업데이트.command" 2>/dev/null
[ "$SRC" = "$TARGET" ] || cp -p "$SRC/설치·업데이트.command" "$TARGET/설치·업데이트.command" 2>/dev/null
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null

# f. 폴더
say "작업 폴더 만들기"
mkdir -p "$DATA" "$HOME_ROOT/소리/BGM" "$HOME_ROOT/소리/시그니처"
echo "  에피소드: $DATA"

# g. 버전
REV="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null)"
VER="${REV:+$REV }$(date '+%Y-%m-%d %H:%M')"
echo "$VER" > "$TARGET/version.txt"
echo "  버전: $VER"

# h. 켜기
if [ "$NO_START" = 0 ]; then
  say "실행기 켜는 중"
  open "$TARGET/실행기 켜기.command"
  H=""
  for _ in $(seq 1 20); do
    H="$(curl -s --max-time 2 "http://127.0.0.1:$PORT/health")" && [ -n "$H" ] && break
    sleep 1
  done
  if echo "$H" | grep -q '"ok":true'; then
    echo "  $H"
    echo
    echo "다 됐어요. 새로 뜬 터미널 창은 닫지 마세요."
    echo "크롬이 \"로컬 네트워크 접근\"을 물으면 허용을 누르세요."
    echo "$H" | grep -q '"ffmpeg":true' || echo "※ ffmpeg 가 없어요. 위 안내대로 설치한 뒤 다시 눌러 보세요."
  else
    echo "  실행기가 아직 안 켜졌어요. 새로 뜬 터미널 창의 글을 확인해 보세요."
    finish 1
  fi
fi
finish 0
