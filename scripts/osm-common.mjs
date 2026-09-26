// build-graph.mjs 와 build-study-graph.mjs 가 함께 쓰는 OSM 처리 함수
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export const CAR_HIGHWAYS = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
  "residential", "living_street", "service",
]);
const CAR_EXCLUDED_SERVICE = new Set(["parking_aisle", "driveway", "drive-through", "emergency_access"]);

export const YES = new Set(["yes", "designated", "permissive"]);
export const NO = new Set(["no", "private"]);

/** Overpass 쿼리를 미러 서버를 돌아가며 실행한다. 실패하면 점점 길게 기다렸다가 다시 시도한다. */
export async function overpass(query) {
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
        return text;
      } catch (err) {
        console.warn(`[osm] 실패: ${err.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 30000 * (attempt + 1)));
  }
  throw new Error("모든 Overpass 서버에서 다운로드 실패");
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 자동차 통행 방향: "forward" | "backward" | "both" | null(통행 불가) */
export function carDirection(tags) {
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

/** 방향 간선 목록에서 가장 큰 강연결요소(SCC)에 속한 노드 집합을 구한다 (Kosaraju, 반복 구현). */
export function largestScc(nodeCount, edges) {
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
