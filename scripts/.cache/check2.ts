import { readFileSync } from "node:fs";
import { toGraph, nearestNode } from "../../src/lib/graph";
import { runAlgorithm } from "../../src/lib/algorithms";
import { START, END, speedMps } from "../../src/lib/config";
const osm = JSON.parse(readFileSync("scripts/.cache/osm.json","utf8"));
const nodes = new Map(); for (const e of osm.elements) if (e.type==="node") nodes.set(`${e.lat.toFixed(7)*1},${e.lon.toFixed(7)*1}`, e.id);
const pairWay = new Map();
for (const w of osm.elements) if (w.type==="way") for (let i=1;i<w.nodes.length;i++){pairWay.set(w.nodes[i-1]+"-"+w.nodes[i],w);pairWay.set(w.nodes[i]+"-"+w.nodes[i-1],w);}
const g = toGraph(JSON.parse(readFileSync(`public/graph/walk.json`, "utf8")));
const s = nearestNode(g, START.lat, START.lng), t = nearestNode(g, END.lat, END.lng);
const r = runAlgorithm("dijkstra", g, { source: s.node, target: t.node, speed: speedMps("walk"), penalties: true, record: false });
const agg = new Map(); let prev = "";
for (const e of r.pathEdges) {
  const a = nodes.get(`${g.lat[g.from[e]]},${g.lng[g.from[e]]}`), b = nodes.get(`${g.lat[g.to[e]]},${g.lng[g.to[e]]}`);
  const w = pairWay.get(a+"-"+b); const k = w ? `${w.tags.highway}${w.tags.footway?"/"+w.tags.footway:""} ${w.tags.name??""}` : "?";
  agg.set(k,(agg.get(k)||0)+g.len[e]);
  if (k!==prev) { process.stdout.write(`-> ${k} `); prev=k; }
}
console.log("\n", [...agg].map(([k,v])=>`${k}: ${v.toFixed(0)}m`).join("\n "));
