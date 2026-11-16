import * as E from './editor';
import { LINE_HEIGHT } from './fonts';
import { clamp, simplify, strokeBounds, strokeHit, strokePathData } from './geometry';
import { getAnnotation, store, uid } from './store';
import { createTable, layoutTable, MIN_COL_WIDTH, MIN_ROW_HEIGHT } from './table';
import type { Annotation, HighlightAnnotation, ImageAnnotation, TableAnnotation, TextAnnotation } from './types';
import type { PageView, Viewer } from './viewer';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 4; // px
const ERASER_RADIUS = 7; // 화면 px

type Corner = 'nw' | 'ne' | 'sw' | 'se';

let viewer: Viewer;

function blurActive() {
  const ae = document.activeElement as HTMLElement | null;
  if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
}

/** 포인터를 붙잡고 이동/종료를 추적한다. */
function track(e: PointerEvent, onMove: (ev: PointerEvent) => void, onEnd: (ev: PointerEvent, cancelled: boolean) => void) {
  const el = viewer.pagesEl;
  const id = e.pointerId;
  try {
    el.setPointerCapture(id);
  } catch {
    /* 무시 */
  }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === id) onMove(ev);
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    try {
      el.releasePointerCapture(id);
    } catch {
      /* 무시 */
    }
    onEnd(ev, ev.type === 'pointercancel');
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function boundsOf(a: Annotation, v: PageView) {
  if (a.type === 'highlight') return strokeBounds(a.points, a.width);
  if (a.type === 'image') return { x: a.x, y: a.y, w: a.w, h: a.h };
  if (a.type === 'table') {
    const L = layoutTable(a);
    return { x: a.x, y: a.y, w: L.width, h: L.height };
  }
  const el = v.ann.querySelector<HTMLElement>(`:scope > .ann[data-id="${a.id}"]`);
  return { x: a.x, y: a.y, w: el?.offsetWidth ?? 20, h: el?.offsetHeight ?? a.size * LINE_HEIGHT };
}

// ---------------------------------------------------------------------------
// 이동 / 크기 조절
// ---------------------------------------------------------------------------

function startMove(v: PageView, a: Annotation, e: PointerEvent, onClick?: () => void) {
  const sx = e.clientX;
  const sy = e.clientY;
  const orig = structuredClone(a);
  const b = boundsOf(a, v);
  const keep = 12; // 페이지 안에 최소한 남겨 둘 크기
  let moved = false;
  track(
    e,
    (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      moved = true;
      const s = viewer.scale;
      const dx = clamp((ev.clientX - sx) / s, keep - (b.x + b.w), v.info.width - keep - b.x);
      const dy = clamp((ev.clientY - sy) / s, keep - (b.y + b.h), v.info.height - keep - b.y);
      if (a.type === 'highlight') {
        a.points = (orig as HighlightAnnotation).points.map((n, i) => n + (i % 2 ? dy : dx));
      } else {
        a.x = (orig as TextAnnotation | ImageAnnotation | TableAnnotation).x + dx;
        a.y = (orig as TextAnnotation | ImageAnnotation | TableAnnotation).y + dy;
      }
      E.refresh([a.page]);
    },
    (_ev, cancelled) => {
      if (moved && cancelled) {
        Object.assign(a, orig);
        E.refresh([a.page]);
        return;
      }
      if (moved) E.commit();
      else onClick?.();
    },
  );
}

