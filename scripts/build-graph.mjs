// OSM(Overpass API)에서 도로/보행 네트워크를 받아 알고리즘용 그래프 JSON을 만든다.
//   node scripts/build-graph.mjs            (캐시가 있으면 재사용)
//   node scripts/build-graph.mjs --refresh  (Overpass에서 다시 다운로드)
// 결과: public/graph/car.json, public/graph/walk.json
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carDirection, haversine, largestScc, NO, overpass, YES } from "./osm-common.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "scripts", ".cache", "osm.json");
const OUT_DIR = path.join(ROOT, "public", "graph");

// 고려대 세종캠퍼스 ~ 조치원역을 여유 있게 감싸는 영역 (south, west, north, east)
const BBOX = [36.595, 127.28, 36.616, 127.303];

const WALK_HIGHWAYS = new Set([
  "footway", "pedestrian", "path", "steps", "living_street", "residential", "service",
  "unclassified", "track", "cycleway", "tertiary", "tertiary_link", "corridor", "elevator",
]);
// 간선도로 중심선은 보도가 태깅된 경우에만 보행 가능으로 본다 (보도는 대부분 별도 way로 그려져 있음)
const WALK_MAJOR = new Set(["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);

async function download() {
  const [s, w, n, e] = BBOX;
  return JSON.parse(await overpass(`[out:json][timeout:180];(way["highway"](${s},${w},${n},${e});>;);out body;`));
}

function walkable(tags) {
  const hw = tags.highway;
  if (NO.has(tags.foot) || (NO.has(tags.access) && !YES.has(tags.foot))) return false;
  if (WALK_HIGHWAYS.has(hw)) return true;
  if (WALK_MAJOR.has(hw)) {
    const sw = tags.sidewalk ?? tags["sidewalk:both"];
    return YES.has(tags.foot) || ["both", "left", "right", "yes"].includes(sw);
  }
  return false;
}

function isCrossingWay(tags) {
  return tags.footway === "crossing" || tags.cycleway === "crossing" || tags.path === "crossing";
}

function buildGraph(mode, osm) {
  const nodes = new Map();
  for (const el of osm.elements) if (el.type === "node") nodes.set(el.id, el);

  const osmToIdx = new Map();
  const idxToOsm = [];
  const idx = (osmId) => {
    let i = osmToIdx.get(osmId);
    if (i === undefined) { i = idxToOsm.length; osmToIdx.set(osmId, i); idxToOsm.push(osmId); }
    return i;
  };

  // edge: [from, to, lengthM, crossingWayId(-1)]
  const edges = [];
  const crossingLen = []; // 횡단보도 way별 총 길이 (페널티를 길이 비율로 나누기 위해)
  const majorNeighbors = new Map(); // 자동차: 교차로 판정용 (service 도로 제외)

  for (const way of osm.elements) {
    if (way.type !== "way" || !way.tags) continue;
    const tags = way.tags;
    let dir;
    if (mode === "car") dir = carDirection(tags);
    else dir = walkable(tags) ? "both" : null;
    if (!dir) continue;

    const refs = way.nodes.filter((id) => nodes.has(id));
    if (refs.length < 2) continue;

    let crossingId = -1;
    if (mode === "walk" && isCrossingWay(tags)) { crossingId = crossingLen.length; crossingLen.push(0); }

    for (let k = 0; k + 1 < refs.length; k++) {
      const a = nodes.get(refs[k]);
      const b = nodes.get(refs[k + 1]);
      const len = haversine(a.lat, a.lon, b.lat, b.lon);
      if (len === 0) continue;
      const ia = idx(a.id);
      const ib = idx(b.id);
      if (crossingId >= 0) crossingLen[crossingId] += len;
      if (dir === "both" || dir === "forward") edges.push([ia, ib, len, crossingId]);
      if (dir === "both" || dir === "backward") edges.push([ib, ia, len, crossingId]);
      if (mode === "car" && tags.highway !== "service") {
        if (!majorNeighbors.has(ia)) majorNeighbors.set(ia, new Set());
        if (!majorNeighbors.has(ib)) majorNeighbors.set(ib, new Set());
        majorNeighbors.get(ia).add(ib);
        majorNeighbors.get(ib).add(ia);
      }
    }
  }

  const keep = largestScc(idxToOsm.length, edges);
  const remap = new Int32Array(idxToOsm.length).fill(-1);
  const lat = [];
  const lng = [];
  for (let i = 0; i < idxToOsm.length; i++) {
    if (!keep(i)) continue;
    remap[i] = lat.length;
    const n = nodes.get(idxToOsm[i]);
    lat.push(+n.lat.toFixed(7));
    lng.push(+n.lon.toFixed(7));

  }

  const from = [], to = [], len = [], crossing = [];
  for (const [a, b, l, c] of edges) {
    if (remap[a] < 0 || remap[b] < 0) continue;
    from.push(remap[a]); to.push(remap[b]); len.push(+l.toFixed(2)); crossing.push(c);
  }

  const graph = {
    mode,
    source: "© OpenStreetMap contributors (ODbL)",
    generatedAt: new Date().toISOString(),
    osmTimestamp: osm.osm3s?.timestamp_osm_base ?? null,
    bbox: BBOX,
    nodeCount: lat.length,
    edgeCount: from.length,
    lat, lng,
    from, to, len,
  };

  if (mode === "car") {
    // 교차로: service를 제외한 도로 기준으로 3방향 이상 연결된 노드 + 신호등 노드
    const intersections = [];
    for (let i = 0; i < idxToOsm.length; i++) {
      if (remap[i] < 0) continue;
      const deg = majorNeighbors.get(i)?.size ?? 0;
      const signal = nodes.get(idxToOsm[i]).tags?.highway === "traffic_signals";
      if (deg >= 3 || signal) intersections.push(remap[i]);
    }
    graph.intersections = intersections;
  } else {
    graph.crossing = crossing;
    graph.crossingLen = crossingLen.map((l) => +l.toFixed(2));
  }
  return graph;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  let osm;
  if (!refresh && existsSync(CACHE)) {
    console.log(`[osm] 캐시 사용: ${path.relative(ROOT, CACHE)}`);
    osm = JSON.parse(await readFile(CACHE, "utf8"));
  } else {
    osm = await download();
    await mkdir(path.dirname(CACHE), { recursive: true });
    await writeFile(CACHE, JSON.stringify(osm));
  }
  await mkdir(OUT_DIR, { recursive: true });
  for (const mode of ["car", "walk"]) {
    const g = buildGraph(mode, osm);
    await writeFile(path.join(OUT_DIR, `${mode}.json`), JSON.stringify(g));
    const extra = mode === "car" ? `교차로 ${g.intersections.length}` : `횡단보도 ${g.crossingLen.length}`;
    console.log(`[graph] ${mode}: 노드 ${g.nodeCount}, 간선 ${g.edgeCount}, ${extra}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
