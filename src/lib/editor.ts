import { History, type Snapshot } from './history';
import { cellBodyOf, readText, renderPageOverlay, setTableHandlers, setTextHandlers, textBodyOf } from './overlay';
import { emit, getAnnotation, livePages, store } from './store';
import { deleteCol, deleteRow, insertCol, insertRow } from './table';
import type { Annotation, HighlightAnnotation, TableAnnotation, TextAnnotation, Tool } from './types';
import type { Viewer } from './viewer';

export const history = new History();
let viewer: Viewer;

/** 편집 중인 글상자의 시작 상태 (실행 취소 기록 여부 판단용) */
let editOrigin: { id: string; text: string; isNew: boolean } | null = null;
let liveTextChanged = false;
let dirtyListener: () => void = () => {};

export function initEditor(v: Viewer, onDirtyMaybeChanged: () => void) {
  viewer = v;
  dirtyListener = onDirtyMaybeChanged;
  setTextHandlers({
    onInput(id, text) {
      const a = getAnnotation(id);
      if (a?.type !== 'text') return;
      a.text = text;
      const changed = !!editOrigin && editOrigin.id === id && text !== editOrigin.text;
      if (changed !== liveTextChanged) {
        liveTextChanged = changed;
        dirtyListener();
      }
    },
    onBlur(id) {
      // 다른 앱으로 전환하는 경우(창 포커스 잃음)에는 편집을 유지한다.
      if (!document.hasFocus()) return;
      if (store.editingId === id) finishEditing();
    },
    onKeyDown(_id, e) {
      if (e.isComposing) return;
      // stopPropagation: 편집이 끝난 뒤 같은 키가 전역 단축키(Esc = 선택 해제 등)로 다시 처리되지 않도록
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        e.stopPropagation();
        finishEditing();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        document.execCommand('insertText', false, '    ');
      }
    },
  });
  setTableHandlers({
    onCellInput(id, r, c, text) {
      const a = getAnnotation(id);
      if (a?.type !== 'table' || !a.cells[r]) return;
      a.cells[r][c] = text;
      refresh([a.page]); // 행 높이가 내용에 맞춰 바로 늘어나도록 (입력 중인 칸의 글자는 건드리지 않는다)
      const changed = !!editOrigin && editOrigin.id === id && text !== editOrigin.text;
      if (changed !== liveTextChanged) {
        liveTextChanged = changed;
        dirtyListener();
      }
    },
    onCellBlur(id) {
      if (!document.hasFocus()) return;
      if (store.editingId === id) finishEditing();
    },
    onCellKeyDown(_id, e) {
      if (e.isComposing) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        e.stopPropagation();
        finishEditing();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        moveCell(e.shiftKey ? -1 : 1);
      }
    },
  });
}

export function isDirty() {
  return history.dirty || liveTextChanged;
}

export function snapshot(): Snapshot {
  return { annotations: store.annotations, deleted: [...store.deleted] };
}

let committedDuringEdit = false;

export function commit(coalesceKey?: string) {
  if (store.editingId) committedDuringEdit = true;
  history.push(snapshot(), coalesceKey);
  emit('history');
}

export function resetHistory() {
  editOrigin = null;
  liveTextChanged = false;
  history.reset(snapshot());
  emit('history');
}

/** 주석 레이어 다시 그리기 */
export function refresh(pages: number[] | null) {
  if (!viewer) return;
  const targets = pages ? [...new Set(pages)].map((i) => viewer.views[i]).filter(Boolean) : viewer.views;
  targets.forEach(renderPageOverlay);
  emit('annotations', pages);
}

function pagesOf(...anns: Array<Annotation | undefined>) {
  return anns.filter((a): a is Annotation => !!a).map((a) => a.page);
}

// ---------------------------------------------------------------------------
// 선택 / 도구
// ---------------------------------------------------------------------------

export function select(id: string | null) {
  if (store.selectedId === id) return;
  const prev = getAnnotation(store.selectedId);
  store.selectedId = id;
  if (getAnnotation(id)?.type !== 'table') store.activeCell = null;
  refresh(pagesOf(prev, getAnnotation(id)));
  emit('selection');
}