function startResize(v: PageView, a: ImageAnnotation, corner: Corner, e: PointerEvent) {
  e.preventDefault();
  const sx = e.clientX;
  const sy = e.clientY;
  const orig = { ...a };
  const ratio = orig.w / orig.h;
  const MIN = 8;
  let changed = false;
  track(
    e,
    (ev) => {
      const s = viewer.scale;
      const dx = (ev.clientX - sx) / s;
      const dy = (ev.clientY - sy) / s;
      let w = orig.w + (corner.includes('e') ? dx : -dx);
      let h = orig.h + (corner.includes('s') ? dy : -dy);
      if (!ev.shiftKey) {
        // 기본은 비율 유지 (Shift 를 누르면 자유롭게)
        if (Math.abs(w / orig.w) >= Math.abs(h / orig.h)) h = w / ratio;
        else w = h * ratio;
        if (w < MIN || h < MIN) {
          const k = Math.max(MIN / Math.max(w, 0.0001), MIN / Math.max(h, 0.0001));
          w *= k;
          h *= k;
        }
      }
      w = Math.max(MIN, w);
      h = Math.max(MIN, h);
      a.w = w;
      a.h = h;
      a.x = corner.includes('w') ? orig.x + orig.w - w : orig.x;
      a.y = corner.includes('n') ? orig.y + orig.h - h : orig.y;
      changed = true;
      E.refresh([a.page]);
    },
    (_ev, cancelled) => {
      if (cancelled && changed) {
        Object.assign(a, orig);
        E.refresh([a.page]);
        return;
      }
      if (changed) E.commit();
    },
  );
  void v;
}

// ---------------------------------------------------------------------------
// 표: 열 너비 / 행 높이 조절, 새 표
// ---------------------------------------------------------------------------

function startColResize(a: TableAnnotation, col: number, e: PointerEvent) {
  e.preventDefault();
  const sx = e.clientX;
  const orig = a.cols[col - 1];
  let changed = false;
  track(
    e,
    (ev) => {
      const dx = (ev.clientX - sx) / viewer.scale;
      a.cols[col - 1] = Math.max(MIN_COL_WIDTH, Math.round((orig + dx) * 10) / 10);
      changed = true;
      E.refresh([a.page]);
    },
    (_ev, cancelled) => {
      if (cancelled && changed) {
        a.cols[col - 1] = orig;
        E.refresh([a.page]);
        return;
      }
      if (changed) E.commit();
    },
  );
}

function startRowResize(a: TableAnnotation, row: number, e: PointerEvent) {
  e.preventDefault();
  const sy = e.clientY;
  const L = layoutTable(a);
  const actual = L.rowY[row] - L.rowY[row - 1];
  const orig = a.rows[row - 1];
  let changed = false;
  track(
    e,
    (ev) => {
      const dy = (ev.clientY - sy) / viewer.scale;
      // 글자가 들어 있는 높이보다 작게는 줄어들지 않는다 (layoutTable 이 내용 높이를 보장)
      a.rows[row - 1] = Math.max(MIN_ROW_HEIGHT, Math.round((actual + dy) * 10) / 10);
      changed = true;
      E.refresh([a.page]);
    },
    (_ev, cancelled) => {
      if (cancelled && changed) {
        a.rows[row - 1] = orig;
        E.refresh([a.page]);
        return;
      }
      if (changed) E.commit();
    },
  );
}

function createTableAt(v: PageView, e: PointerEvent) {
  e.preventDefault();
  const p = viewer.pagePoint(v, e.clientX, e.clientY);
  const st = store.tableStyle;
  const t = createTable(v.info, p.x, p.y, st.rows, st.cols, st.size);
  E.addAnnotations([t]);
  E.setTool('select');
  // 첫 칸부터 바로 입력 (Tab 으로 다음 칸)
  setTimeout(() => {
    if (getAnnotation(t.id)) E.startCellEditing(t.id, 0, 0);
  }, 0);
}

function onTablePointerDown(view: PageView, a: TableAnnotation, target: Element, e: PointerEvent) {
  if (target.closest('.tbl-grip')) {
    E.select(a.id);
    startMove(view, a, e);
    return;
  }
  const colHandle = target.closest<HTMLElement>('.tbl-col-handle');
  if (colHandle) {
    E.select(a.id);
    startColResize(a, Number(colHandle.dataset.col), e);
    return;
  }
  const rowHandle = target.closest<HTMLElement>('.tbl-row-handle');
  if (rowHandle) {
    E.select(a.id);
    startRowResize(a, Number(rowHandle.dataset.row), e);
    return;
  }
  const cellEl = target.closest<HTMLElement>('.tbl-cell');
  if (!cellEl) {
    E.select(a.id);
    startMove(view, a, e);
    return;
  }
  const r = Number(cellEl.dataset.r);
  const c = Number(cellEl.dataset.c);
  const wasSelected = store.selectedId === a.id;
  const tool = store.tool;
  E.selectCell(a.id, r, c);
  // 끌면 표 이동, 그냥 누르면: 이미 선택된 표(또는 텍스트·표 도구)면 그 칸에 글자 입력
  startMove(view, a, e, () => {
    if (wasSelected || tool !== 'select') E.startCellEditing(a.id, r, c, { clientX: e.clientX, clientY: e.clientY });
  });
}

