#!/usr/bin/env bash
# run.sh 로 띄운 서버를 중지한다. 윈도우(Git Bash)에서는 자식 node 프로세스까지 함께 종료한다.
set -uo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
PID_FILE="infra/server.pid"
LOG_DIR="infra/logs"

is_windows() {
  case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) return 0 ;; *) return 1 ;; esac
}

kill_tree() {
  local pid="$1"
  if is_windows; then
    # Git Bash 의 PID 를 윈도우 PID 로 바꿔 프로세스 트리 전체를 종료
    local winpid
    winpid="$(cat "/proc/$pid/winpid" 2>/dev/null || echo "$pid")"
    taskkill //F //T //PID "$winpid" > /dev/null 2>&1
  else
    pkill -TERM -P "$pid" 2> /dev/null
    kill -TERM "$pid" 2> /dev/null
  fi
}

stopped=0
if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2> /dev/null; then
    kill_tree "$pid" && stopped=1
  fi
  rm -f "$PID_FILE"
fi

# PID 파일이 없거나 자식 프로세스가 남았을 때를 대비해 포트를 쓰는 프로세스도 정리
if is_windows; then
  for p in $(netstat -ano | grep ":$PORT " | grep LISTENING | awk '{print $5}' | sort -u); do
    taskkill //F //T //PID "$p" > /dev/null 2>&1 && stopped=1
  done
else
  for p in $(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2> /dev/null); do
    kill -TERM "$p" 2> /dev/null && stopped=1
  done
fi

if [ "$stopped" = 1 ]; then
  mkdir -p "$LOG_DIR"
  echo "===== [$(date '+%Y-%m-%d %H:%M:%S')] stopped =====" >> "$LOG_DIR/output.log"
  echo "서버를 중지했습니다."
else
  echo "실행 중인 서버가 없습니다."
fi
