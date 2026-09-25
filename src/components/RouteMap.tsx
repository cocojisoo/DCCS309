"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { END, START } from "@/lib/config";
import type { LatLng } from "@/lib/geo";

export interface ExploredLayer {
  color: string;
  /** 탐색 트리 간선들 (탐색 순서대로) */
  segments: [LatLng, LatLng][];
}

export interface PathLayer {
  color: string;
  points: LatLng[];
  label: string;
  dash?: string;
  weight?: number;
}

interface Props {
  explored?: ExploredLayer[];
  paths: PathLayer[];
  /** 값이 바뀔 때마다 탐색 애니메이션을 처음부터 다시 재생한다 */
  animationKey?: string;
  durationMs?: number;
}

/** CSS 변수(var(--car) 등)를 실제 색으로 바꾼다. Leaflet 캔버스는 CSS 변수를 이해하지 못한다. */
function resolveColor(c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  if (!m) return c;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888";
}

export default function RouteMap({ explored = [], paths, animationKey, durationMs = 2500 }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const renderer = L.canvas({ padding: 0.3 });
    const map = L.map(boxRef.current, { renderer, preferCanvas: true }).fitBounds(
      L.latLngBounds([START.lat, START.lng], [END.lat, END.lng]).pad(0.35),
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    for (const p of [START, END]) {
      L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#0b0b0b", fillOpacity: 1 })
        .bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -8] })
        .addTo(map);
    }
    groupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    let raf = 0;
    let cancelled = false;

    const drawPaths = () => {
      for (const p of paths) {
        if (p.points.length < 2) continue;
        const color = resolveColor(p.color);
        L.polyline(p.points, { color: "#ffffff", weight: (p.weight ?? 5) + 3, opacity: 0.9 }).addTo(group);
        L.polyline(p.points, { color, weight: p.weight ?? 5, opacity: 1, dashArray: p.dash })
          .bindTooltip(p.label, { sticky: true })
          .addTo(group);
      }
    };

    const layers = explored.filter((e) => e.segments.length);
    if (!layers.length) {
      drawPaths();
      return;
    }

    const colors = layers.map((l) => resolveColor(l.color));
    const drawn = layers.map(() => 0);
    const start = performance.now();
    const frame = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / durationMs);
      layers.forEach((layer, i) => {
        const upto = Math.floor(layer.segments.length * t);
        if (upto > drawn[i]) {
          L.polyline(layer.segments.slice(drawn[i], upto), { color: colors[i], weight: 2.5, opacity: 0.6, interactive: false }).addTo(group);
          drawn[i] = upto;
        }
      });
      if (t < 1) raf = requestAnimationFrame(frame);
      else drawPaths();
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // animationKey 가 바뀔 때만 다시 그린다 (explored/paths 는 같은 key 에서 같은 값)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationKey, paths.length]);

  return <div ref={boxRef} className="map-box" role="img" aria-label="경로 지도" />;
}
