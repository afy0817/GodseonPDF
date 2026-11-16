import { type Key, t } from './i18n';
import { esc, icon, setModalCommands } from './ui';

// ---------------------------------------------------------------------------
// 서명 그리기: 캔버스에 마우스·펜·손가락으로 그리고, 여백을 잘라 투명 PNG 로 만든다.
// ---------------------------------------------------------------------------

export interface SignatureImage {
  png: Uint8Array;
  width: number; // 픽셀
  height: number;
  /** true: 서랍에 저장하고 지금 보는 페이지에도 넣기 */
  insert: boolean;
}

interface Pt {
  x: number;
  y: number;
  t: number;
  p: number; // 필압 (펜이 아니면 -1)
}

const PAD_W = 600; // 화면 크기 (CSS px)
const PAD_H = 220;
const OUT_SCALE = 3; // 저장 해상도 배율 (서명을 160pt 정도로 넣으면 400dpi 이상)
const COLORS = { black: '#111111', blue: '#1d3fbb', red: '#c62828' } as const;
const WIDTHS = { thin: 1.6, normal: 2.6, thick: 4 } as const;
type ColorKey = keyof typeof COLORS;
type WidthKey = keyof typeof WIDTHS;
const COLOR_LABEL: Record<ColorKey, Key> = { black: 'sig.color.black', blue: 'sig.color.blue', red: 'sig.color.red' };
const WIDTH_LABEL: Record<WidthKey, Key> = { thin: 'sig.width.thin', normal: 'sig.width.normal', thick: 'sig.width.thick' };

const PREFS_KEY = 'godseon.signaturePen';

function loadPrefs(): { color: ColorKey; width: WidthKey } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { color: p.color in COLORS ? p.color : 'black', width: p.width in WIDTHS ? p.width : 'normal' };
  } catch {
    return { color: 'black', width: 'normal' };
  }
}

/** 점마다 선 굵기: 펜은 필압, 마우스·손가락은 빠르게 그을수록 가늘게 (붓펜처럼) */
function widths(points: Pt[], base: number): number[] {
  const out: number[] = [];
  let w = base;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let target: number;
    if (p.p >= 0) target = base * (0.35 + p.p * 1.3);
    else if (i === 0) target = base;
    else {
      const q = points[i - 1];
      const v = Math.hypot(p.x - q.x, p.y - q.y) / Math.max(1, p.t - q.t); // px/ms
      target = base * Math.min(1.35, Math.max(0.55, 1.35 - v * 0.45));
    }
    w = i === 0 ? target : w * 0.65 + target * 0.35;
    out.push(w);
  }
  return out;
}

/**
 * 획 하나 그리기 (중점을 잇는 2차 곡선, 구간마다 굵기를 바꾼다).
 * live: 그리는 중 — 마지막 점까지 잇는 꼬리는 다음 점이 오면 곡선과 어긋나므로 그리지 않는다.
 */
function drawStroke(ctx: CanvasRenderingContext2D, points: Pt[], base: number, from = 0, live = false) {
  if (!points.length) return;
  const w = widths(points, base);
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, w[0] * 0.6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  for (let i = Math.max(1, from); i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const start = i === 1 ? prev : mid(points[i - 2], prev);
    const end = mid(prev, cur);
    ctx.lineWidth = (w[i - 1] + w[i]) / 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(prev.x, prev.y, end.x, end.y);
    if (i === points.length - 1 && !live) ctx.lineTo(cur.x, cur.y);
    ctx.stroke();
  }
}

