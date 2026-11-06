import type { Metadata } from "next";
import type { ReactNode } from "react";
import ClassroomView from "@/components/study/ClassroomView";
import { STUDY_ALGORITHMS, type StudyAlgorithmId } from "@/lib/study/search";

export const metadata: Metadata = { title: "Algorithms · Route Lab" };

/** 알고리즘마다: 한 줄 요약, 어떻게 찾는지, 좋은 점 / 아쉬운 점 */
const EXPLAIN: Record<StudyAlgorithmId, { oneLine: string; how: ReactNode[]; good: string[]; bad: string[]; note?: ReactNode }> = {
  dfs: {
    oneLine: "Follows every possible path to its end, then picks the shortest one.",
    how: [
      "From the start, it keeps taking the first branch, like walking through a maze with one hand on the wall.",
      "When it reaches the goal, hits a dead end, or meets an intersection already on the current path, it steps back one intersection and tries the next branch.",
      "Each time it reaches the goal, it compares that path's length with the best so far. It only finishes after checking every path.",
    ],
    good: ["It has the simplest idea of the five.", "If it runs to the end, it is certain to find the shortest path."],
    bad: [
      "The number of paths to check grows explosively (exponentially) as branches are added.",
      "It follows paths already known to be longer all the way to the end, and revisits the same intersections through many different paths.",
    ],
  },
  dijkstra: {
    oneLine: "Starting from the nearest intersections, it settles the shortest path to each intersection one at a time.",
    how: [
      "Among the intersections not yet settled, it takes the one closest to the start and settles it.",
      "It then updates the settled intersection's neighbors if going through it gives a shorter distance than the one currently known.",
      "All road costs are zero or more, so the closest intersection can never get shorter later. A settled intersection is never looked at again.",
      "It stops as soon as the goal is settled. The search spreads out in a circle around the start, like ripples on a lake.",
    ],
    good: ["It always finds the shortest path.", "Each intersection is settled only once, so the time grows gently as the map grows: O((V+E) log V)."],
    bad: ["It does not know which way the goal is, so it searches the opposite direction just as much.", "If road conditions change, it must start over."],
  },
  astar: {
    oneLine: "Adds a hint to Dijkstra, the remaining straight-line distance to the goal, so intersections toward the goal are settled first.",
    how: [
      "It takes intersections in order of the smallest value of distance so far + straight-line distance to the goal.",
      "A real road can never be shorter than the straight line, so the hint never exceeds the true remaining distance. That is why it guarantees the shortest path, just like Dijkstra.",
      "Intersections away from the goal get large values and are pushed back, so most of them are never explored.",
    ],
    good: ["It finds the same answer as Dijkstra while looking at far fewer intersections.", "Its implementation is almost the same as Dijkstra's."],
    bad: [
      "It needs the coordinates of intersections to compute the hint.",
      "When congestion or closures change road costs, it throws away its previous work and searches again from the start.",
    ],
  },
  cch: {
    oneLine: "Builds shortcuts in advance, then searches only upward toward more important intersections. (Customizable Contraction Hierarchies)",
    how: [
      "Preprocessing (once, using only the map's shape): each intersection gets an importance rank. Intersections on the boundaries that split the map in half rank higher. Starting from the least important, each intersection is contracted, and its neighbors that used to go through it are joined by a shortcut.",
      "Customization (whenever road costs change): costs such as travel time and congestion are filled into the shortcuts. If only some roads change, only the shortcuts that depend on them are recomputed.",
      "Query (for each route request): from both the start and the goal, the search moves only toward more important intersections. The cheapest place where the two sides meet gives the answer, and the shortcuts are unpacked back into real roads.",
    ],
    good: [
      "A query looks at very few intersections, so it stays fast on large maps.",
      "The map's shape (step 1) and the costs (step 2) are separate, so when live traffic changes, only step 2 has to be redone.",
    ],
    bad: ["Building the shortcuts takes time and storage up front.", "It is much more complex to implement than the other methods."],
    note: (
      <>
        KakaoMap reported adopting CCH for walking and cycling directions in 2021, and TMAP for its car routing engine (Thor) in 2024 (
        <a href="https://tech.kakao.com/2021/05/10/kakaomap-cch/" target="_blank" rel="noreferrer">
          Kakao Tech Blog
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
    oneLine: "When the same start and goal must be recomputed repeatedly, it remembers the previous search and fixes only what changed. (Lifelong Planning A*)",
    how: [
      "The first time, it searches like A*, using the hint toward the goal, and remembers the cost of reaching each intersection.",
      "Each intersection holds two values: the cost it currently knows, and a cost freshly computed from its incoming roads. If they match, the intersection is consistent.",
      "When a road becomes congested or closed, the value at the end of that road no longer matches. Only inconsistent intersections enter the queue, and the search recomputes only as far as the inconsistency spreads.",
    ],
    good: [
      "When a change is small, it revisits far fewer intersections than A* starting over.",
      "Even after recomputing, it always finds the shortest (fastest) path.",
    ],
    bad: [
      "It uses more memory because each intersection stores more values.",
      "If the start moves (the car is driving), its memory is hard to reuse directly. D* Lite, used in robot path planning, addresses this.",
      "If the change is near the start or very large, the work approaches that of a fresh search.",
    ],
  },
};

export default function AlgorithmsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Algorithms</h1>
        <p className="muted text-sm mt-1">
          How the five routing methods find a path, with a step-by-step simulation on a tiny made-up map of 8 intersections. Numbers are road lengths in
          meters, and the route goes from S to T.
        </p>
        <nav className="tabs mt-3" aria-label="Jump to an algorithm">
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
                    Strengths
                  </div>
                  <ul>
                    {x.good.map((t, k) => (
                      <li key={k}>{t}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--bad)" }}>
                    Weaknesses
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
