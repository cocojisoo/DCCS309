import { haversine } from "./graph";

export type LatLng = [number, number];

export function polylineLength(pts: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return d;
}

/** 경로를 stepM 간격의 점으로 다시 샘플링 */
export function resample(pts: LatLng[], stepM: number): LatLng[] {
  if (pts.length < 2) return pts.slice();
  const out: LatLng[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [aLat, aLng] = pts[i - 1];
    const [bLat, bLng] = pts[i];
    const seg = haversine(aLat, aLng, bLat, bLng);
    let d = stepM - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t]);
      d += stepM;
    }
    carry = seg - (d - stepM);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 점과 선분 사이 거리 (m). 짧은 구간이므로 위경도를 평면으로 근사한다. */
function pointSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110540;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}

/**
 * 경로 겹침 비율: path 를 10m 간격으로 샘플링한 점 중 reference 경로에서 toleranceM 이내인 점의 비율 (0~1)
 */
export function overlapRatio(path: LatLng[], reference: LatLng[], toleranceM = 15): number {
  if (path.length < 2 || reference.length < 2) return 0;
  const samples = resample(path, 10);
  let hit = 0;
  for (const p of samples) {
    for (let i = 1; i < reference.length; i++) {
      if (pointSegmentM(p, reference[i - 1], reference[i]) <= toleranceM) {
        hit++;
        break;
      }
    }
  }
  return hit / samples.length;
}
