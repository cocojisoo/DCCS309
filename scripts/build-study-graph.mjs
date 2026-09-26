// 실험용 조치원 차량 도로 지도를 만든다 (PROJECT_BLUEPRINT 6절).
//   node scripts/build-study-graph.mjs            (캐시가 있으면 재사용)
//   node scripts/build-study-graph.mjs --refresh  (Overpass에서 다시 다운로드)
// 결과: public/graph/study.json
//  - 중심(configs/study.json)에서 사방 bbox_half_width_m 사각형의 차량 도로
//  - 교차로(끝점)만 노드로 남기고 그 사이의 굽은 도로는 간선 하나로 합친다 (OSMnx simplify 와 같은 규칙)
//  - 일방통행 방향 유지, 자기 자신으로 돌아오는 간선 제거, 같은 두 교차로 사이 간선은 가장 짧은 것 하나만 남김
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carDirection, haversine, overpass } from "./osm-common.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "configs", "study.json");
const CACHE = path.join(ROOT, "scripts", ".cache", "osm-study.json");
const OUT = path.join(ROOT, "public", "graph", "study.json");

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function bboxAround(lat, lon, half) {
  const dLat = half / 111195;
  const dLon = half / (111195 * Math.cos((lat * Math.PI) / 180));
  return [round(lat - dLat, 6), round(lon - dLon, 6), round(lat + dLat, 6), round(lon + dLon, 6)];
}

async function loadOsm(bbox, refresh) {
  if (!refresh && existsSync(CACHE)) {
    console.log(`[osm] 캐시 사용: ${path.relative(ROOT, CACHE)}`);
    return { text: await readFile(CACHE, "utf8"), downloadedAt: null };
  }
  const [s, w, n, e] = bbox;
  const hw = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service";
  const text = await overpass(`[out:json][timeout:300];(way["highway"~"^(${hw})$"](${s},${w},${n},${e});>;);out body;`);
  await mkdir(path.dirname(CACHE), { recursive: true });
  await writeFile(CACHE, text);
  return { text, downloadedAt: new Date().toISOString() };
}

