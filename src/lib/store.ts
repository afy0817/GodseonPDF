import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation, ImageAsset, PageInfo, Tool } from './types';

export interface LoadedDoc {
  name: string;
  path: string | null;
  bytes: Uint8Array; // 원본 PDF (저장할 때마다 이 원본에 편집 내용을 다시 적용한다)
  pdf: PDFDocumentProxy;
  pages: PageInfo[];
  password?: string;
}

export type ZoomMode = 'auto' | 'width' | 'custom';

export const store = {
  doc: null as LoadedDoc | null,
  annotations: [] as Annotation[],
  deleted: new Set<number>(),
  images: new Map<string, ImageAsset>(),
  tool: 'select' as Tool,
  selectedId: null as string | null,
  editingId: null as string | null,
  /** 표에서 글자를 입력 중인 칸 / 마지막으로 고른 칸 (행·열 추가 기준) */
  editingCell: null as { r: number; c: number } | null,
  activeCell: null as { r: number; c: number } | null,
  pageSelection: new Set<number>(),
  currentPage: 0,
  zoom: 1,
  zoomMode: 'auto' as ZoomMode,
  sidebarOpen: true,
  textStyle: { size: 12, color: '#111827', bold: false },
  highlightStyle: { color: '#ffe14d', width: 14, opacity: 0.5 },
  tableStyle: { rows: 3, cols: 3, size: 11 },
};

// ---------------------------------------------------------------------------
// 이벤트
// ---------------------------------------------------------------------------

export interface StoreEvents {
  doc: undefined;
  annotations: number[] | null; // 변경된 페이지 (null = 전체)
  pages: undefined; // 삭제된 페이지 목록 변경
  selection: undefined;
  tool: undefined;
  style: undefined;
  zoom: undefined;
  history: undefined;
  currentPage: undefined;
  pageSelection: undefined;
}

type Listener<T> = (payload: T) => void;
const listeners = new Map<keyof StoreEvents, Set<Listener<any>>>();

export function on<K extends keyof StoreEvents>(event: K, fn: Listener<StoreEvents[K]>) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
}

export function emit<K extends keyof StoreEvents>(event: K, ...payload: StoreEvents[K] extends undefined ? [] : [StoreEvents[K]]) {
  listeners.get(event)?.forEach((fn) => fn(payload[0]));
}

// ---------------------------------------------------------------------------
// 조회 도우미
// ---------------------------------------------------------------------------

export function getAnnotation(id: string | null): Annotation | undefined {
  if (!id) return undefined;
  return store.annotations.find((a) => a.id === id);
}

export function annotationsOn(page: number): Annotation[] {
  return store.annotations.filter((a) => a.page === page);
}

/** 삭제되지 않은 페이지들 (원본 순서) */
export function livePages(): PageInfo[] {
  return store.doc ? store.doc.pages.filter((p) => !store.deleted.has(p.index)) : [];
}

let counter = 0;
export function uid(prefix = 'a'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}
