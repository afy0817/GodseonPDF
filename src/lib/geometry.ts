export type Matrix = [number, number, number, number, number, number];

export function invert(m: number[]): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export type Segment =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'Q'; cx: number; cy: number; x: number; y: number };

/**
 * 점 목록을 부드러운 곡선 조각으로 바꾼다 (중점을 잇는 2차 베지어).
 * 화면(SVG)과 PDF 저장이 같은 함수를 쓰므로 모양이 똑같이 나온다.
 */
export function strokeSegments(points: number[]): Segment[] {
  const n = points.length / 2;
  if (n === 0) return [];
  const segs: Segment[] = [{ t: 'M', x: points[0], y: points[1] }];
  if (n === 1) {
    segs.push({ t: 'L', x: points[0], y: points[1] }); // 점 하나 → 둥근 끝 모양의 동그라미
    return segs;
  }
  if (n === 2) {
    segs.push({ t: 'L', x: points[2], y: points[3] });
    return segs;
  }
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const nx = points[(i + 1) * 2];
    const ny = points[(i + 1) * 2 + 1];
    segs.push({ t: 'Q', cx: x, cy: y, x: (x + nx) / 2, y: (y + ny) / 2 });
  }
  segs.push({ t: 'L', x: points[(n - 1) * 2], y: points[(n - 1) * 2 + 1] });
  return segs;
}

const r = (v: number) => Math.round(v * 100) / 100;

export function strokePathData(points: number[]): string {
  return strokeSegments(points)
    .map((s) => (s.t === 'Q' ? `Q${r(s.cx)} ${r(s.cy)} ${r(s.x)} ${r(s.y)}` : `${s.t}${r(s.x)} ${r(s.y)}`))
    .join('');
}

/** Ramer–Douglas–Peucker 단순화 */
export function simplify(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i * 2], points[i * 2 + 1], points[s * 2], points[s * 2 + 1], points[e * 2], points[e * 2 + 1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 획(폭 포함)이 점에서 radius 안에 있는지 */
export function strokeHit(points: number[], width: number, px: number, py: number, radius: number): boolean {
  const reach = width / 2 + radius;
  const n = points.length / 2;
  if (n === 1) return Math.hypot(px - points[0], py - points[1]) <= reach;
  for (let i = 0; i < n - 1; i++) {
    if (distToSegment(px, py, points[i * 2], points[i * 2 + 1], points[i * 2 + 2], points[i * 2 + 3]) <= reach) return true;
  }
  return false;
}

export function strokeBounds(points: number[], width: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  const h = width / 2;
  return { x: minX - h, y: minY - h, w: maxX - minX + width, h: maxY - minY + width };
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
