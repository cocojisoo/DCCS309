// Build the version 3 directed road multigraph. Legacy study files are untouched.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carDirection, haversine, overpass } from "../osm-common.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configPath = path.join(root, "configs/final-study.json");
const cachePath = path.join(root, "scripts/.cache/osm-final-study.json");
const outputPath = path.join(root, "public/study/final/road.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

function bboxAround(lat, lon, halfWidthM) {
  const dy = halfWidthM / 111195;
  const dx = halfWidthM / (111195 * Math.cos(lat * Math.PI / 180));
  return [lat - dy, lon - dx, lat + dy, lon + dx];
}

function parseSpeed(raw) {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(km\/h|kmh|kph|mph)?$/i);
  if (!match) return null;
  const speed = Number(match[1]) * (match[2]?.toLowerCase() === "mph" ? 1.609344 : 1);
  return speed > 0 && Number.isFinite(speed) ? speed : null;
}

function speedFor(tags, direction, defaults) {
  const directional = direction === "backward" ? tags["maxspeed:backward"] : tags["maxspeed:forward"];
  const osmSpeed = parseSpeed(directional) ?? parseSpeed(tags.maxspeed);
  return { speedKph: osmSpeed ?? defaults[tags.highway] ?? defaults.fallback, source: osmSpeed ? "osm" : "fallback" };
}

function build(osm, config) {
  const points = new Map(osm.elements.filter((e) => e.type === "node").map((e) => [e.id, [e.lat, e.lon]]));
  const segments = [];
  const allNodes = new Set();
  let carWays = 0;
  for (const way of osm.elements) {
    if (way.type !== "way" || !way.tags) continue;
    const allowed = carDirection(way.tags);
    if (!allowed) continue;
    carWays++;
    const refs = way.nodes.filter((id) => points.has(id));
    for (let i = 0; i + 1 < refs.length; i++) {
      const a = refs[i], b = refs[i + 1];
      if (a === b) continue;
      const [alat, alon] = points.get(a), [blat, blon] = points.get(b);
      const lengthM = haversine(alat, alon, blat, blon);
      if (!(lengthM > 0)) continue;
      const add = (from, to, direction) => {
        const speed = speedFor(way.tags, direction, config.speed_kph);
        segments.push({ from, to, wayId: way.id, highway: way.tags.highway, ...speed,
          lengthM, freeFlowS: lengthM * 3.6 / speed.speedKph });
        allNodes.add(from); allNodes.add(to);
      };
      if (allowed !== "backward") add(a, b, "forward");
      if (allowed !== "forward") add(b, a, "backward");
    }
  }
  const out = new Map(), inn = new Map();
  for (let i = 0; i < segments.length; i++) {
    const e = segments[i];
    if (!out.has(e.from)) out.set(e.from, []);
    if (!inn.has(e.to)) inn.set(e.to, []);
    out.get(e.from).push(i); inn.get(e.to).push(i);
  }
  // A continuation is safe only when there is exactly one non-reversing choice.
  const endpoints = new Set();
  for (const v of allNodes) {
    const outgoing = out.get(v) ?? [], incoming = inn.get(v) ?? [];
    const neighbors = new Set([...outgoing.map((i) => segments[i].to), ...incoming.map((i) => segments[i].from)]);
    if (neighbors.size !== 2 || outgoing.length === 0 || incoming.length === 0 ||
      outgoing.length > 2 || incoming.length > 2) endpoints.add(v);
  }
  // Closed rings without a junction need an anchor so every segment is represented.
  if (endpoints.size === 0 && allNodes.size) endpoints.add(Math.min(...allNodes));
  const merged = [];
  const seen = new Set();
  const traverse = (first) => {
    if (seen.has(first)) return;
    const chain = [first];
    let cur = first;
    while (chain.length <= segments.length) {
      seen.add(cur);
      const at = segments[cur].to;
      if (endpoints.has(at)) break;
      const choices = (out.get(at) ?? []).filter((i) => segments[i].to !== segments[cur].from);
      if (choices.length !== 1 || seen.has(choices[0])) { endpoints.add(at); break; }
      cur = choices[0];
      chain.push(cur);
    }
    const firstSegment = segments[chain[0]], lastSegment = segments[chain.at(-1)];
    merged.push({ from: firstSegment.from, to: lastSegment.to, chain,
      lengthM: chain.reduce((sum, i) => sum + segments[i].lengthM, 0),
      freeFlowS: chain.reduce((sum, i) => sum + segments[i].freeFlowS, 0) });
  };
  for (const v of [...endpoints].sort((a, b) => a - b)) for (const i of out.get(v) ?? []) traverse(i);
  for (let i = 0; i < segments.length; i++) if (!seen.has(i)) traverse(i);
  const kept = merged.filter((e) => e.from !== e.to && e.lengthM > 0);
  kept.sort((a, b) => a.from - b.from || a.to - b.to || a.chain[0] - b.chain[0]);
  const nodeIds = [...new Set(kept.flatMap((e) => [e.from, e.to]))].sort((a, b) => a - b);
  const local = new Map(nodeIds.map((id, i) => [id, i]));
  const pairKeys = new Map();
  const graph = { lat: nodeIds.map((id) => round(points.get(id)[0], 7)),
    lng: nodeIds.map((id) => round(points.get(id)[1], 7)), osmNodeId: nodeIds,
    from: [], to: [], key: [], edgeId: [], len: [], freeFlowS: [], speedKph: [], speedSource: [],
    highway: [], osmWayIds: [], geomStart: [0], geom: [] };
  for (const e of kept) {
    const from = local.get(e.from), to = local.get(e.to);
    const pair = `${from}:${to}`;
    const key = pairKeys.get(pair) ?? 0;
    pairKeys.set(pair, key + 1);
    graph.from.push(from); graph.to.push(to); graph.key.push(key); graph.edgeId.push(`${from}:${to}:${key}`);
    graph.len.push(e.lengthM); graph.freeFlowS.push(e.freeFlowS);
    graph.speedKph.push(e.lengthM * 3.6 / e.freeFlowS);
    graph.speedSource.push(e.chain.every((i) => segments[i].source === "osm") ? "osm" : "fallback");
    graph.highway.push([...new Set(e.chain.map((i) => segments[i].highway))].join(";"));
    graph.osmWayIds.push([...new Set(e.chain.map((i) => segments[i].wayId))]);
    for (let i = 0; i + 1 < e.chain.length; i++) {
      const [lat, lon] = points.get(segments[e.chain[i]].to);
      graph.geom.push(round(lat, 6), round(lon, 6));
    }
    graph.geomStart.push(graph.geom.length);
  }
  const parallelPairs = [...pairKeys.values()].filter((count) => count > 1).length;
  return { graph, counts: { carWays, osmPoints: allNodes.size, intersections: nodeIds.length,
    directedSegments: segments.length, mergedEdges: merged.length, selfLoopsRemoved: merged.length - kept.length,
    parallelPairs, edges: kept.length } };
}

