import { pdfjs } from './pdf';
import type { FontStyle } from './fonts';
import type { PageView, Viewer } from './viewer';

/**
 * PDF 에 원래 들어 있는 글줄(pdf.js 텍스트 조각)의 위치·크기·글꼴.
 * 좌표는 주석과 같은 페이지 단위(화면 방향, 왼쪽 위 원점)이다.
 */
export interface TextRun {
  str: string;
  x: number;
  y: number; // 글자 상자 위쪽
  w: number;
  h: number;
  baseline: number;
  size: number;
  font: FontStyle;
  bold: boolean;
}

const cache = new Map<number, Promise<TextRun[]>>();
const ready = new Map<number, TextRun[]>();

export function clearTextRuns() {
  cache.clear();
  ready.clear();
}

/** 이미 읽어 둔 글줄 (없으면 null — 그때는 textRunsOf 로 읽기 시작) */
export function peekTextRuns(index: number): TextRun[] | null {
  return ready.get(index) ?? null;
}

const SERIF_RE = /batang|myeong|mincho|gungsuh|gungseo|song|ming|times|serif|garamond|georgia|cambria|palatino|bookman|century|minion|명조|바탕|궁서|신명|hymjre|hysm/i;
const BOLD_RE = /bold|black|heavy|semibold|demibold|extrabold|ultrabold|[-,]b$|굵은|볼드/i;

function fontInfo(page: { commonObjs: { has(id: string): boolean; get(id: string): unknown } }, fontName: string, family: string) {
  let name = '';
  try {
    if (page.commonObjs.has(fontName)) name = String((page.commonObjs.get(fontName) as { name?: string })?.name ?? '');
  } catch {
    /* 아직 글꼴이 준비되지 않음 */
  }
  const base = name.replace(/^[A-Z]{6}\+/, '');
  const serif = SERIF_RE.test(base) || (!base && family === 'serif');
  return { font: (serif ? 'serif' : 'sans') as FontStyle, bold: BOLD_RE.test(base) };
}

/** 한 페이지의 글줄 목록 (처음 한 번만 pdf.js 에서 읽는다) */
export function textRunsOf(viewer: Viewer, v: PageView): Promise<TextRun[]> {
  let p = cache.get(v.info.index);
  if (!p) {
    p = (async () => {
      const page = await viewer.getPage(v.info.index);
      const tc = await page.getTextContent();
      const runs: TextRun[] = [];
      for (const item of tc.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const style = tc.styles[item.fontName];
        if (style?.vertical) continue;
        const tx = pdfjs.Util.transform(v.info.transform, item.transform);
        if (Math.abs(Math.atan2(tx[1], tx[0])) > 0.01) continue; // 화면에서 가로로 놓인 글자만
        const size = Math.hypot(tx[2], tx[3]);
        if (!(size > 0.5) || !(item.width > 0)) continue;
        const ascent = style?.ascent || 0.8;
        const descent = style?.descent || -0.2;
        const info = fontInfo(page, item.fontName, style?.fontFamily ?? '');
        runs.push({
          str: item.str,
          x: tx[4],
          y: tx[5] - ascent * size,
          w: item.width,
          h: (ascent - descent) * size,
          baseline: tx[5],
          size,
          ...info,
        });
      }
      ready.set(v.info.index, runs);
      return runs;
    })();
    cache.set(v.info.index, p);
    p.catch(() => cache.delete(v.info.index));
  }
  return p;
}

/** 덮개(사각형)가 글줄 넓이의 몇 할을 덮는지 */
export function coverOverlap(c: { x: number; y: number; w: number; h: number }, r: TextRun) {
  const w = Math.min(c.x + c.w, r.x + r.w) - Math.max(c.x, r.x);
  const h = Math.min(c.y + c.h, r.y + r.h) - Math.max(c.y, r.y);
  return w > 0 && h > 0 ? (w * h) / (r.w * r.h) : 0;
}

/** 점 아래 글줄 (여러 개면 가장 작은 것) */
export function runAt(runs: TextRun[], x: number, y: number): TextRun | null {
  let best: TextRun | null = null;
  for (const r of runs) {
    const pad = Math.min(2, r.size * 0.15);
    if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) {
      if (!best || r.w * r.h < best.w * best.h) best = r;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 색 고르기: 그려진 페이지 그림에서 배경색(덮개)과 글자색을 읽는다
// ---------------------------------------------------------------------------

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;

export interface Sampler {
  canvas: HTMLCanvasElement;
  k: number; // 캔버스 픽셀 / 페이지 단위
}

/** 화면에 그려진 페이지 그림, 없으면 따로 그려서 색을 읽을 그림을 준비한다 */
export async function samplerFor(viewer: Viewer, v: PageView): Promise<Sampler | null> {
  if (v.canvas && v.canvas.width) return { canvas: v.canvas, k: v.canvas.width / v.info.width };
  const page = await viewer.getPage(v.info.index);
  const k = 1.5;
  const viewport = page.getViewport({ scale: k });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return { canvas, k };
}

export function viewSampler(v: PageView): Sampler | null {
  return v.canvas && v.canvas.width ? { canvas: v.canvas, k: v.canvas.width / v.info.width } : null;
}

export function sampleColors(sampler: Sampler | null, r: TextRun): { background: string; text: string } {
  const fallback = { background: '#ffffff', text: '#111111' };
  if (!sampler) return fallback;
  const { canvas, k } = sampler;
  const pad = Math.max(2, Math.round(1.5 * k));
  const x0 = Math.max(0, Math.floor(r.x * k) - pad);
  const y0 = Math.max(0, Math.floor(r.y * k) - pad);
  const x1 = Math.min(canvas.width, Math.ceil((r.x + r.w) * k) + pad);
  const y1 = Math.min(canvas.height, Math.ceil((r.y + r.h) * k) + pad);
  if (x1 - x0 < 3 || y1 - y0 < 3) return fallback;
  let data: Uint8ClampedArray;
  try {
    data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  } catch {
    return fallback;
  }
  const w = x1 - x0;
  const h = y1 - y0;
  // 배경: 테두리 픽셀 중 가장 많은 색 (16단계로 묶어서 셈)
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (i: number) => {
    const q = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const c = counts.get(q) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += data[i];
    c.g += data[i + 1];
    c.b += data[i + 2];
    counts.set(q, c);
  };
  for (let x = 0; x < w; x++) {
    add(x * 4);
    add(((h - 1) * w + x) * 4);
  }
  for (let y = 0; y < h; y++) {
    add(y * w * 4);
    add((y * w + w - 1) * 4);
  }
  let bg = { n: 0, r: 255, g: 255, b: 255 };
  for (const c of counts.values()) if (c.n > bg.n) bg = c;
  const br = bg.n ? bg.r / bg.n : 255;
  const bgG = bg.n ? bg.g / bg.n : 255;
  const bb = bg.n ? bg.b / bg.n : 255;
  // 글자색: 배경과 가장 다른 픽셀들(상위 15%)의 평균
  const diffs: Array<[number, number]> = [];
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bb);
    if (d > 60) diffs.push([d, i]);
  }
  let text = fallback.text;
  if (diffs.length) {
    diffs.sort((a, b) => b[0] - a[0]);
    const top = diffs.slice(0, Math.max(1, Math.ceil(diffs.length * 0.15)));
    let tr = 0;
    let tg = 0;
    let tb = 0;
    for (const [, i] of top) {
      tr += data[i];
      tg += data[i + 1];
      tb += data[i + 2];
    }
    text = hex(tr / top.length, tg / top.length, tb / top.length);
  }
  return { background: hex(br, bgG, bb), text };
}
