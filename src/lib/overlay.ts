import { strokeBounds, strokePathData } from './geometry';
import { t } from './i18n';
import { cssFamilyFor, userFont } from './userFonts';
import { annotationsOn, getAnnotation, store } from './store';
import { HEADER_FILL, isHeaderCell, layoutTable, TABLE_BORDER_WIDTH } from './table';
import type { HighlightAnnotation, ImageAnnotation, TableAnnotation, TextAnnotation } from './types';
import { icon } from './ui';
import type { PageView } from './viewer';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TextHandlers {
  onInput(id: string, text: string): void;
  onBlur(id: string): void;
  onKeyDown(id: string, e: KeyboardEvent): void;
}

export interface TableHandlers {
  onCellInput(id: string, r: number, c: number, text: string): void;
  onCellBlur(id: string): void;
  onCellKeyDown(id: string, e: KeyboardEvent): void;
}

let handlers: TextHandlers = { onInput() {}, onBlur() {}, onKeyDown() {} };
let tableHandlers: TableHandlers = { onCellInput() {}, onCellBlur() {}, onCellKeyDown() {} };

export function setTextHandlers(h: TextHandlers) {
  handlers = h;
}

export function setTableHandlers(h: TableHandlers) {
  tableHandlers = h;
}

export function cellBodyOf(v: PageView, id: string, r: number, c: number): HTMLElement | null {
  return v.ann.querySelector<HTMLElement>(`:scope > .ann[data-id="${id}"] .tbl-cell[data-r="${r}"][data-c="${c}"] > .tbl-text`);
}

export function readText(body: HTMLElement): string {
  return body.innerText.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
}

export function textBodyOf(v: PageView, id: string): HTMLElement | null {
  return v.ann.querySelector<HTMLElement>(`:scope > .ann[data-id="${id}"] > .ann-text-body`);
}

function deleteButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ann-del';
  b.title = t('ann.delete');
  b.tabIndex = -1;
  b.append(icon('X', 14));
  return b;
}

/** 글상자를 끌어 옮기는 손잡이 (선택했거나 입력 중일 때 왼쪽 위에 보인다) */
function moveGrip(): HTMLElement {
  const g = document.createElement('div');
  g.className = 'ann-grip';
  g.title = t('text.grip');
  g.append(icon('Move', 14));
  return g;
}

function findAnnEl(v: PageView, id: string) {
  return v.ann.querySelector<HTMLElement>(`:scope > .ann[data-id="${id}"]`);
}

function syncText(v: PageView, a: TextAnnotation): HTMLElement {
  let el = findAnnEl(v, a.id);
  const created = !el;
  if (!el) {
    el = document.createElement('div');
    el.className = 'ann ann-text';
    el.dataset.id = a.id;
    const body = document.createElement('div');
    body.className = 'ann-text-body';
    body.spellcheck = false;
    body.dataset.placeholder = t('ann.placeholder');
    body.addEventListener('input', () => handlers.onInput(a.id, readText(body)));
    body.addEventListener('blur', () => handlers.onBlur(a.id));
    body.addEventListener('keydown', (e) => handlers.onKeyDown(a.id, e));
    el.append(body, moveGrip(), deleteButton());
    v.ann.append(el);
  }
  const editing = store.editingId === a.id;
  const s = el.style;
  s.left = `${a.x}px`;
  s.top = `${a.y}px`;
  // 손잡이가 페이지 왼쪽·위 끝 밖으로 잘리지 않도록 (styles.css 의 .ann-grip)
  s.setProperty('--ax', String(a.x));
  s.setProperty('--ay', String(a.y));
  s.fontSize = `${a.size}px`;
  s.color = a.color;
  s.fontWeight = a.bold ? '700' : '400';
  s.fontFamily = cssFamilyFor(a.font);
  // 굵은 파일이 없는 사용자 글꼴은 브라우저가 굵게를 합성 (저장할 때는 외곽선을 같이 칠해 비슷하게)
  s.fontSynthesis = userFont(a.font) && a.bold ? 'weight' : '';
  const body = el.firstElementChild as HTMLElement;
  // 새로 만든 글상자는 편집 중이어도 내용을 채운다 (기존 글자 고치기: 원래 글자를 미리 넣어 둔다)
  if ((created || !editing) && body.textContent !== a.text) body.textContent = a.text;
  const ce = editing ? 'plaintext-only' : 'false';
  if (body.getAttribute('contenteditable') !== ce) body.setAttribute('contenteditable', ce);
  el.classList.toggle('selected', store.selectedId === a.id);
  el.classList.toggle('editing', editing);
  el.classList.toggle('light', isLight(a.color));
  el.classList.toggle('serif', a.font === 'serif');
  el.classList.toggle('replaced', !!a.cover);
  s.transform = a.scaleX && a.scaleX !== 1 ? `scaleX(${a.scaleX})` : '';
  return el;
}

