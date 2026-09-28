// Supplemental batch timing for very short synthetic searches. Never replaces single-run results.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { graphSignature, syntheticGraph } from "../../src/lib/study/finalGraph.ts";
import { edgeCosts, finalSearch, prepareHeuristic, type FinalAlgorithm } from "../../src/lib/study/finalSearch.ts";
import { csvLine } from "../../src/lib/study/summary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputFlag = process.argv.indexOf("--output-id");
const outputId = outputFlag >= 0 ? process.argv[outputFlag + 1] : "final-v4";
if (!outputId || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(outputId)) throw new Error("invalid --output-id");
const resultDir = path.join(root, "results", outputId);
const publicDir = path.join(root, "public/study", outputId);
const csvPath = path.join(resultDir, "batch_measurements.csv");
const jsonPath = path.join(publicDir, "batch_measurements.json");
if (existsSync(csvPath) || existsSync(jsonPath)) throw new Error("batch results already exist; choose a new output ID");
const configText = readFileSync(path.join(root, "configs/final-study.json"), "utf8");
const config = JSON.parse(configText);
const sha = (data: unknown) => createHash("sha256").update(typeof data === "string" ? data : JSON.stringify(data)).digest("hex");
const configHash = sha(configText.replace(/\r\n/g, "\n"));
const batches = 10, iterations = 1000;
const rows: { config_sha256: string; graph_sha256: string; size_label: string; algorithm: FinalAlgorithm;
  batch: number; iterations: number; total_ns: number; mean_ns: number }[] = [];
for (const n of [4, 6, 8]) {
  const graph = syntheticGraph(n, config.seed, config.synthetic.extra_edge_probability);
  const graphHash = sha(graphSignature(graph));
  const scenario = { id: "normal" }, costs = edgeCosts(graph, "distance", scenario);
  const h = prepareHeuristic(graph, graph, "distance", scenario);
  for (const algorithm of ["dfs", "dijkstra", "astar"] as FinalAlgorithm[]) {
    const options = { timeLimitMs: config.run.dfs_time_limit_ms, heuristicScale: h.scale };
    for (let i = 0; i < 100; i++) finalSearch(graph, 0, n - 1, costs, algorithm, options);
    for (let batch = 1; batch <= batches; batch++) {
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) finalSearch(graph, 0, n - 1, costs, algorithm, options);
      const totalNs = Math.round((performance.now() - t0) * 1e6);
      rows.push({ config_sha256: configHash, graph_sha256: graphHash, size_label: `n${n}`, algorithm,
        batch, iterations, total_ns: totalNs, mean_ns: totalNs / iterations });
    }
  }
}
mkdirSync(resultDir, { recursive: true }); mkdirSync(publicDir, { recursive: true });
const columns = Object.keys(rows[0]) as (keyof typeof rows[number])[];
writeFileSync(csvPath, [columns.join(","), ...rows.map((row) => csvLine(row, columns))].join("\n") + "\n");
writeFileSync(jsonPath, JSON.stringify({ method: "10 batches of 1000 searches after 100 warmups; mean per search includes loop overhead; not a single-run median", rows }));
console.log(`[final-study] ${rows.length} supplemental batch measurements in ${path.relative(root, csvPath)}`);
