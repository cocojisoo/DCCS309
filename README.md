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