/** 표를 선택하고 칸 하나를 '현재 칸'으로 (행·열 추가/삭제 기준) */
export function selectCell(id: string, r: number, c: number) {
  const prev = getAnnotation(store.selectedId);
  const a = getAnnotation(id);
  if (a?.type !== 'table') return;
  store.selectedId = id;
  store.activeCell = { r, c };
  refresh(pagesOf(prev, a));
  emit('selection');
}

export function setTool(tool: Tool) {
  finishEditing();
  if (store.tool === tool) return;
  store.tool = tool;
  // 다른 도구를 고르면 그 도구와 상관없는 선택은 푼다 (옵션 막대에 도구 설정이 보이도록)
  const sel = getAnnotation(store.selectedId);
  if (sel && tool !== 'select' && sel.type !== tool) select(null);
  emit('tool');
}

// ---------------------------------------------------------------------------
// 주석 추가/수정/삭제
// ---------------------------------------------------------------------------

export function addAnnotations(list: Annotation[], selectLast = true) {
  if (!list.length) return;
  store.annotations.push(...list);
  const prev = getAnnotation(store.selectedId);
  if (selectLast) store.selectedId = list[list.length - 1].id;
  refresh([...pagesOf(prev), ...list.map((a) => a.page)]);
  commit();
  emit('selection');
}

export function updateAnnotation(
  id: string,
  patch: Partial<TextAnnotation> | Partial<HighlightAnnotation> | Partial<TableAnnotation>,
  coalesceKey?: string,
) {
  const a = getAnnotation(id);
  if (!a) return;
  Object.assign(a, patch);
  refresh([a.page]);
  commit(coalesceKey);
}

export function deleteAnnotation(id: string) {
  const a = getAnnotation(id);
  if (!a) return;
  if (store.editingId === id) {
    store.editingId = null;
    store.editingCell = null;
    editOrigin = null;
    liveTextChanged = false;
  }
  store.annotations = store.annotations.filter((x) => x.id !== id);
  if (store.selectedId === id) {
    store.selectedId = null;
    store.activeCell = null;
  }
  refresh([a.page]);
  commit();
  emit('selection');
}

export function nudgeSelected(dx: number, dy: number) {
  const a = getAnnotation(store.selectedId);
  if (!a || store.editingId) return;
  if (a.type === 'highlight') a.points = a.points.map((v, i) => v + (i % 2 ? dy : dx));
  else {
    a.x += dx;
    a.y += dy;
  }
  refresh([a.page]);
  commit(`nudge:${a.id}`);
}

export function applyTextStyle(patch: Partial<typeof store.textStyle>) {
  Object.assign(store.textStyle, patch);
  const a = getAnnotation(store.selectedId);
  if (a?.type === 'text') updateAnnotation(a.id, patch, `style:${a.id}:${Object.keys(patch).join()}`);
  emit('style');
}