// ---------------------------------------------------------------------------
// 글상자 만들기
// ---------------------------------------------------------------------------

function createText(v: PageView, e: PointerEvent) {
  e.preventDefault();
  const p = viewer.pagePoint(v, e.clientX, e.clientY);
  const st = store.textStyle;
  const lineH = st.size * LINE_HEIGHT;
  const a: TextAnnotation = {
    id: uid('t'),
    type: 'text',
    page: v.info.index,
    x: clamp(p.x, 0, Math.max(0, v.info.width - 16)),
    y: clamp(p.y - lineH / 2, 0, Math.max(0, v.info.height - lineH)),
    text: '',
    size: st.size,
    color: st.color,
    bold: st.bold,
  };
  store.annotations.push(a);
  // pointerdown 의 기본 동작(포커스 이동)이 끝난 뒤에 글상자에 포커스를 준다.
  setTimeout(() => {
    if (getAnnotation(a.id)) E.startEditing(a.id, undefined, true);
  }, 0);
}

// ---------------------------------------------------------------------------
// 형광펜
// ---------------------------------------------------------------------------

function startStroke(v: PageView, e: PointerEvent) {
  e.preventDefault();
  E.select(null);
  const st = { ...store.highlightStyle };
  const s = viewer.scale;
  const p0 = viewer.pagePoint(v, e.clientX, e.clientY);
  let pts = [p0.x, p0.y];
  const path = document.createElementNS(SVG_NS, 'path');
  path.classList.add('draft');
  path.setAttribute('stroke', st.color);
  path.setAttribute('stroke-width', String(st.width));
  path.setAttribute('stroke-opacity', String(st.opacity));
  v.hl.append(path);
  let raf = 0;
  const draw = () => {
    raf = 0;
    path.setAttribute('d', strokePathData(pts));
  };
  draw();
  const minStep = 1.5 / s;
  track(
    e,
    (ev) => {
      const list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
      for (const ce of list.length ? list : [ev]) {
        const p = viewer.pagePoint(v, ce.clientX, ce.clientY);
        if (ev.shiftKey) {
          pts = [p0.x, p0.y, p.x, p.y]; // Shift: 직선
          continue;
        }
        const lx = pts[pts.length - 2];
        const ly = pts[pts.length - 1];
        if (Math.hypot(p.x - lx, p.y - ly) >= minStep) pts.push(p.x, p.y);
      }
      if (!raf) raf = requestAnimationFrame(draw);
    },
    (_ev, cancelled) => {
      cancelAnimationFrame(raf);
      path.remove();
      if (cancelled) return;
      const points = simplify(pts, 0.6 / s).map((n) => Math.round(n * 100) / 100);
      const a: HighlightAnnotation = {
        id: uid('h'),
        type: 'highlight',
        page: v.info.index,
        points,
        color: st.color,
        width: st.width,
        opacity: st.opacity,
      };
      E.addAnnotations([a], false);
    },
  );
}

// ---------------------------------------------------------------------------
// 지우개 (형광펜 획만 지움)
// ---------------------------------------------------------------------------

