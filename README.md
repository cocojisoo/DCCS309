# DCCS309_C-1 · Route Lab

고려대학교 세종캠퍼스 정문 → 조치원역 후문 구간에서 **최단경로 알고리즘 5종**(다익스트라, A\*, 양방향 다익스트라, 탐욕 최우선 탐색, 벨만-포드)을
**차도(자동차 30km/h)** 와 **인도(도보 4.8km/h)** 에서 각각 실행해 비교하고, **TMAP · 카카오모빌리티** 길찾기 결과와 견주어 보는 시각화 웹페이지입니다.

- 기술 스택: Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Leaflet
- 지도 데이터: OpenStreetMap (ODbL)
- 배포: Vercel

---

!!! 모든 작업은 develop 혹은 main을 제외한 branch에서 해주세요 !!!

## 실행

```bash
./run.sh dev      # 개발 서버 실행 (http://localhost:3000, 백그라운드)
./off.sh          # 서버 중지
```

++ 윈도우 환경이면 **Git Bash** 쉘에서 `.sh`를 실행해야 합니다.

| 명령 | 설명 |
|---|---|
| `./run.sh dev` | 개발 서버 실행. `node_modules`가 없으면 `npm install`부터 실행 |
| `./run.sh start` | 프로덕션 빌드 후 실행 |
| `./run.sh graph` | OSM 도로망을 다시 받아 `public/graph/*.json` 재생성 |
| `./off.sh` | 서버 중지 (윈도우에서는 자식 node 프로세스와 3000번 포트까지 정리) |

포트를 바꾸려면 `PORT=4000 ./run.sh dev`, `PORT=4000 ./off.sh`처럼 실행합니다.

## API 키

지도앱 비교 페이지에서 쓰는 키입니다. 키가 없어도 나머지 기능은 동작하고, 해당 항목만 "API 키 미설정"으로 표시됩니다.

```bash
cp .env.example .env.local   # 그리고 키를 채운다
```

