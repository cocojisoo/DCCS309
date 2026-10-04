import type { Metadata } from "next";
import type { ReactNode } from "react";
import ClassroomView from "@/components/study/ClassroomView";
import { STUDY_ALGORITHMS, type StudyAlgorithmId } from "@/lib/study/search";

export const metadata: Metadata = { title: "알고리즘 · Route Lab" };

/** 알고리즘마다: 한 줄 요약, 어떻게 찾는지, 좋은 점 / 아쉬운 점 */
const EXPLAIN: Record<StudyAlgorithmId, { oneLine: string; how: ReactNode[]; good: string[]; bad: string[]; note?: ReactNode }> = {
  dfs: {
    oneLine: "갈 수 있는 모든 길을 하나씩 끝까지 가 보고, 그중 가장 짧은 길을 고릅니다.",
    how: [
      "출발점에서 첫 번째 갈림길로 계속 들어갑니다. 미로에서 한쪽 벽만 짚고 끝까지 가 보는 것과 같습니다.",
      "도착점에 닿거나, 더 갈 곳이 없거나, 지금 걷는 길에 이미 있는 교차로를 다시 만나면 한 칸 되돌아와 다음 갈림길로 갑니다.",
      "도착할 때마다 그 길의 길이를 재서 지금까지의 최고 기록과 비교합니다. 모든 길을 다 확인해야 끝납니다.",
    ],
    good: ["원리가 가장 단순합니다.", "끝까지 다 돌면 가장 짧은 길을 확실히 찾습니다."],
    bad: [
      "갈림길이 늘어날수록 확인할 길의 수가 폭발적으로(지수적으로) 늘어납니다.",
      "이미 더 길다고 알게 된 길도 끝까지 다시 따라가고, 같은 교차로를 서로 다른 길로 수없이 다시 방문합니다.",
    ],
  },
  dijkstra: {
    oneLine: "출발점에서 가까운 교차로부터 하나씩 '여기까지 가장 짧은 길'을 확정해 나갑니다.",
    how: [
      "아직 확정하지 않은 교차로 중 출발점에서 가장 가까운 곳을 꺼내 확정합니다.",
      "확정한 교차로에서 이어진 이웃들의 거리를 '지금 알려진 것보다 짧아지면' 고쳐 둡니다.",
      "도로 비용이 모두 0 이상이라, 가장 가까운 곳은 나중에 더 짧아질 수 없습니다. 그래서 한 번 확정한 교차로는 다시 보지 않습니다.",
      "도착점을 확정하는 순간 멈춥니다. 호수에 돌을 던진 것처럼 출발점 둘레로 동그랗게 퍼집니다.",
    ],
    good: ["항상 가장 짧은 길을 찾습니다.", "교차로마다 한 번씩만 확정하므로 지도가 커져도 시간이 완만하게 늘어납니다 — O((V+E) log V)."],
    bad: ["도착점이 어느 쪽인지 모르므로 반대 방향까지 똑같이 살펴봅니다.", "도로 상황이 바뀌면 처음부터 다시 계산해야 합니다."],
  },
  astar: {
    oneLine: "다익스트라에 '도착점까지 남은 직선거리'라는 힌트를 더해, 도착점 쪽 교차로를 먼저 확정합니다.",
    how: [
      "교차로를 꺼내는 순서를 '지금까지 온 거리 + 여기서 도착점까지 직선거리'가 작은 순으로 정합니다.",
      "실제 도로는 직선보다 짧을 수 없으므로 힌트가 실제 남은 거리보다 크지 않습니다. 그래서 다익스트라처럼 가장 짧은 길을 보장합니다.",
      "도착점과 반대쪽 교차로는 힌트 값이 커서 뒤로 밀리고, 대부분 끝까지 보지 않습니다.",
    ],
    good: ["다익스트라와 같은 답을 훨씬 적은 교차로만 보고 찾습니다.", "구현이 다익스트라와 거의 같습니다."],
    bad: [
      "교차로의 좌표(위치)가 있어야 힌트를 만들 수 있습니다.",
      "혼잡 · 폐쇄로 도로 비용이 바뀌면 지난 계산을 버리고 처음부터 다시 탐색합니다.",
    ],
  },
  cch: {
    oneLine: "지도에 '지름길'을 미리 만들어 두고, 길을 찾을 때는 중요한 교차로 쪽으로만 올라가며 찾습니다. (Customizable Contraction Hierarchies)",
    how: [
      "① 전처리 (지도 모양만 보고 한 번): 교차로마다 중요도 순위를 매깁니다. 지도를 반씩 나누는 경계의 교차로일수록 중요합니다. 덜 중요한 교차로부터 하나씩 '수축'하면서, 그 교차로를 거쳐 가던 이웃끼리 지름길을 잇습니다.",
      "② 커스터마이징 (도로 비용이 바뀔 때마다): 이동시간 · 혼잡 같은 비용을 지름길에 채웁니다. 일부 도로만 바뀌면 그 도로에 닿는 지름길만 다시 계산합니다.",
      "③ 질의 (길을 찾을 때마다): 출발점과 도착점에서 각각 '더 중요한 교차로' 쪽으로만 올라갑니다. 두 쪽이 만나는 곳 중 가장 싼 곳이 답이고, 지름길을 원래 도로로 펼쳐서 경로를 돌려줍니다.",
    ],
    good: [
      "길을 찾을 때 보는 교차로 수가 매우 적어서 큰 지도에서도 빠릅니다.",
      "지도 모양(①)과 비용(②)을 나눠 두었기 때문에 실시간 교통 정보가 바뀌어도 ②만 빠르게 다시 하면 됩니다.",
    ],
    bad: ["처음에 지름길을 만드는 시간과 저장 공간이 듭니다.", "구현이 다른 방법보다 훨씬 복잡합니다."],
    note: (
      <>
        카카오맵은 2021년 도보 · 자전거 길찾기에, TMAP 은 2024년 자동차 길찾기 엔진(토르)에 CCH 를 도입했다고 밝혔습니다 (
        <a href="https://tech.kakao.com/2021/05/10/kakaomap-cch/" target="_blank" rel="noreferrer">
          카카오 기술 블로그
        </a>
        ,{" "}
        <a href="https://zdnet.co.kr/view/?no=20240201160036" target="_blank" rel="noreferrer">
          ZDNet Korea
        </a>
        ).
      </>
    ),
  },
  lpa: {
    oneLine: "같은 출발 · 도착을 계속 다시 계산할 때, 지난번 계산을 기억해 두었다가 바뀐 부분만 고칩니다. (Lifelong Planning A*)",
    how: [
      "처음에는 A* 처럼 도착점 쪽으로 힌트를 받아 찾습니다. 이때 각 교차로까지의 비용을 기억해 둡니다.",
      "교차로마다 두 값을 가집니다: 지금 알고 있는 비용, 그리고 들어오는 도로들을 보고 새로 계산한 비용. 둘이 같으면 '앞뒤가 맞는' 교차로입니다.",
      "도로가 혼잡해지거나 막히면 그 도로 끝 교차로의 값이 어긋납니다. 어긋난 교차로만 큐에 넣고, 어긋남이 퍼져 나가는 곳까지만 다시 계산합니다.",
    ],
    good: [
      "변화가 작으면 처음부터 다시 하는 A* 보다 훨씬 적은 교차로만 다시 봅니다.",
      "다시 계산해도 항상 가장 짧은(가장 빠른) 길을 찾습니다.",
    ],
    bad: [
      "교차로마다 기억할 정보가 많아 메모리를 더 씁니다.",
      "출발점이 바뀌면(차가 움직이면) 기억을 그대로 쓰기 어렵습니다. 이를 보완한 것이 로봇 경로 계획에 쓰이는 D* Lite 입니다.",
      "변화가 출발점 근처이거나 아주 크면 다시 계산할 양이 처음과 비슷해집니다.",
    ],
  },
};

