import { astarSearch, dijkstraSearch } from "./bestFirst.ts";
import { cchSearch } from "./cch.ts";
import { dfsSearch } from "./dfs.ts";
import { lpaSearch } from "./lpa.ts";
import type { PathFinder, StudyAlgorithmId } from "./search.ts";

export const FINDERS: Record<StudyAlgorithmId, PathFinder> = {
  dfs: dfsSearch,
  dijkstra: dijkstraSearch,
  astar: astarSearch,
  cch: cchSearch,
  lpa: lpaSearch,
};
