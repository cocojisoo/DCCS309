# DCCS309_C-1 · Route Lab

고려대학교 세종캠퍼스 정문 → 조치원역 후문 구간과 조치원 실제 도로 지도에서 **길찾기 알고리즘 5종**(DFS, 다익스트라, A\*, CCH, LPA\*)을
비교하는 시각화 웹페이지입니다. 정상 도로에서는 지도 크기에 따른 탐색 시간과 정답 여부를, 혼잡 · 폐쇄 상황에서는 A\* · CCH · LPA\* 가
새 경로를 다시 찾는 비용과 결과를 비교합니다.

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
| `./run.sh graph` | OSM 도로망을 다시 받아 `public/graph/car.json`, `walk.json` 재생성 |
| `./off.sh` | 서버 중지 (윈도우에서는 자식 node 프로세스와 3000번 포트까지 정리) |

포트를 바꾸려면 `PORT=4000 ./run.sh dev`, `PORT=4000 ./off.sh`처럼 실행합니다.

## 페이지

| 경로 | 이름 | 내용 |
|---|---|---|
| `/` | 대시보드 | ▶ 시작 → DFS · 다익스트라 · A\* · CCH · LPA\* × 차도/인도 실행, 탐색 과정 지도 애니메이션, 통계 차트와 표 |
| `/algorithms` | 알고리즘 | 알고리즘마다 설명 + 교차로 8개짜리 가상 지도에서 한 단계씩 보는 시뮬레이션 |
| `/study` | 크기별 실험 | 1. 조치원 탐색 비교 (5종 나란히) · 2. 혼잡 · 폐쇄 (A\* · CCH · LPA\*) · 3. 실험 결과 (모든 실험의 표와 그래프) |
| `/summary` | 최종 정리 | 정상 / 혼잡 상황에서 최소 경로 · 최소 이동시간 보장 여부, 입력이 커질 때 장단점, 실제 산업의 한계와 발전 방향 |

## 알고리즘 (공통 구현: `src/lib/study/`)

대시보드와 실험이 **같은 구현**을 씁니다. 대시보드는 비용을 이동시간(+ 교차로 · 횡단보도 보정)으로, 실험은 도로 길이 또는 이동시간으로 넘깁니다.

| 방법 | 파일 | 요약 |
|---|---|---|
| DFS | `dfs.ts` | 모든 길을 끝까지 확인 (가지치기 없음, 직접 만든 스택, 제한시간 2초) |
| 다익스트라 | `bestFirst.ts` | 힙 키 `(비용, 순번)` |
| A\* | `bestFirst.ts` | 힙 키 `(비용 + 힌트, −비용, 순번)`, 힌트 = 직선거리 × 0.999 (이동시간이면 ÷ 속도) |
| CCH | `cch.ts` | 전처리(좌표 기반 중첩 분할 순서 → 수축 → 지름길) · 커스터마이징(아래쪽 삼각형, 바뀐 도로만 다시 계산하는 부분 커스터마이징) · 질의(소거 트리 위로만) |
| LPA\* | `lpa.ts` | g / rhs 로 어긋난 교차로만 고치는 증분 A\*. `setWeight()` 로 혼잡 · 폐쇄를 알려 주고 `compute()` 로 다시 계획 |

## 크기별 실험 · 혼잡 · 폐쇄 실험

`PROJECT_BLUEPRINT.md`(팀 설계도 v2.0)의 실험 설계와 명세서(혼잡 · 폐쇄)를 구현했습니다. Node 24 가 TypeScript 를 바로 실행하므로 같은 코드를 스크립트와 화면이 함께 씁니다.

```bash
npm run study:graph      # OSM에서 조치원 중심 10km × 10km 차량 도로를 받아 public/graph/study.json 생성 (인터넷 필요, 처음 한 번)
npm run test:study       # 작은 지도 / 무작위 지도(플로이드-워셜 정답) / 혼잡·폐쇄 뒤 CCH·LPA* 증분 계산 / 실제 지도 검사
npm run study:check      # 7.1 가능성 확인: 크기마다 DFS 1회 → results/feasibility.json
npm run study:run        # 정상 상태 공식 실험 (약 20분) → results/raw_runs.csv, summary.csv, study_meta.json, public/study/summary.json
npm run study:traffic    # 혼잡 · 폐쇄 실험 → results/traffic_runs.csv, public/study/traffic/
npm run study:summarize  # raw_runs.csv 만으로 요약·화면 데이터 다시 만들기
npm run study:traces     # 발표용 탐색 기록 → public/study/traces/ (화면은 재생만 함)
```

- **정상 상태**: 비용 = 도로 길이. 모든 도로 30km/h 로 보고 이동 시간 = 길이 ÷ 속도 (그래서 최단 경로 = 최소 이동시간).
- **혼잡 · 폐쇄** (`configs/study.json` 의 `traffic`): 비용 = 이동시간(초). 시드 고정으로 정상 경로의 한 구간 + 지도 전체 일부 도로를 혼잡(이동시간 ×3~6),
  정상 경로 가운데 도로 1개 + 지도 전체 도로 10개를 폐쇄합니다(출발·도착이 끊기는 폐쇄는 제외). 상황이 바뀐 뒤
  A\* 는 처음부터 다시, CCH 는 부분 커스터마이징 + 질의, LPA\* 는 증분 재계획으로 새 경로를 찾고, 그 계산 시간(5회 중간값)과 본 교차로 수를 잽니다.
