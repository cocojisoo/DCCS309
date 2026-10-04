import { buildStudyGraph, type StudyGraph } from "./graph.ts";

/**
 * 화면 1 "알고리즘 교실"용 손으로 만든 작은 지도 (PROJECT_BLUEPRINT 9절).
 * 좌표 단위는 m 이고, 도로 길이는 항상 두 교차로 사이 직선거리보다 길게 정했다 (A* 힌트가 안전하도록).
 * 정답: S → A → D → F → T (605m)
 * W 는 출발점 뒤쪽 골목이다. 다익스트라는 가까우니 확정하지만, A* 는 도착점 반대쪽이라 보지 않는다.
 */
export const CLASSROOM_NODES = [
  { name: "S", x: 110, y: 150 },
  { name: "W", x: 30, y: 270 },
  { name: "A", x: 230, y: 240 },
  { name: "B", x: 230, y: 60 },
  { name: "C", x: 370, y: 150 },
  { name: "D", x: 370, y: 260 },
  { name: "F", x: 510, y: 220 },
  { name: "T", x: 620, y: 150 },
];

/** 양방향 도로 [a, b, 길이]. DFS 는 이 순서대로 갈림길을 고르므로 아래쪽(B)부터 가 본다 */
export const CLASSROOM_ROADS: [string, string, number][] = [
  ["S", "B", 165],
  ["S", "A", 155],
  ["S", "W", 150],
  ["W", "A", 210],
  ["B", "C", 175],
  ["A", "C", 180],
  ["A", "D", 150],
  ["C", "F", 170],
  ["D", "F", 160],
  ["F", "T", 140],
];

/** LPA* 교실에서 경로를 찾은 뒤 혼잡해지는 도로와 배율 (정답 경로 위의 D–F) */
export const CLASSROOM_JAM: { a: string; b: string; factor: number } = { a: "D", b: "F", factor: 3 };

export const CLASSROOM_SOURCE = 0;
export const CLASSROOM_TARGET = CLASSROOM_NODES.length - 1;

export function classroomGraph(): StudyGraph {
  const id = (name: string) => CLASSROOM_NODES.findIndex((n) => n.name === name);
  const from: number[] = [];
  const to: number[] = [];
  const len: number[] = [];
  for (const [a, b, l] of CLASSROOM_ROADS) {
    from.push(id(a), id(b));
    to.push(id(b), id(a));
    len.push(l, l);
  }
  return buildStudyGraph({
    lat: CLASSROOM_NODES.map((n) => n.y),
    lng: CLASSROOM_NODES.map((n) => n.x),
    x: CLASSROOM_NODES.map((n) => n.x),
    y: CLASSROOM_NODES.map((n) => n.y),
    from,
    to,
    len,
  });
}