function startErase(v: PageView, e: PointerEvent) {
  e.preventDefault();
  E.select(null);
  const radius = ERASER_RADIUS / viewer.scale;
  let changed = false;
  let last = viewer.pagePoint(v, e.clientX, e.clientY);
  const eraseAt = (x: number, y: number) => {
    const before = store.annotations.length;
    store.annotations = store.annotations.filter(
      (a) => !(a.type === 'highlight' && a.page === v.info.index && strokeHit(a.points, a.width, x, y, radius)),
    );
    if (store.annotations.length !== before) {
      changed = true;
      E.refresh([v.info.index]);
    }
  };
  eraseAt(last.x, last.y);
  track(
    e,
    (ev) => {
      const p = viewer.pagePoint(v, ev.clientX, ev.clientY);
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / radius));
      for (let i = 1; i <= steps; i++) {
        eraseAt(last.x + ((p.x - last.x) * i) / steps, last.y + ((p.y - last.y) * i) / steps);
      }
      last = p;
    },
    () => {
      if (changed) E.commit();
    },
  );
}

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

export function setupInteractions(v: Viewer) {
  viewer = v;
  const root = v.pagesEl;

  // 편집 중인 글상자 안이 아니면 브라우저 기본 동작(포커스 이동, 텍스트 선택, 이미지 끌기)을 막는다.
  root.addEventListener('mousedown', (e) => {
    if (!(e.target as Element).closest('.ann-text.editing, .tbl-cell.editing')) e.preventDefault();
  });

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !store.doc) return;
    const target = e.target as Element;
    if (target.closest('.ann-text.editing, .tbl-cell.editing')) return; // 커서 이동/텍스트 선택은 기본 동작으로

    const wasEditing = !!store.editingId;
    blurActive();
    if (store.editingId) E.finishEditing();

    const view = viewer.viewOf(target);
    if (!view) {
      E.select(null);
      return;
    }

    const del = target.closest<HTMLElement>('.ann-del');
    if (del) {
      e.preventDefault();
      const id = del.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (id) E.deleteAnnotation(id);
      return;
    }

    const tool = store.tool;
    if (tool === 'highlight') return startStroke(view, e);
    if (tool === 'eraser') return startErase(view, e);

    const annEl = target.closest<HTMLElement>('.ann');
    if (annEl) {
      const a = getAnnotation(annEl.dataset.id ?? null);
      if (!a) return;
      if (a.type === 'table') return onTablePointerDown(view, a, target, e);
      if (tool === 'text' && a.type !== 'text') {
        if (!wasEditing) createText(view, e);
        return;
      }
      const handle = target.closest<HTMLElement>('.handle');
      if (handle && a.type === 'image') {
        E.select(a.id);
        return startResize(view, a, handle.dataset.handle as Corner, e);
      }
      const wasSelected = store.selectedId === a.id;
      E.select(a.id);
      startMove(view, a, e, () => {
        if (a.type === 'text' && (tool === 'text' || wasSelected)) {
          E.startEditing(a.id, { clientX: e.clientX, clientY: e.clientY });
        }
      });
      return;
    }

    const pathEl = target.closest<SVGPathElement>('.hl-layer path[data-id]');
    if (pathEl && tool === 'select') {
      const a = getAnnotation(pathEl.dataset.id ?? null);
      if (a) {
        E.select(a.id);
        startMove(view, a, e);
        return;
      }
    }

    if (tool === 'text') {
      if (!wasEditing) createText(view, e);
      return;
    }
    if (tool === 'table') {
      if (!wasEditing) createTableAt(view, e);
      return;
    }
    E.select(null);
  });

  root.addEventListener('dblclick', (e) => {
    const cell = (e.target as Element).closest<HTMLElement>('.tbl-cell');
    const tableId = cell?.closest<HTMLElement>('.ann-table')?.dataset.id;
    if (cell && tableId && !cell.classList.contains('editing')) {
      E.startCellEditing(tableId, Number(cell.dataset.r), Number(cell.dataset.c), { clientX: e.clientX, clientY: e.clientY });
      return;
    }
    const el = (e.target as Element).closest<HTMLElement>('.ann-text');
    const id = el?.dataset.id;
    if (id && store.editingId !== id) E.startEditing(id, { clientX: e.clientX, clientY: e.clientY });
  });
}