/** 투명하지 않은 부분만 남기고 잘라 낸다 (가장자리에 pad 픽셀 여유) */
export function trimCanvas(src: HTMLCanvasElement, pad = 4): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function openSignaturePad(opts: { canInsert: boolean }): Promise<SignatureImage | null> {
  const prefs = loadPrefs();
  let color: ColorKey = prefs.color;
  let width: WidthKey = prefs.width;
  const strokes: Pt[][] = [];
  const redo: Pt[][] = [];

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const form = document.createElement('form');
    form.className = 'modal modal-wide sig-modal';
    const colorButtons = (Object.keys(COLORS) as ColorKey[])
      .map(
        (k) =>
          `<label class="sig-color" title="${esc(t(COLOR_LABEL[k]))}"><input type="radio" name="color" value="${k}"${k === color ? ' checked' : ''} /><span style="background:${COLORS[k]}"></span></label>`,
      )
      .join('');
    const widthButtons = (Object.keys(WIDTHS) as WidthKey[])
      .map(
        (k) =>
          `<label><input type="radio" name="width" value="${k}"${k === width ? ' checked' : ''} /><span>${esc(t(WIDTH_LABEL[k]))}</span></label>`,
      )
      .join('');
    form.innerHTML = `
      <div class="modal-icon"></div>
      <h2>${esc(t('sig.title'))}</h2>
      <p class="modal-desc">${esc(t('sig.desc'))}</p>
      <div class="sig-pad">
        <canvas tabindex="-1" width="${PAD_W * OUT_SCALE}" height="${PAD_H * OUT_SCALE}" aria-label="${esc(t('sig.canvas'))}"></canvas>
        <div class="sig-guide"><span>✕</span></div>
        <div class="sig-placeholder">${esc(t('sig.placeholder'))}</div>
      </div>
      <div class="sig-tools">
        <div class="sig-colors" role="radiogroup" aria-label="${esc(t('sig.color'))}">${colorButtons}</div>
        <div class="seg-group seg-radio" role="radiogroup" aria-label="${esc(t('sig.width'))}">${widthButtons}</div>
        <span class="sig-spacer"></span>
        <button type="button" class="btn btn-sm" data-act="undo" title="${esc(t('sig.undo.title'))}"></button>
        <button type="button" class="btn btn-sm" data-act="clear"></button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-act="cancel">${esc(t('common.cancel'))}</button>
        <span class="sig-spacer"></span>
        <button type="button" class="btn${opts.canInsert ? '' : ' btn-primary'}" data-act="save">${esc(t('sig.save'))}</button>
        ${opts.canInsert ? `<button type="submit" class="btn btn-primary" data-act="insert">${esc(t('sig.insert'))}</button>` : ''}
      </div>`;
    form.querySelector('.modal-icon')!.append(icon('Signature', 22));
    const undoBtn = form.querySelector<HTMLButtonElement>('[data-act="undo"]')!;
    const clearBtn = form.querySelector<HTMLButtonElement>('[data-act="clear"]')!;
    undoBtn.append(icon('Undo2', 15), document.createTextNode(t('sig.undo')));
    clearBtn.append(icon('Eraser', 15), document.createTextNode(t('sig.clear')));
    const saveBtn = form.querySelector<HTMLButtonElement>('[data-act="save"]')!;
    const insertBtn = form.querySelector<HTMLButtonElement>('[data-act="insert"]');
    const pad = form.querySelector<HTMLElement>('.sig-pad')!;
    const canvas = form.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;

    const setup = (c: CanvasRenderingContext2D, scale: number) => {
      c.setTransform(scale, 0, 0, scale, 0, 0);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = COLORS[color];
      c.fillStyle = COLORS[color];
    };
    const redraw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setup(ctx, OUT_SCALE);
      for (const s of strokes) drawStroke(ctx, s, WIDTHS[width]);
      refresh();
    };
    const refresh = () => {
      const empty = strokes.length === 0;
      pad.classList.toggle('empty', empty);
      undoBtn.disabled = empty;
      clearBtn.disabled = empty;
      saveBtn.disabled = empty;
      if (insertBtn) insertBtn.disabled = empty;
    };

    // --- 그리기 -------------------------------------------------------------
    let current: Pt[] | null = null;
    let pointerId = -1;
    const pointOf = (e: PointerEvent): Pt => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * PAD_W,
        y: ((e.clientY - r.top) / r.height) * PAD_H,
        t: e.timeStamp,
        p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : -1,
      };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      pointerId = e.pointerId;
      current = [pointOf(e)];
      strokes.push(current);
      redo.length = 0;
      setup(ctx, OUT_SCALE);
      drawStroke(ctx, current, WIDTHS[width]);
      refresh();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current || e.pointerId !== pointerId) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const before = current.length;
      for (const ev of events.length ? events : [e]) {
        const p = pointOf(ev);
        const last = current[current.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.6) continue;
        current.push(p);
      }
      if (current.length === before) return;
      if (before === 1) {
        // 처음 찍은 점(동그라미)을 지우고 선으로 다시 그린다
        redraw();
        return;
      }
      setup(ctx, OUT_SCALE);
      drawStroke(ctx, current, WIDTHS[width], before, true);
    });
    const end = (e: PointerEvent) => {
      if (!current || e.pointerId !== pointerId) return;
      current = null;
      pointerId = -1;
      redraw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // --- 도구 ---------------------------------------------------------------
    const undo = () => {
      if (current || !strokes.length) return;
      redo.push(strokes.pop()!);
      redraw();
    };
    const redoStroke = () => {
      if (current || !redo.length) return;
      strokes.push(redo.pop()!);
      redraw();
    };
    undoBtn.addEventListener('click', undo);
    clearBtn.addEventListener('click', () => {
      if (current) return;
      strokes.length = 0;
      redo.length = 0;
      redraw();
    });
    form.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name === 'color') color = input.value as ColorKey;
      else if (input.name === 'width') width = input.value as WidthKey;
      else return;
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ color, width }));
      } catch {
        /* 기억하지 못해도 괜찮다 */
      }
      redraw();
    });

    // --- 마치기 -------------------------------------------------------------
    const done = (v: SignatureImage | null) => {
      setModalCommands(null);
      backdrop.remove();
      resolve(v);
    };
    const finish = async (insert: boolean) => {
      if (!strokes.length) return;
      redraw();
      const trimmed = trimCanvas(canvas);
      if (!trimmed) return;
      const blob = await new Promise<Blob | null>((r) => trimmed.toBlob(r, 'image/png'));
      if (!blob) return;
      done({ png: new Uint8Array(await blob.arrayBuffer()), width: trimmed.width, height: trimmed.height, insert });
    };
    saveBtn.addEventListener('click', () => void finish(false));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void finish(!!insertBtn);
    });
    form.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(null));
    let keyHandledAt = -Infinity;
    form.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 뒤에 있는 문서의 단축키가 동작하지 않도록
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      } else if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y')) {
        e.preventDefault();
        keyHandledAt = performance.now();
        if (e.shiftKey || k === 'y') redoStroke();
        else undo();
      }
    });
    // 메뉴의 실행 취소/다시 실행(⌘/Ctrl+Z)은 이 창의 획 되돌리기로. 같은 키를 위에서 이미 처리했으면 건너뛴다.
    const fromMenu = (fn: () => void) => () => {
      if (performance.now() - keyHandledAt > 400) fn();
    };
    setModalCommands({ undo: fromMenu(undo), redo: fromMenu(redoStroke) });

    refresh();
    backdrop.append(form);
    document.body.append(backdrop);
    canvas.focus();
  });
}