export default function AlgorithmsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">알고리즘</h1>
        <p className="muted text-sm mt-1">
          다섯 가지 길찾기 방법이 경로를 어떻게 찾는지 설명하고, 교차로 8개짜리 아주 작은 가상 지도에서 한 단계씩 직접 확인합니다. 숫자는 도로
          길이(m)이고, S 에서 T 로 갑니다.
        </p>
        <nav className="tabs mt-3" aria-label="알고리즘 바로가기">
          {STUDY_ALGORITHMS.map((a, i) => (
            <a key={a.id} href={`#${a.id}`} className="tab">
              {i + 1}. {a.name}
            </a>
          ))}
        </nav>
      </div>

      {STUDY_ALGORITHMS.map((a, i) => {
        const x = EXPLAIN[a.id];
        return (
          <section key={a.id} id={a.id} className="flex flex-col gap-3 scroll-mt-6">
            <h2 className="text-xl font-bold">
              {i + 1}. {a.name} <span className="faint text-sm font-normal">{a.role}</span>
            </h2>
            <article className="card prose-ko">
              <p className="!text-[var(--text)] font-semibold">{x.oneLine}</p>
              <ol className="list-decimal pl-5 mt-2 flex flex-col gap-1">
                {x.how.map((h, k) => (
                  <li key={k}>{h}</li>
                ))}
              </ol>
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--good)" }}>
                    좋은 점
                  </div>
                  <ul>
                    {x.good.map((t, k) => (
                      <li key={k}>{t}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--bad)" }}>
                    아쉬운 점
                  </div>
                  <ul>
                    {x.bad.map((t, k) => (
                      <li key={k}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {x.note && <p className="text-xs mt-3">{x.note}</p>}
            </article>
            <ClassroomView algo={a.id} />
          </section>
        );
      })}
    </div>
  );
}