function build(osm) {
  const nodes = new Map();
  for (const el of osm.elements) if (el.type === "node") nodes.set(el.id, { lat: round(el.lat, 7), lon: round(el.lon, 7) });

  // 1) OSM 점 사이의 방향 조각(segment) 목록
  const idxOf = new Map();
  const osmIds = [];
  const idx = (id) => {
    let i = idxOf.get(id);
    if (i === undefined) { i = osmIds.length; idxOf.set(id, i); osmIds.push(id); }
    return i;
  };
  const segFrom = [], segTo = [];
  let rawWays = 0;
  for (const way of osm.elements) {
    if (way.type !== "way" || !way.tags) continue;
    const dir = carDirection(way.tags);
    if (!dir) continue;
    rawWays++;
    const refs = way.nodes.filter((id) => nodes.has(id));
    for (let k = 0; k + 1 < refs.length; k++) {
      if (refs[k] === refs[k + 1]) continue;
      const a = idx(refs[k]), b = idx(refs[k + 1]);
      if (dir !== "backward") { segFrom.push(a); segTo.push(b); }
      if (dir !== "forward") { segFrom.push(b); segTo.push(a); }
    }
  }
  const N = osmIds.length;
  const out = Array.from({ length: N }, () => []);
  const inn = Array.from({ length: N }, () => []);
  // 같은 방향 조각이 두 way 에 겹쳐 있으면 하나로 본다
  const seen = new Set();
  for (let s = 0; s < segFrom.length; s++) {
    const key = segFrom[s] * N + segTo[s];
    if (seen.has(key)) continue;
    seen.add(key);
    out[segFrom[s]].push(segTo[s]);
    inn[segTo[s]].push(segFrom[s]);
  }

  // 2) 끝점(교차로) 판정: OSMnx simplify 규칙
  const isEndpoint = new Uint8Array(N);
  for (let v = 0; v < N; v++) {
    const nb = new Set([...out[v], ...inn[v]]);
    const deg = out[v].length + inn[v].length;
    if (nb.has(v) || out[v].length === 0 || inn[v].length === 0) isEndpoint[v] = 1;
    else if (!(nb.size === 2 && (deg === 2 || deg === 4))) isEndpoint[v] = 1;
  }

  // 3) 끝점에서 다음 끝점까지 조각을 이어 붙여 간선 하나로 만든다
  const merged = [];
  for (let u = 0; u < N; u++) {
    if (!isEndpoint[u]) continue;
    for (const first of out[u]) {
      const chain = [u, first];
      let prev = u, v = first;
      while (!isEndpoint[v]) {
        const next = out[v].find((w) => w !== prev);
        if (next === undefined || chain.length > N) break;
        chain.push(next);
        prev = v;
        v = next;
      }
      if (!isEndpoint[v]) continue;
      let len = 0;
      for (let k = 1; k < chain.length; k++) {
        const a = nodes.get(osmIds[chain[k - 1]]), b = nodes.get(osmIds[chain[k]]);
        len += haversine(a.lat, a.lon, b.lat, b.lon);
      }
      merged.push({ from: u, to: v, len, chain });
    }
  }

  // 4) 자기 자신으로 돌아오는 간선 제거, 같은 두 교차로 사이에는 가장 짧은 간선만
  let selfLoops = 0, zeroLength = 0;
  const bestByPair = new Map();
  for (const e of merged) {
    if (e.from === e.to) { selfLoops++; continue; }
    if (!(e.len > 0)) { zeroLength++; continue; }
    const key = e.from * N + e.to;
    const cur = bestByPair.get(key);
    if (!cur || e.len < cur.len) bestByPair.set(key, e);
  }
  const edges = [...bestByPair.values()];
  const parallelRemoved = merged.length - selfLoops - zeroLength - edges.length;

  const remap = new Map();
  const lat = [], lng = [];
  const nodeIdx = (v) => {
    let i = remap.get(v);
    if (i === undefined) {
      i = lat.length;
      remap.set(v, i);
      const p = nodes.get(osmIds[v]);
      lat.push(p.lat);
      lng.push(p.lon);
    }
    return i;
  };
  const from = [], to = [], len = [], geomStart = [0], geom = [];
  for (const e of edges) {
    from.push(nodeIdx(e.from));
    to.push(nodeIdx(e.to));
    len.push(e.len);
    for (let k = 1; k + 1 < e.chain.length; k++) {
      const p = nodes.get(osmIds[e.chain[k]]);
      geom.push(round(p.lat, 6), round(p.lon, 6));
    }
    geomStart.push(geom.length);
  }
  return {
    lat, lng, from, to, len, geomStart, geom,
    counts: {
      carWays: rawWays,
      osmPoints: N,
      intersections: lat.length,
      edgesBeforeCleanup: merged.length,
      selfLoopsRemoved: selfLoops,
      zeroLengthRemoved: zeroLength,
      parallelRemoved,
      edges: edges.length,
    },
  };
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const config = JSON.parse(await readFile(CONFIG, "utf8"));
  const { center_lat: lat, center_lon: lon, bbox_half_width_m: half } = config.map;
  const bbox = bboxAround(lat, lon, half);
  const { text, downloadedAt } = await loadOsm(bbox, refresh);
  const osm = JSON.parse(text);
  const g = build(osm);
  const graph = {
    meta: {
      source: "© OpenStreetMap contributors (ODbL)",
      generatedAt: new Date().toISOString(),
      downloadedAt,
      osmTimestamp: osm.osm3s?.timestamp_osm_base ?? null,
      osmSha256: createHash("sha256").update(text).digest("hex"),
      center: [lat, lon],
      halfWidthM: half,
      bbox,
      network: "drive",
      counts: g.counts,
    },
    lat: g.lat, lng: g.lng,
    from: g.from, to: g.to, len: g.len,
    geomStart: g.geomStart, geom: g.geom,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(graph));
  const c = g.counts;
  console.log(`[study] 교차로 ${c.intersections}, 도로 ${c.edges} (자기루프 ${c.selfLoopsRemoved}, 평행 도로 ${c.parallelRemoved}, 길이 0 ${c.zeroLengthRemoved} 제거)`);
  console.log(`[study] ${path.relative(ROOT, OUT)} 저장, OSM 해시 ${graph.meta.osmSha256.slice(0, 12)}…`);
}

main().catch((err) => { console.error(err); process.exit(1); });
