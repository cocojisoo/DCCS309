import { astarSearch, dijkstraSearch } from "./bestFirst.ts";
import { dfsSearch } from "./dfs.ts";
import type { PathFinder, StudyAlgorithmId } from "./search.ts";

export const FINDERS: Record<StudyAlgorithmId, PathFinder> = {
  dfs: dfsSearch,
  dijkstra: dijkstraSearch,
  astar: astarSearch,
};
