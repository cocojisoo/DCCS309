# DCCS309_C-1 · Route Lab

고려대학교 세종캠퍼스 정문 → 조치원역 후문 구간에서 **최단경로 알고리즘 5종**(다익스트라, A\*, 양방향 다익스트라, 탐욕 최우선 탐색, 벨만-포드)을
**차도(자동차 30km/h)** 와 **인도(도보 4.8km/h)** 에서 각각 실행해 비교하고, **TMAP · 카카오모빌리티** 길찾기 결과와 견주어 보는 시각화 웹페이지입니다.

- 기술 스택: Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Leaflet
- 지도 데이터: OpenStreetMap (ODbL)
- 배포: Vercel

## C1 최종 도로망 실험 (v4)

### 정확한 경로를 빠르게 찾기: 새 실험 화면

`/study`의 기본 화면은 다음 세 실험으로 구성됩니다.

1. **같은 답을 얼마나 빨리?**: 기존 v4 결과로 DFS·다익스트라·A*의 최적 비용과 계산 시간을 비교합니다. 가상 교차로 수와 조치원 지도 반경을 선택할 수 있습니다.
2. **짧은 길 vs 빠른 길**: 같은 A*로 거리 최소와 추정 이동시간 최소 경로를 새로 계산합니다. 교육용 가상 지도는 정상에서 2km/4분, 혼잡 3배에서 거리 최소 2km/12분과 시간 최소 3km/6분의 관계를 보여줍니다. 조치원 OSM 도로도 선택할 수 있습니다.
3. **교통이 바뀌면 다시 찾기**: A*·CCH·LPA*를 실제 구현으로 비교합니다. 출발·도착을 고정하고 정상→혼잡→폐쇄→복구(선택 시 도달 불가도 포함)를 이어갑니다. 교통 변경은 단계별 고정 비용이며 주행 중 출발점 이동이나 시간 의존 교통 예측을 모델링하지 않습니다.

새 실험은 Web Worker에서 계산하므로 화면 재생이나 지도 그리기가 측정에 포함되지 않습니다. 워밍업 후 10회 독립 반복을 하고, 각 반복 안에서는 CCH와 LPA*의 상태를 보존합니다. 다익스트라로 모든 단계·반복의 최적 비용과 도로 방향·폐쇄·경로 연결을 검증합니다. 성공 경로는 거리와 조건 반영 추정 이동시간을 둘 다 표시하고, 도달 불가를 0거리/0시간으로 표시하지 않습니다.

CCH는 좌표 기반 nested dissection 순서, 비용과 독립적인 fill graph, 방향별 basic customization, 의존 삼각형을 통한 부분 비용 갱신, 상위 계층의 양방향 다익스트라, 실제 도로 경로 복원을 구현했습니다. LPA*는 g/rhs와 우선순위 큐 상태를 보존하고 비용 증가·감소에 대응합니다. 새 A*·LPA* 비교에는 같은 안전한 직선거리 힌트와 `(f, 작은 g, 노드 번호)` 동률 규칙을 사용합니다. 기존 v4 실행기의 기본 동률 규칙과 결과 파일은 유지됩니다.

현재 브라우저에서 얻은 결과는 ‘측정 결과 저장’으로 JSON을 다운로드할 수 있습니다. 이 결과는 기존 Node.js v4 공식 측정과 별개이며, 브라우저 시간 해상도와 실행 환경, 교육용 CCH의 정렬·최적화 수준에 영향을 받습니다. CCH 준비·비용 갱신·검색 시간을 나눠 표시하고, 누적 시간에는 최초 준비도 포함합니다. 메모리 표의 배열 바이트 수는 객체·삼각형 목록·큐를 제외한 부분 집계입니다. 여러 출발·도착 요청의 보조 실험은 준비 1회 + 워밍업 후 검색 묶음 3회 중앙값입니다. 성능 우열은 조건별 측정으로 판단합니다.

```bash
npm run test:research
```