| 변수 | 발급처 | 용도 |
|---|---|---|
| `TMAP_APP_KEY` | [TMAP API](https://tmapapi.tmapmobility.com) | 자동차 · 보행자 경로안내 |
| `KAKAO_REST_API_KEY` | [카카오모빌리티 디벨로퍼스](https://developers.kakaomobility.com) | 자동차 길찾기 (도보 API는 없음) |

키는 서버(Route Handler `/api/tmap`, `/api/kakao`)에서만 사용하고 브라우저로 보내지 않습니다.
Vercel에서는 Project Settings → Environment Variables에 같은 이름으로 등록합니다.

## 페이지

| 경로 | 이름 | 내용 |
|---|---|---|
| `/` | 대시보드 | ▶ 시작 → 알고리즘 5종 × 차도/인도 실행, 탐색 과정 지도 애니메이션, 통계 차트와 표 |
| `/algorithms` | 알고리즘 | 알고리즘별 원리 · 시간복잡도 · 최적성, 비용 모델과 데이터 한계 |
| `/map-apps` | 지도앱 비교 | TMAP · 카카오 경로와 우리 경로 비교 (앱 ETA vs 고정 속도 재계산 ETA, 경로 겹침 비율), 각 사 알고리즘 조사 |
| `/logs` | 로그 | 실행 기록(브라우저 localStorage) + `infra/logs` 서버 로그 조회 |
| `/study` | 크기별 실험 | DFS · 다익스트라 · A\* 를 조치원 지도 크기별로 비교 (알고리즘 교실, 나란히 탐색 비교, 크기별 그래프, 장단점 표) |

## 크기별 실험 (DFS · 다익스트라 · A\*)

`PROJECT_BLUEPRINT.md`(팀 설계도 v2.0)의 실험 설계를 이 웹앱 구조(Next.js + TypeScript) 안에 구현한 것입니다.
알고리즘과 실험 코드는 `src/lib/study/`에 있고, Node 24 가 TypeScript 를 바로 실행하므로 같은 코드를 스크립트와 화면이 함께 씁니다.

```bash
npm run study:graph      # OSM에서 조치원 중심 10km × 10km 차량 도로를 받아 public/graph/study.json 생성 (인터넷 필요, 처음 한 번)
npm run test:study       # 손으로 만든 지도 / 무작위 작은 지도(플로이드-워셜 정답) / 실제 지도 형식·힌트 검사
npm run study:check      # 7.1 가능성 확인: 크기마다 DFS 1회 → results/feasibility.json
npm run study:run        # 공식 실험 (약 15~20분) → results/raw_runs.csv, summary.csv, study_meta.json, public/study/summary.json
npm run study:summarize  # raw_runs.csv 만으로 요약·화면 데이터 다시 만들기
npm run study:traces     # 발표용 탐색 기록 → public/study/traces/ (화면은 재생만 함)
```

| 설계도 | 이 구현 |
|---|---|
| 설정 `configs/study.yaml` | `configs/study.json` (같은 항목, YAML 파서 의존성을 피하려고 JSON) |
| OSMnx `simplify=True` | `scripts/build-study-graph.mjs` 가 같은 규칙으로 교차로만 남기고 굽은 도로를 간선 하나로 합침. 자기루프 제거, 평행 도로는 가장 짧은 것만 |
| 크기 사다리 (교차로 N개 / 반경) | `src/lib/study/ladder.ts`: 도로를 따라 가까운 N개, 직선 반경. 자른 뒤 가장 큰 강연결요소만 |
| 트랙 1 / 트랙 2 출발·도착 | `src/lib/study/od.ts`: 시드 309 고정. 트랙 2 는 가장 먼 두 교차로 거리의 40~70% |
| DFS (가지치기 없음, 직접 스택, 1,000 방문마다 시간 확인) | `src/lib/study/dfs.ts` |
| 다익스트라 `(거리, 순번)` / A\* `(거리+힌트, −거리, 순번)`, 힌트 = 직선 × 0.999 | `src/lib/study/bestFirst.ts` |
| A\* 힌트 안전 확인 | `checkHeuristic`: 모든 도로에서 0.999 × 직선 ≤ 길이 (삼각부등식으로 모든 도착점에 대해 성립) |
| RouteChecker, 길이 일치(0.01m) | `checkRoute`, `runStudy` 의 불일치 기록 |
| 워밍업 1회, 반복 5회 중간값, 반복마다 순서 섞기, 측정 중 GC 끄기 | 모두 구현. 단 V8 은 GC 를 끌 수 없어서 `--expose-gc` 로 측정 직전마다 수집만 함 |
| NetworkX 로 정답 확인 | 테스트에서 독립 구현한 플로이드-워셜로 확인 |
| Streamlit + Plotly 화면 1~4 | `/study` 페이지 (SVG · Canvas). 지도 배경 타일 없이 도로선만 그려서 인터넷 없이도 동작 |

결과 CSV 열, 실패 행 보존(길이는 빈칸), 발표 중 알고리즘을 다시 돌리지 않는 재생 방식은 설계도 그대로입니다.
설계도 7.1 에 따라 **`study:check` 결과로 `configs/study.json` 을 확정해 커밋한 뒤** 한 명이 `study:run` 을 공식으로 실행합니다.

## 비교 방법

- **비용** = 간선 길이 ÷ 속도. 속도가 고정이므로 최적 알고리즘(다익스트라, A\*, 양방향, 벨만-포드)은 항상 같은 경로를 냅니다.
  차이는 **탐색 노드 수 · 간선 완화 횟수 · 실행 시간**에서 드러납니다.
- **현실 보정**(대시보드 체크박스, 기본 켜짐): 자동차는 교차로 통과마다 **+20초**, 도보는 횡단보도 1회마다 **+60초**를 더합니다.
- **지도앱 비교**: `재계산 ETA = 앱이 준 경로 거리 ÷ 우리 속도`, `차이 = 앱 ETA − 재계산 ETA`(앱이 반영한 신호·교통·회전 비용).
- 출발·도착 좌표는 `src/lib/config.ts`에 있고, 실행할 때 가장 가까운 그래프 노드에 맞춥니다.

## 지도 데이터 (JSON)

별도 DB 없이 **프로젝트 안의 JSON 파일**을 씁니다.

- `public/graph/car.json`, `public/graph/walk.json`: `scripts/build-graph.mjs`가 OSM(Overpass API)에서 만든 정적 그래프입니다. 저장소에 커밋합니다.
- 다시 만들 때는 `./run.sh graph`(새로 다운로드)나 `npm run graph`(캐시 `scripts/.cache/osm.json` 재사용)를 실행합니다.
- 실행 기록은 서버에 저장하지 않고 브라우저 localStorage에만 남습니다.

## 로그

로그는 `infra/logs`에 **error.log, output.log** 두 파일로 관리합니다 (로컬 전용).

- `output.log`: 서버 표준 출력 (요청 로그, 외부 API 조회 결과)
- `error.log`: 표준 에러 (외부 API 실패 등)
- `/logs` 페이지에서 마지막 300줄을 볼 수 있습니다.
- Vercel 배포본은 파일 로그를 쓰지 않으므로 Vercel 대시보드의 Logs에서 확인합니다.

## 폴더 구조

```
scripts/build-graph.mjs     OSM → 그래프 JSON 생성
scripts/build-study-graph.mjs  OSM → 실험용 교차로 그래프 (public/graph/study.json)
scripts/study/              실험 스크립트 (가능성 확인, 공식 실험, 요약, 발표용 기록)
src/lib/study/              DFS · 다익스트라 · A*, 크기 사다리, 출발·도착 쌍, 실험 실행
configs/study.json          실험 설정 (시드 309, 크기 목록, 반복 횟수, 제한시간)
results/                    실험 결과 CSV
tests/study.test.ts         실험 코드 테스트
public/graph/               차도/인도 그래프 JSON
src/lib/algorithms.ts       알고리즘 5종
src/lib/benchmark.ts        전체 실행 · 시간 측정
src/lib/server/directions.ts  TMAP / 카카오 API 프록시 (서버 전용)
src/app/                    페이지와 API Route Handler
src/components/             대시보드 · 지도(Leaflet) · 차트
infra/logs/                 로컬 서버 로그
run.sh, off.sh              서버 실행 / 중지
```

## 커밋 규칙

```
브랜치명 [ 커밋명 ]

상세 설명
```

예시:

```
main [ init ]

project initial setting
```