async function main() {
  if (existsSync(outputPath)) throw new Error("saved road graph already exists; use a new versioned path for a new OSM snapshot");
  if (existsSync(cachePath) && process.argv.includes("--refresh"))
    throw new Error("saved OSM source already exists; preserve it before requesting a fresh snapshot");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const bbox = bboxAround(config.map.center_lat, config.map.center_lon, config.map.bbox_half_width_m);
  let sourceText, downloadedAt = null;
  if (existsSync(cachePath)) sourceText = await readFile(cachePath, "utf8");
  else {
    const [south, west, north, east] = bbox;
    const hw = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service";
    sourceText = await overpass(`[out:json][timeout:300];(way["highway"~"^(${hw})$"](${south},${west},${north},${east});>;);out body;`);
    downloadedAt = new Date().toISOString();
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, sourceText);
  }
  sourceText = sourceText.replace(/\r\n/g, "\n");
  const osm = JSON.parse(sourceText);
  const { graph, counts } = build(osm, config);
  const result = { meta: { source: "© OpenStreetMap contributors (ODbL)", generatedAt: new Date().toISOString(),
    downloadedAt, osmTimestamp: osm.osm3s?.timestamp_osm_base ?? null, osmSha256: sha256(sourceText),
    center: [config.map.center_lat, config.map.center_lon], halfWidthM: config.map.bbox_half_width_m,
    bbox, network: "drive", counts }, ...graph };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result));
  console.log(`[final-study] ${counts.intersections} nodes, ${counts.edges} directed edges, ${counts.parallelPairs} parallel pairs`);
  console.log(`[final-study] OSM ${result.meta.osmTimestamp ?? "unknown"}; SHA-256 ${result.meta.osmSha256}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