export function applyHighlightStyle(patch: Partial<typeof store.highlightStyle>) {
  Object.assign(store.highlightStyle, patch);
  const a = getAnnotation(store.selectedId);
  if (a?.type === 'highlight') updateAnnotation(a.id, patch, `style:${a.id}:${Object.keys(patch).join()}`);
  emit('style');
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

/** 새 표의 크기(행·열)·글자 크기 기본값, 그리고 선택된 표의 글자 크기·정렬·머리글·색 */
export function applyTableStyle(patch: Partial<Pick<TableAnnotation, 'size' | 'align' | 'header' | 'color'>> & { rows?: number; cols?: number }) {
  const { rows, cols, ...tablePatch } = patch;
  if (rows !== undefined) store.tableStyle.rows = rows;
  if (cols !== undefined) store.tableStyle.cols = cols;
  if (tablePatch.size !== undefined) store.tableStyle.size = tablePatch.size;
  const a = getAnnotation(store.selectedId);
  if (a?.type === 'table' && Object.keys(tablePatch).length) {
    finishEditing();
    updateAnnotation(a.id, tablePatch, `style:${a.id}:${Object.keys(tablePatch).join()}`);
  }
  emit('style');
}

export type TableCommand = 'rowBelow' | 'colRight' | 'deleteRow' | 'deleteCol';

/** 현재 칸 기준으로 행·열을 넣거나 지운다. 지울 수 없으면(마지막 한 줄) false */
export function tableCommand(cmd: TableCommand): boolean {
  const a = getAnnotation(store.selectedId);
  if (a?.type !== 'table') return false;
  finishEditing();
  const cell = store.activeCell ?? { r: a.rows.length - 1, c: a.cols.length - 1 };
  const r = Math.min(cell.r, a.rows.length - 1);
  const c = Math.min(cell.c, a.cols.length - 1);
  if (cmd === 'rowBelow') {
    insertRow(a, r + 1);
    store.activeCell = { r: r + 1, c };
  } else if (cmd === 'colRight') {
    insertCol(a, c + 1);
    store.activeCell = { r, c: c + 1 };
  } else if (cmd === 'deleteRow') {
    if (!deleteRow(a, r)) return false;
    store.activeCell = { r: Math.min(r, a.rows.length - 1), c };
  } else {
    if (!deleteCol(a, c)) return false;
    store.activeCell = { r, c: Math.min(c, a.cols.length - 1) };
  }
  refresh([a.page]);
  commit();
  emit('selection');
  return true;
}

/** Tab / Shift+Tab: 다음·이전 칸으로. 마지막 칸에서 Tab 을 누르면 행을 하나 늘린다. */
function moveCell(dir: 1 | -1) {
  const a = getAnnotation(store.editingId);
  const cell = store.editingCell;
  if (a?.type !== 'table' || !cell) return;
  const idx = cell.r * a.cols.length + cell.c + dir;
  finishEditing();
  if (idx >= a.rows.length * a.cols.length) {
    insertRow(a, a.rows.length);
    refresh([a.page]);
    commit();
  }
  const next = Math.max(0, idx);
  startCellEditing(a.id, Math.floor(next / a.cols.length), next % a.cols.length);
}

export function startCellEditing(id: string, r: number, c: number, caret?: { clientX: number; clientY: number }) {
  const a = getAnnotation(id);
  if (a?.type !== 'table' || r < 0 || r >= a.rows.length || c < 0 || c >= a.cols.length) return;
  if (store.editingId) finishEditing();
  const prevSel = getAnnotation(store.selectedId);
  store.selectedId = id;
  store.editingId = id;
  store.editingCell = { r, c };
  store.activeCell = { r, c };
  editOrigin = { id, text: a.cells[r][c], isNew: false };
  liveTextChanged = false;
  committedDuringEdit = false;
  refresh(pagesOf(prevSel, a));
  emit('selection');
  const body = cellBodyOf(viewer.views[a.page], id, r, c);
  if (!body) return;
  body.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  let range = caret ? caretRangeAt(caret.clientX, caret.clientY, body) : null;
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------------------------------------------------------------------------
// 페이지 삭제
// ---------------------------------------------------------------------------

/** 성공하면 삭제한 페이지 수, 실패하면 0 */
export function deletePages(indices: number[]): number {
  if (!store.doc) return 0;
  finishEditing();
  const targets = [...new Set(indices)].filter((i) => !store.deleted.has(i) && i >= 0 && i < store.doc!.pages.length);
  if (!targets.length) return 0;
  if (livePages().length - targets.length < 1) return -1;
  targets.forEach((i) => store.deleted.add(i));
  const sel = getAnnotation(store.selectedId);
  if (sel && store.deleted.has(sel.page)) store.selectedId = null;
  store.pageSelection.clear();
  viewer.applyDeleted();
  commit();
  emit('pages');
  emit('pageSelection');
  emit('selection');
  return targets.length;
}

// ---------------------------------------------------------------------------
// 실행 취소 / 다시 실행
// ---------------------------------------------------------------------------

function restore(s: Snapshot) {
  const sameDeleted = s.deleted.length === store.deleted.size && s.deleted.every((i) => store.deleted.has(i));
  store.annotations = s.annotations;
  store.deleted = new Set(s.deleted);
  store.editingId = null;
  store.editingCell = null;
  if (!getAnnotation(store.selectedId)) store.selectedId = null;
  const sel = getAnnotation(store.selectedId);
  if (sel?.type !== 'table' || (store.activeCell && (store.activeCell.r >= sel.rows.length || store.activeCell.c >= sel.cols.length))) {
    store.activeCell = null;
  }
  if (!sameDeleted) {
    store.pageSelection.clear();
    viewer.applyDeleted();
    emit('pages');
    emit('pageSelection');
  }
  refresh(null);
  emit('history');
  emit('selection');
}

export function undo() {
  finishEditing();
  const s = history.undo();
  if (s) restore(s);
}

export function redo() {
  finishEditing();
  const s = history.redo();
  if (s) restore(s);
}

// ---------------------------------------------------------------------------
// 글상자 편집
// ---------------------------------------------------------------------------

function caretRangeAt(x: number, y: number, body: HTMLElement): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos && body.contains(pos.offsetNode)) {
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      r.collapse(true);
      return r;
    }
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r && body.contains(r.startContainer)) return r;
  }
  return null;
}