- CCH 의 전처리 · 커스터마이징 시간은 질의 시간과 따로 기록합니다 (`study_meta.json` 의 `log.cch`).

| 설계도 | 이 구현 |
|---|---|
| 설정 `configs/study.yaml` | `configs/study.json` (같은 항목, YAML 파서 의존성을 피하려고 JSON) |
| OSMnx `simplify=True` | `scripts/build-study-graph.mjs` 가 같은 규칙으로 교차로만 남기고 굽은 도로를 간선 하나로 합침. 자기루프 제거, 평행 도로는 가장 짧은 것만 |
| 크기 사다리 (교차로 N개 / 반경) | `src/lib/study/ladder.ts`: 도로를 따라 가까운 N개, 직선 반경. 자른 뒤 가장 큰 강연결요소만 |
| 트랙 1 / 트랙 2 출발·도착 | `src/lib/study/od.ts`: 시드 309 고정. 화면에서는 &lsquo;경로 1, 경로 2 …&rsquo; 로 표시 |
| A\* 힌트 안전 확인 | `checkHeuristic`: 모든 도로에서 0.999 × 직선 ≤ 길이 |
| RouteChecker, 길이 일치(0.01m) | `checkRoute`, `runStudy` 의 불일치 기록 |
| 워밍업 1회, 반복 5회 중간값, 반복마다 순서 섞기, 측정 중 GC 끄기 | 모두 구현. 단 V8 은 GC 를 끌 수 없어서 `--expose-gc` 로 측정 직전마다 수집만 함 |
| NetworkX 로 정답 확인 | 테스트에서 독립 구현한 플로이드-워셜로 확인 |
| Streamlit + Plotly 화면 | `/algorithms`, `/study`, `/summary` 페이지 (SVG · Canvas). 지도 배경 타일 없이 도로선만 그려서 인터넷 없이도 동작 |

설계도 7.1 에 따라 **`study:check` 결과로 `configs/study.json` 을 확정해 커밋한 뒤** 한 명이 `study:run`, `study:traffic` 을 공식으로 실행합니다.

## 대시보드 비교 방법

- **비용** = 간선 길이 ÷ 속도 (자동차 30km/h, 도보 4.8km/h).
- **현실 보정**(체크박스, 기본 켜짐): 자동차는 교차로 통과마다 **+20초**, 도보는 횡단보도 1회마다 **+60초**를 더합니다.
- DFS 는 한 번에 최대 2초만 돌리고, 넘으면 &lsquo;시간 초과&rsquo;로 표시합니다. CCH 의 탐색 시간은 질의만이고 전처리 · 커스터마이징 시간은 표 아래에 따로 보여 줍니다.
- 출발·도착 좌표는 `src/lib/config.ts`에 있고, 실행할 때 가장 가까운 그래프 노드에 맞춥니다.

## 지도 데이터 (JSON)

별도 DB 없이 **프로젝트 안의 JSON 파일**을 씁니다.

- `public/graph/car.json`, `public/graph/walk.json`: 대시보드용. `scripts/build-graph.mjs`가 OSM(Overpass API)에서 만든 정적 그래프입니다.
- `public/graph/study.json`: 실험용 조치원 교차로 그래프. `scripts/build-study-graph.mjs`.
- 다시 만들 때는 `./run.sh graph`(새로 다운로드)나 `npm run graph`(캐시 `scripts/.cache/osm.json` 재사용)를 실행합니다.

## 로그

`run.sh` 로 띄운 서버의 출력은 `infra/logs`에 **error.log, output.log** 두 파일로 남습니다 (로컬 전용).

## 폴더 구조

```
scripts/build-graph.mjs        OSM → 대시보드 그래프 JSON
scripts/build-study-graph.mjs  OSM → 실험용 교차로 그래프 (public/graph/study.json)
scripts/study/                 실험 스크립트 (가능성 확인, 공식 실험, 혼잡·폐쇄, 요약, 발표용 기록)
src/lib/study/                 DFS · 다익스트라 · A* · CCH · LPA*, 크기 사다리, 출발·도착 쌍, 실험 실행, 혼잡·폐쇄
src/lib/algorithms.ts          대시보드용: 비용(이동시간 + 보정)을 만들어 공통 구현 호출
src/lib/benchmark.ts           대시보드 전체 실행 · 시간 측정
configs/study.json             실험 설정 (시드 309, 크기 목록, 반복 횟수, 제한시간, 혼잡·폐쇄)
results/                       실험 결과 CSV
tests/study.test.ts            알고리즘 · 실험 코드 테스트
public/graph/                  그래프 JSON
public/study/                  화면이 읽는 실험 결과와 탐색 기록
src/app/                       페이지
src/components/                대시보드 · 지도(Leaflet) · 차트 · 실험 화면(study/)
infra/logs/                    로컬 서버 로그
run.sh, off.sh                 서버 실행 / 중지
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
