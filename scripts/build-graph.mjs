// OSM(Overpass API)에서 도로/보행 네트워크를 받아 알고리즘용 그래프 JSON을 만든다.
//   node scripts/build-graph.mjs            (캐시가 있으면 재사용)
//   node scripts/build-graph.mjs --refresh  (Overpass에서 다시 다운로드)
// 결과: public/graph/car.json, public/graph/walk.json
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "scripts", ".cache", "osm.json");
const OUT_DIR = path.join(ROOT, "public", "graph");

// 고려대 세종캠퍼스 ~ 조치원역을 여유 있게 감싸는 영역 (south, west, north, east)
const BBOX = [36.595, 127.28, 36.616, 127.303];

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const CAR_HIGHWAYS = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
  "residential", "living_street", "service",
]);
const CAR_EXCLUDED_SERVICE = new Set(["parking_aisle", "driveway", "drive-through", "emergency_access"]);

const WALK_HIGHWAYS = new Set([
  "footway", "pedestrian", "path", "steps", "living_street", "residential", "service",
  "unclassified", "track", "cycleway", "tertiary", "tertiary_link", "corridor", "elevator",
]);
// 간선도로 중심선은 보도가 태깅된 경우에만 보행 가능으로 본다 (보도는 대부분 별도 way로 그려져 있음)
const WALK_MAJOR = new Set(["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);

const YES = new Set(["yes", "designated", "permissive"]);
const NO = new Set(["no", "private"]);

async function download() {
  const [s, w, n, e] = BBOX;
  const query = `[out:json][timeout:180];(way["highway"](${s},${w},${n},${e});>;);out body;`;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of MIRRORS) {
      try {
        console.log(`[osm] 다운로드 시도: ${url}`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "User-Agent": "route-lab/0.1 (student project)", "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
        });
        const text = await res.text();
        if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
        return JSON.parse(text);
      } catch (err) {
        console.warn(`[osm] 실패: ${err.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error("모든 Overpass 서버에서 다운로드 실패");
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function carDirection(tags) {
  const hw = tags.highway;
  if (!CAR_HIGHWAYS.has(hw)) return null;
  if (hw === "service" && CAR_EXCLUDED_SERVICE.has(tags.service)) return null;
  const vehicleOk = YES.has(tags.motor_vehicle) || YES.has(tags.motorcar);
  if (!vehicleOk && (NO.has(tags.access) || NO.has(tags.motor_vehicle) || NO.has(tags.motorcar))) return null;
  if (tags.area === "yes") return null;
  const oneway = tags.oneway;
  if (oneway === "-1") return "backward";
  if (oneway === "yes" || oneway === "1" || oneway === "true") return "forward";
  if (tags.junction === "roundabout" && oneway !== "no") return "forward";
  if (hw === "motorway" && oneway !== "no") return "forward";
  return "both";
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

/** 방향 간선 목록에서 가장 큰 강연결요소(SCC)에 속한 노드 집합을 구한다 (Kosaraju, 반복 구현). */
function largestScc(nodeCount, edges) {
  const out = Array.from({ length: nodeCount }, () => []);
  const inn = Array.from({ length: nodeCount }, () => []);
  for (const [a, b] of edges) { out[a].push(b); inn[b].push(a); }
  const visited = new Uint8Array(nodeCount);
  const order = [];
  for (let s = 0; s < nodeCount; s++) {
    if (visited[s]) continue;
    const stack = [[s, 0]];
    visited[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, i] = top;
      if (i < out[v].length) {
        top[1]++;
        const w = out[v][i];
        if (!visited[w]) { visited[w] = 1; stack.push([w, 0]); }
      } else {
        order.push(v);
        stack.pop();
      }
    }
  }
  const comp = new Int32Array(nodeCount).fill(-1);
  const sizes = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const s = order[k];
    if (comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const v = stack.pop();
      size++;
      for (const w of inn[v]) if (comp[w] === -1) { comp[w] = id; stack.push(w); }
    }
    sizes.push(size);
  }
  const best = sizes.indexOf(Math.max(...sizes));
  return (v) => comp[v] === best;
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