export function startEditing(id: string, caret?: { clientX: number; clientY: number }, isNew = false) {
  const a = getAnnotation(id);
  if (a?.type !== 'text') return;
  if (store.editingId && store.editingId !== id) finishEditing();
  const prevSel = getAnnotation(store.selectedId);
  store.editingId = id;
  store.selectedId = id;
  editOrigin = { id, text: a.text, isNew };
  liveTextChanged = false;
  committedDuringEdit = false;
  refresh(pagesOf(prevSel, a));
  emit('selection');
  const body = textBodyOf(viewer.views[a.page], id);
  if (!body) return;
  body.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) return;
  let range = caret ? caretRangeAt(caret.clientX, caret.clientY, body) : null;
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

export function finishEditing() {
  const id = store.editingId;
  if (!id) return;
  store.editingId = null;
  const origin = editOrigin?.id === id ? editOrigin : null;
  editOrigin = null;
  const hadLiveChange = liveTextChanged;
  liveTextChanged = false;
  const midEditCommit = committedDuringEdit;
  committedDuringEdit = false;
  const a = getAnnotation(id);
  if (a?.type === 'table') {
    const cell = store.editingCell;
    store.editingCell = null;
    let changed = false;
    if (cell && a.cells[cell.r]) {
      const body = cellBodyOf(viewer.views[a.page], id, cell.r, cell.c);
      if (body) {
        a.cells[cell.r][cell.c] = readText(body).replace(/\s+$/, '');
        if (document.activeElement === body) body.blur();
      }
      changed = !origin || origin.text !== a.cells[cell.r][cell.c];
    }
    window.getSelection()?.removeAllRanges();
    refresh([a.page]);
    if (changed || midEditCommit) commit();
    emit('selection');
    if (hadLiveChange) dirtyListener();
    return;
  }
  if (a?.type !== 'text') {
    emit('selection');
    return;
  }
  const body = textBodyOf(viewer.views[a.page], id);
  if (body) {
    a.text = readText(body).replace(/\s+$/, '');
    if (document.activeElement === body) body.blur();
  }
  window.getSelection()?.removeAllRanges();

  if (a.cover) {
    // 기존 글자 고치기: 열어 보기만 하고 바꾸지 않았으면 없던 일로, 글자를 다 지웠으면 '원래 글자 지우기'로 남긴다
    if (origin?.isNew && !midEditCommit && a.text === origin.text.replace(/\s+$/, '')) {
      store.annotations = store.annotations.filter((x) => x.id !== id);
      if (store.selectedId === id) store.selectedId = null;
      refresh([a.page]);
      emit('selection');
      if (hadLiveChange) dirtyListener();
      return;
    }
    refresh([a.page]);
    if (!origin || origin.isNew || origin.text !== a.text || midEditCommit) commit();
    emit('selection');
    if (hadLiveChange) dirtyListener();
    return;
  }

  if (!a.text.trim()) {
    store.annotations = store.annotations.filter((x) => x.id !== id);
    if (store.selectedId === id) store.selectedId = null;
    refresh([a.page]);
    if ((origin && !origin.isNew) || midEditCommit) commit();
    emit('selection');
    if (hadLiveChange) dirtyListener();
    return;
  }
  refresh([a.page]);
  if (!origin || origin.isNew || origin.text !== a.text || midEditCommit) commit();
  emit('selection');
  if (hadLiveChange) dirtyListener();
}
