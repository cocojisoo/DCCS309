import type { Metadata } from "next";
import MapAppsView from "@/components/MapAppsView";

export const metadata: Metadata = { title: "지도앱 비교 · Route Lab" };

export default function MapAppsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">지도앱 비교</h1>
        <p className="muted text-sm mt-1">
          같은 출발·도착지를 TMAP과 카카오모빌리티 길찾기 API에 물어보고, 우리 다익스트라 경로와 거리·ETA·경로 모양을 비교합니다.
        </p>
      </div>

      <MapAppsView />

      <section className="grid md:grid-cols-2 gap-4">
        <article className="card prose-ko">
          <h2>카카오맵 / 카카오내비</h2>
          <ul>
            <li>
              2021년 카카오 기술 블로그에 따르면, 카카오맵은 <b>도보·자전거</b> 길찾기 엔진을 개편하면서{" "}
              <b>CCH (Customizable Contraction Hierarchies)</b>를 탐색 알고리즘으로 채택했습니다. 실시간 비용 변경과 여러 경로 옵션을
              효율적으로 처리할 수 있다는 점이 이유였습니다.
            </li>
            <li>자동차 길찾기(카카오내비) 엔진의 세부 알고리즘은 공식적으로 공개되지 않았습니다.</li>
            <li>
              공개 API: 카카오모빌리티 <code>/v1/directions</code> (자동차만). 응답의 <code>summary.duration</code>은 호출 시점의 교통
              상황을 반영한 값입니다.
            </li>
          </ul>
          <p className="text-xs faint mt-2">
            출처:{" "}
            <a href="https://tech.kakao.com/2021/05/10/kakaomap-cch/" target="_blank" rel="noreferrer">
              카카오맵이 빠르게 길을 찾아주는 방법: CCH를 이용한 개편기
            </a>
            ,{" "}
            <a href="https://developers.kakaomobility.com/docs/navi-api/directions/" target="_blank" rel="noreferrer">
              카카오모빌리티 자동차 길찾기 문서
            </a>
          </p>
        </article>

        <article className="card prose-ko">
          <h2>TMAP</h2>
          <ul>
            <li>
              2024년 2월, 기존 <b>A* 기반</b> 엔진을 <b>CCH 기반</b>의 &lsquo;토르(Thor)&rsquo; 엔진으로 교체했다고 발표했습니다.
            </li>
            <li>
              전처리 → 커스터마이제이션 → 경로 쿼리의 3단계로 동작하며, 1분마다 갱신되는 실시간 교통정보로 시간 의존 최단경로를
              구합니다. 장거리 경로 응답 시간이 100배 이상 줄었다고 합니다.
            </li>
            <li>
              공개 API: 자동차 <code>/tmap/routes</code>, 보행자 <code>/tmap/routes/pedestrian</code>. 두 수단을 모두 제공하므로 도보
              비교는 TMAP만 가능합니다.
            </li>
          </ul>
          <p className="text-xs faint mt-2">
            출처:{" "}
            <a href="https://zdnet.co.kr/view/?no=20240201160036" target="_blank" rel="noreferrer">
              ZDNet Korea (2024.02.01) 티맵 길찾기 더 빨라진다
            </a>
            ,{" "}
            <a href="https://tmapapi.tmapmobility.com/" target="_blank" rel="noreferrer">
              TMAP API
            </a>
          </p>
        </article>

        <article className="card prose-ko md:col-span-2">
          <h2>왜 상용 앱은 다익스트라나 A*를 그대로 쓰지 않을까</h2>
          <p>
            이 프로젝트의 그래프는 노드가 수천 개라서 다익스트라도 1~2ms면 끝납니다. 전국 도로망은 노드가 수천만 개라 매 요청마다 원 모양으로
            퍼지는 탐색은 너무 느립니다. <b>CH(Contraction Hierarchies)</b>는 중요도가 낮은 노드를 미리 &lsquo;수축&rsquo;시키고 지름길
            간선(shortcut)을 추가해 두어, 질의 때는 양방향으로 &lsquo;더 중요한 노드&rsquo; 쪽으로만 올라가며 탐색합니다.{" "}
            <b>CCH</b>는 도로 구조에만 의존하는 전처리와 가중치(교통량)를 반영하는 커스터마이제이션 단계를 분리해서, 실시간 교통 정보가 바뀌어도
            몇 초 안에 가중치를 다시 반영할 수 있습니다. 결국 상용 엔진도 핵심은 이 페이지의 <b>양방향 다익스트라</b>를 전처리된 그래프 위에서
            돌리는 것입니다.
          </p>
        </article>
      </section>
    </div>
  );
}
