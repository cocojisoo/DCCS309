#!/usr/bin/env bash
# 사용법: ./run.sh dev      개발 서버 (백그라운드, 기본 포트 3000)
#         ./run.sh start    프로덕션 빌드 후 실행 (백그라운드)
#         ./run.sh graph    OSM 도로망을 다시 받아 public/graph/*.json 재생성
# 로그: infra/logs/output.log (표준 출력), infra/logs/error.log (표준 에러)
# 윈도우에서는 Git Bash 에서 실행하세요.
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-dev}"
PORT="${PORT:-3000}"
LOG_DIR="infra/logs"
PID_FILE="infra/server.pid"
mkdir -p "$LOG_DIR"

log_header() {
  local msg="===== [$(date '+%Y-%m-%d %H:%M:%S')] $1 ====="
  echo "$msg" >> "$LOG_DIR/output.log"
  echo "$msg" >> "$LOG_DIR/error.log"
}

if [ "$MODE" = "graph" ]; then
  node scripts/build-graph.mjs --refresh
  exit 0
fi

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "이미 실행 중입니다 (PID $(cat "$PID_FILE")). 먼저 ./off.sh 로 중지하세요."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "의존성 설치 중 (npm install)…"
  npm install
fi

NEXT_BIN="node_modules/next/dist/bin/next"
case "$MODE" in
  dev)
    ARGS=(dev -p "$PORT")
    ;;
  start)
    log_header "build"
    node "$NEXT_BIN" build >> "$LOG_DIR/output.log" 2>> "$LOG_DIR/error.log"
    ARGS=(start -p "$PORT")
    ;;
  *)
    echo "알 수 없는 모드: $MODE (dev | start | graph)"
    exit 1
    ;;
esac

log_header "$MODE (port $PORT)"
nohup node "$NEXT_BIN" "${ARGS[@]}" >> "$LOG_DIR/output.log" 2>> "$LOG_DIR/error.log" &
echo $! > "$PID_FILE"

echo "서버 시작: http://localhost:$PORT  (PID $(cat "$PID_FILE"), 모드 $MODE)"
echo "로그: $LOG_DIR/output.log, $LOG_DIR/error.log · 중지: ./off.sh"