알고리즘 근거: [Customizable Contraction Hierarchies](https://arxiv.org/abs/1402.0402), [Lifelong Planning A*](https://idm-lab.org/bib/abstracts/papers/aij04.pdf).

`/study`의 **최종 도로망 연구** 탭은 가상 도로, 실제 조치원 차량 도로, 가상 혼잡·방향 도로 폐쇄를 비교합니다. DFS는 모든 단순 경로를 확인하되 2초가 지나면 `TIMEOUT`으로 멈춥니다. Dijkstra와 A*는 같은 그래프·출발점·도착점·비용·도로 조건을 사용합니다. 완료한 경로의 비용 불일치, 경로 연결 오류, 폐쇄 도로 사용은 공식 결과에서 오류로 처리합니다.

```bash
npm ci
npm run test:final     # 새 알고리즘·그래프 검증
npm run final:run -- --output-id my-reproduction  # 보존된 도로 그래프로 독립 재현
npm run final:batch -- --output-id my-reproduction # 짧은 입력의 보조 묶음 측정
npm run dev            # http://localhost:3000/study
```

Node.js 24 이상을 사용합니다. 저장소에 포함된 `public/study/final/road.json`은 공개 Overpass API에서 중심 기준 약 10×10km의 차량 도로 자료를 받아 생성했습니다. 도로 파일이 없는 새 작업 환경에서만 `npm run final:graph`를 실행하세요. 생성 파일은 OSM 출처 시각과 SHA-256을 담고, 방향·일방통행·평행 도로·도로 geometry·도로 종류·OSM 속도값 또는 대체 속도를 보존합니다. `scripts/.cache/osm-final-study.json`은 내려받은 공개 OSM 원본의 캐시이며, 발표 시에는 인터넷이 필요하지 않습니다. 지도 타일이나 CDN도 사용하지 않습니다.

`configs/final-study.json`에는 시드 309, 가상 도로 생성 확률과 크기, 도로 반경, OSM 최고속도 누락 시 도로 종류별 대체 속도, 출발·도착 선택 규칙, 혼잡·폐쇄 선택 규칙, 10회 반복, DFS 2초 제한을 기록합니다. 이 설정을 확정한 뒤 실험을 실행합니다. 거리 비용은 도로 길이(m)이며, 추정 이동시간 비용은 길이×3.6÷속도(km/h)입니다. 혼잡과 폐쇄 대상은 5km 실험 그래프의 방향 간선에서 미리 고릅니다. 혼잡은 선택한 도로의 **시간 비용**만 1.5배 또는 3배로 바꾸고, 폐쇄는 방향 간선 하나만 차단합니다. 추정 이동시간은 자유 흐름 가정의 값으로 실제 도착시간이 아닙니다.

| 새 파일 | 내용 |
|---|---|
| `results/final-v4/raw_runs.csv` | 실패·시간 초과를 포함한 공식 실행 원본 전체. 없는 비용은 빈칸 |
| `results/final-v4/summary.csv` | 출발·도착별 10회 중앙값을 거친 전체 중앙값과 IQR |
| `results/final-v4/od_medians.csv` | 각 출발·도착 쌍의 10회 중앙값과 상태 건수 |
| `results/final-v4/batch_measurements.csv` | 4·6·8노드의 묶음 측정. 공식 단일 실행값과 구분 |
| `results/final-v4/meta.json` | 설정·OSM·그래프 해시, 환경, 실제 도로 크기, 선택한 출발·도착과 시나리오 |
| `public/study/final-v4/summary.json` | 화면의 공식 결과 데이터 |
| `public/study/final-v4/traces/` | 화면 재생 전용 탐색 기록. 공식 검색시간에 포함하지 않음 |

원본 결과를 보호하기 위해 `final:run`은 선택한 결과 디렉터리 중 하나라도 이미 있으면 다시 쓰지 않습니다. 기본 결과 이름은 `final-v4`이고, 재현할 때는 위처럼 새 `--output-id`를 주어 `results/<이름>`과 `public/study/<이름>`에 별도 결과를 만드세요. `/study`의 발표 화면은 검증된 `final-v4` 결과를 사용합니다. `final:graph`도 저장된 그래프나 OSM 캐시를 덮어쓰지 않습니다. 기존 `results/raw_runs.csv`, `public/graph/study.json`, `public/study/summary.json`은 이전 실험 자료로 유지됩니다. 이전 `/study` 화면은 상단의 **이전 연구 화면 열기**에서 볼 수 있습니다.

`/study`는 **교차로를 늘리면? → 지도를 넓히면? → 도로가 막히면?** 순서로 사용합니다. 각 실험은 **조건 선택 → 한 지도에서 알고리즘별 탐색 재생 → 같은 조건의 10회 중앙값 비교**로 이어집니다. 현재 교차로·방향 도로 수, 최적화 기준과 도로 상태가 항상 표시됩니다. 재생·일시정지·처음·단계 이동·속도 조절을 사용할 수 있고, **결과 보기**로 바로 비교할 수도 있습니다. **다음 크기와 비교**로 입력 크기를 단계적으로 키우세요. 재생률은 알고리즘별 탐색 기록의 진행 비율이며 실제 계산 속도가 아닙니다. 전체 측정표와 방법은 하단에서 펼칩니다.

해석할 때는 DFS 작업량(경로 접두 상태)과 Dijkstra/A* 작업량(확정 노드)의 정의가 다름을 함께 표시합니다. DFS `TIMEOUT`의 2초와 완료한 알고리즘의 검색시간을 나눠 속도 배율로 주장하지 않습니다. A*가 항상 빠르다고 가정하지 않으며, 경로 변화가 없는 경우와 도달 불가도 결과에 남깁니다. 실제 신호·회전·사고·실시간 교통은 반영하지 않았습니다.
요약의 검색시간 중앙값은 정상 완료 행만 사용하고, 탐색 작업량 중앙값에는 시간 초과 행도 포함합니다.

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