/** '기존 글자 고치기' 덮개: PDF 그림 바로 위(형광펜 아래)에서 원래 글자를 가린다 */
function syncCovers(v: PageView, anns: ReturnType<typeof annotationsOn>) {
  const covered = anns.filter((a): a is TextAnnotation => a.type === 'text' && !!a.cover);
  const ids = new Set(covered.map((a) => a.id));
  for (const el of Array.from(v.cover.children) as HTMLElement[]) if (!ids.has(el.dataset.id ?? '')) el.remove();
  for (const a of covered) {
    let el = v.cover.querySelector<HTMLElement>(`:scope > [data-id="${a.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'cover-rect';
      el.dataset.id = a.id;
      el.title = t('cover.title', { text: a.original ?? '' });
      v.cover.append(el);
    }
    const c = a.cover!;
    const s = el.style;
    s.left = `${c.x}px`;
    s.top = `${c.y}px`;
    s.width = `${c.w}px`;
    s.height = `${c.h}px`;
    s.background = c.color;
    el.classList.toggle('selected', store.selectedId === a.id);
  }
}

/** 글자 고치기 도구: 마우스 아래 원래 글줄 표시 */
export function showRunHover(v: PageView | null, r: { x: number; y: number; w: number; h: number } | null) {
  document.querySelectorAll<HTMLElement>('.run-hover').forEach((el) => {
    if (!v || !r || el.parentElement !== v.ann) el.remove();
  });
  if (!v || !r) return;
  let el = v.ann.querySelector<HTMLElement>(':scope > .run-hover');
  if (!el) {
    el = document.createElement('div');
    el.className = 'run-hover';
    v.ann.append(el);
  }
  el.style.left = `${r.x - 1}px`;
  el.style.top = `${r.y - 1}px`;
  el.style.width = `${r.w + 2}px`;
  el.style.height = `${r.h + 2}px`;
}

function isLight(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 200;
}

function syncImage(v: PageView, a: ImageAnnotation): HTMLElement {
  let el = findAnnEl(v, a.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'ann ann-image';
    el.dataset.id = a.id;
    const img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    img.src = store.images.get(a.imageId)?.url ?? '';
    el.append(img);
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const h = document.createElement('span');
      h.className = `handle handle-${corner}`;
      h.dataset.handle = corner;
      el.append(h);
    }
    el.append(deleteButton());
    v.ann.append(el);
  }
  const s = el.style;
  s.left = `${a.x}px`;
  s.top = `${a.y}px`;
  s.width = `${a.w}px`;
  s.height = `${a.h}px`;
  el.classList.toggle('selected', store.selectedId === a.id);
  return el;
}

function makeCell(tableId: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'tbl-cell';
  const body = document.createElement('div');
  body.className = 'tbl-text';
  body.spellcheck = false;
  const pos = () => ({ r: Number(cell.dataset.r), c: Number(cell.dataset.c) });
  body.addEventListener('input', () => {
    const { r, c } = pos();
    tableHandlers.onCellInput(tableId, r, c, readText(body));
  });
  body.addEventListener('blur', () => tableHandlers.onCellBlur(tableId));
  body.addEventListener('keydown', (e) => tableHandlers.onCellKeyDown(tableId, e));
  cell.append(body);
  return cell;
}

function syncTable(v: PageView, a: TableAnnotation): HTMLElement {
  let el = findAnnEl(v, a.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'ann ann-table';
    el.dataset.id = a.id;
    const grid = document.createElementNS(SVG_NS, 'svg');
    grid.classList.add('tbl-grid');
    const fill = document.createElementNS(SVG_NS, 'rect');
    fill.classList.add('tbl-header-fill');
    const lines = document.createElementNS(SVG_NS, 'path');
    lines.classList.add('tbl-lines');
    grid.append(fill, lines);
    const cells = document.createElement('div');
    cells.className = 'tbl-cells';
    const handles = document.createElement('div');
    handles.className = 'tbl-handles';
    const grip = document.createElement('div');
    grip.className = 'tbl-grip';
    grip.title = t('table.grip');
    grip.append(icon('Move', 14));
    el.append(grid, cells, handles, grip, deleteButton());
    v.ann.append(el);
  }
  const L = layoutTable(a);
  const editing = store.editingId === a.id ? store.editingCell : null;
  const selected = store.selectedId === a.id;
  const active = selected ? store.activeCell : null;
  const s = el.style;
  s.left = `${a.x}px`;
  s.top = `${a.y}px`;
  s.width = `${L.width}px`;
  s.height = `${L.height}px`;
  s.fontSize = `${a.size}px`;
  s.color = a.color;
  el.dataset.align = a.align;
  el.classList.toggle('selected', selected);
  el.classList.toggle('editing', !!editing);

  // 선과 머리글 배경
  const grid = el.firstElementChild as SVGSVGElement;
  grid.setAttribute('width', String(L.width));
  grid.setAttribute('height', String(L.height));
  grid.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
  const fill = grid.firstElementChild as SVGRectElement;
  fill.setAttribute('width', String(L.width));
  fill.setAttribute('height', String(a.header ? L.rowY[1] : 0));
  fill.setAttribute('fill', HEADER_FILL);
  const path = grid.lastElementChild as SVGPathElement;
  const d = [...L.colX.map((x) => `M${x} 0V${L.height}`), ...L.rowY.map((y) => `M0 ${y}H${L.width}`)].join('');
  path.setAttribute('d', d);
  path.setAttribute('stroke', a.border);
  path.setAttribute('stroke-width', String(TABLE_BORDER_WIDTH));

  // 칸
  const cellsEl = el.children[1] as HTMLElement;
  const total = a.rows.length * a.cols.length;
  while (cellsEl.children.length > total) cellsEl.lastElementChild!.remove();
  while (cellsEl.children.length < total) cellsEl.append(makeCell(a.id));
  for (let r = 0; r < a.rows.length; r++) {
    for (let c = 0; c < a.cols.length; c++) {
      const cell = cellsEl.children[r * a.cols.length + c] as HTMLElement;
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      const cs = cell.style;
      cs.left = `${L.colX[c]}px`;
      cs.top = `${L.rowY[r]}px`;
      cs.width = `${a.cols[c]}px`;
      cs.height = `${L.rowY[r + 1] - L.rowY[r]}px`;
      const isEditing = !!editing && editing.r === r && editing.c === c;
      cell.classList.toggle('header', isHeaderCell(a, r));
      cell.classList.toggle('editing', isEditing);
      cell.classList.toggle('active', !!active && active.r === r && active.c === c && !editing);
      const body = cell.firstElementChild as HTMLElement;
      const wasEditing = body.dataset.editing === '1';
      if (isEditing) {
        if (!wasEditing) body.textContent = a.cells[r][c]; // 입력 중에는 원문 그대로 (줄바꿈은 브라우저가)
        body.dataset.editing = '1';
        if (body.getAttribute('contenteditable') !== 'plaintext-only') body.setAttribute('contenteditable', 'plaintext-only');
      } else {
        body.dataset.editing = '';
        if (body.getAttribute('contenteditable') !== 'false') body.setAttribute('contenteditable', 'false');
        const text = L.lines[r][c].join('\n'); // 저장할 때와 같은 줄바꿈
        if (body.textContent !== text) body.textContent = text;
      }
    }
  }

  // 열·행 경계 끌기 손잡이 (선택했을 때만 보임)
  const handles = el.children[2] as HTMLElement;
  const want = a.cols.length + a.rows.length;
  while (handles.children.length > want) handles.lastElementChild!.remove();
  while (handles.children.length < want) handles.append(document.createElement('div'));
  a.cols.forEach((_, i) => {
    const h = handles.children[i] as HTMLElement;
    h.className = 'tbl-col-handle';
    h.dataset.col = String(i + 1);
    h.style.left = `${L.colX[i + 1]}px`;
    h.style.top = '';
  });
  a.rows.forEach((_, j) => {
    const h = handles.children[a.cols.length + j] as HTMLElement;
    h.className = 'tbl-row-handle';
    h.dataset.row = String(j + 1);
    h.style.top = `${L.rowY[j + 1]}px`;
    h.style.left = '';
  });
  return el;
}

function syncHighlight(v: PageView, a: HighlightAnnotation) {
  let p = v.hl.querySelector<SVGPathElement>(`path[data-id="${a.id}"]`);
  if (!p) {
    p = document.createElementNS(SVG_NS, 'path');
    p.dataset.id = a.id;
    v.hl.append(p);
  }
  const d = strokePathData(a.points);
  if (p.getAttribute('d') !== d) p.setAttribute('d', d);
  p.setAttribute('stroke', a.color);
  p.setAttribute('stroke-width', String(a.width));
  p.setAttribute('stroke-opacity', String(a.opacity));
}

/** 선택된 형광펜 획의 테두리 상자 (+ 삭제 버튼) */
function syncHighlightSelection(v: PageView) {
  const sel = getAnnotation(store.selectedId);
  let box = v.ann.querySelector<HTMLElement>(':scope > .hl-sel');
  if (sel?.type === 'highlight' && sel.page === v.info.index) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'hl-sel';
      box.append(deleteButton());
    }
    if (v.ann.lastElementChild !== box) v.ann.append(box);
    box.dataset.id = sel.id;
    const b = strokeBounds(sel.points, sel.width);
    box.style.left = `${b.x}px`;
    box.style.top = `${b.y}px`;
    box.style.width = `${b.w}px`;
    box.style.height = `${b.h}px`;
  } else {
    box?.remove();
  }
}

/** 한 페이지의 주석 DOM 을 상태에 맞게 동기화한다. */
export function renderPageOverlay(v: PageView) {
  const anns = annotationsOn(v.info.index);
  const ids = new Set(anns.map((a) => a.id));

  for (const el of Array.from(v.hl.children) as SVGElement[]) {
    const id = el.dataset.id;
    if (id && !ids.has(id)) el.remove();
  }
  for (const el of Array.from(v.ann.children) as HTMLElement[]) {
    if (el.classList.contains('hl-sel') || el.classList.contains('draft') || el.classList.contains('run-hover')) continue;
    const id = el.dataset.id;
    if (!id || !ids.has(id)) el.remove();
  }

  let prev: Element | null = null;
  for (const a of anns) {
    if (a.type === 'highlight') {
      syncHighlight(v, a);
      continue;
    }
    const el = a.type === 'text' ? syncText(v, a) : a.type === 'table' ? syncTable(v, a) : syncImage(v, a);
    const expected: Element | null = prev ? prev.nextElementSibling : v.ann.firstElementChild;
    if (expected !== el) v.ann.insertBefore(el, expected);
    prev = el;
  }

  for (const p of Array.from(v.hl.children) as SVGElement[]) {
    p.classList.toggle('selected', p.dataset.id === store.selectedId);
  }
  syncHighlightSelection(v);
  syncCovers(v, anns);
}
