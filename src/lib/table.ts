import { LINE_HEIGHT } from './fonts';
import { clamp } from './geometry';
import { uid } from './store';
import { measureText, wrapText } from './textLayout';
import type { PageInfo, TableAnnotation } from './types';

export const CELL_PAD_X = 4;
export const CELL_PAD_Y = 3;
export const TABLE_BORDER_WIDTH = 0.75;
export const HEADER_FILL = '#eceef3';
export const DEFAULT_COL_WIDTH = 80;
export const MIN_COL_WIDTH = 14;
export const MIN_ROW_HEIGHT = 10;

export function defaultRowHeight(size: number) {
  return Math.round(size * LINE_HEIGHT + CELL_PAD_Y * 2 + 2);
}

export interface TableLayout {
  colX: number[]; // 각 열의 왼쪽 x (마지막 값 = 전체 너비)
  rowY: number[]; // 각 행의 위쪽 y (마지막 값 = 전체 높이)
  lines: string[][][]; // [행][열] 줄바꿈된 글줄
  width: number;
  height: number;
}

export const isHeaderCell = (t: TableAnnotation, r: number) => t.header && r === 0;

export function layoutTable(t: TableAnnotation): TableLayout {
  const colX = [0];
  for (const w of t.cols) colX.push(colX[colX.length - 1] + w);
  const lineH = t.size * LINE_HEIGHT;
  const lines = t.cells.map((row, r) =>
    row.map((text, c) => wrapText(text, Math.max(1, t.cols[c] - CELL_PAD_X * 2), t.size, isHeaderCell(t, r))),
  );
  const rowY = [0];
  t.rows.forEach((minH, r) => {
    const n = Math.max(1, ...lines[r].map((l) => l.length));
    rowY.push(rowY[r] + Math.max(minH, n * lineH + CELL_PAD_Y * 2));
  });
  return { colX, rowY, lines, width: colX[colX.length - 1], height: rowY[rowY.length - 1] };
}

/** 칸 안 글줄의 위치 (표 왼쪽 위 기준). 화면(CSS)과 같은 규칙: 세로 가운데, 가로 왼쪽/가운데. */
export function cellLinePositions(t: TableAnnotation, L: TableLayout, r: number, c: number) {
  const lines = L.lines[r][c];
  const lineH = t.size * LINE_HEIGHT;
  const top = L.rowY[r] + (L.rowY[r + 1] - L.rowY[r] - lines.length * lineH) / 2;
  const bold = isHeaderCell(t, r);
  return lines.map((text, i) => {
    const x =
      t.align === 'center' ? L.colX[c] + (t.cols[c] - measureText(text, t.size, bold)) / 2 : L.colX[c] + CELL_PAD_X;
    return { text, x, top: top + i * lineH, bold };
  });
}

export function createTable(page: PageInfo, x: number, y: number, rows: number, cols: number, size: number): TableAnnotation {
  const avail = Math.max(MIN_COL_WIDTH * cols, page.width - x - 12);
  const colW = Math.max(MIN_COL_WIDTH, Math.min(DEFAULT_COL_WIDTH, avail / cols));
  const rowH = defaultRowHeight(size);
  return {
    id: uid('tb'),
    type: 'table',
    page: page.index,
    x: clamp(x, 0, Math.max(0, page.width - colW * cols)),
    y: clamp(y, 0, Math.max(0, page.height - rowH * rows)),
    cols: Array.from({ length: cols }, () => Math.round(colW * 10) / 10),
    rows: Array.from({ length: rows }, () => rowH),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
    size,
    color: '#111827',
    border: '#3f4452',
    align: 'left',
    header: false,
  };
}

// ---------------------------------------------------------------------------
// 행·열 편집 (표 객체를 직접 바꾼다)
// ---------------------------------------------------------------------------

export function insertRow(t: TableAnnotation, at: number) {
  const i = clamp(at, 0, t.rows.length);
  t.rows.splice(i, 0, defaultRowHeight(t.size));
  t.cells.splice(i, 0, t.cols.map(() => ''));
}

export function deleteRow(t: TableAnnotation, r: number): boolean {
  if (t.rows.length <= 1) return false;
  t.rows.splice(r, 1);
  t.cells.splice(r, 1);
  return true;
}

export function insertCol(t: TableAnnotation, at: number) {
  const i = clamp(at, 0, t.cols.length);
  const ref = t.cols[Math.min(Math.max(i - 1, 0), t.cols.length - 1)] ?? DEFAULT_COL_WIDTH;
  t.cols.splice(i, 0, ref);
  for (const row of t.cells) row.splice(i, 0, '');
}

export function deleteCol(t: TableAnnotation, c: number): boolean {
  if (t.cols.length <= 1) return false;
  t.cols.splice(c, 1);
  for (const row of t.cells) row.splice(c, 1);
  return true;
}
