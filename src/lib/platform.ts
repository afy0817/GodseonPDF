import { type Lang, t } from './i18n';
import type { OpenedFile, SaveResult } from './types';

/** electron/preload.cjs 가 노출하는 API */
interface GodseonApi {
  platform: string;
  openDialog(): Promise<OpenedFile | null>;
  openPath(path: string): Promise<OpenedFile>;
  pathForFile(file: File): string;
  save(path: string, data: Uint8Array): Promise<SaveResult>;
  saveAs(data: Uint8Array, suggestedName: string, defaultDir?: string): Promise<SaveResult | null>;
  confirmUnsaved(docName: string): Promise<'save' | 'discard' | 'cancel'>;
  setDocState(state: { dirty: boolean; hasDocument: boolean; title: string; path: string | null }): void;
  ready(): void;
  closeConfirmed(): void;
  onCommand(cb: (command: string) => void): () => void;
  onOpenFile(cb: (file: OpenedFile) => void): () => void;
  onSaveAndClose(cb: () => void): () => void;
  exportBegin(opts: { mode: 'file' | 'folder'; name: string; kind: string; defaultDir?: string }): Promise<{ id: string; path: string; name: string } | null>;
  exportWrite(id: string, name: string | null, chunks: Uint8Array[]): Promise<void>;
  exportFinish(id: string): Promise<SaveResult>;
  exportAbort(id: string): Promise<void>;
  exportReveal(path: string): Promise<void>;
  listSignatures(): Promise<Array<{ id: string; name: string; data: Uint8Array }>>;
  saveSignature(signature: { name: string; data: Uint8Array }): Promise<{ id: string }>;
  removeSignature(id: string): Promise<void>;
  listFonts(): Promise<Array<{ id: string; name: string; data: Uint8Array }>>;
  normalizeFont(data: Uint8Array): Promise<Array<{ data: Uint8Array; kind: string }>>;
  saveFont(font: { name: string; kind: string; data: Uint8Array }): Promise<{ id: string }>;
  removeFont(id: string): Promise<void>;
  getLanguage(): Lang;
  setLanguage(lang: Lang): void;
  onLanguage(cb: (lang: Lang) => void): () => void;
}

declare global {
  interface Window {
    godseon?: GodseonApi;
  }
}

const api = window.godseon;

export const isElectron = !!api;
export const os: string =
  api?.platform ?? (/Mac/i.test(navigator.userAgent) ? 'darwin' : /Win/i.test(navigator.userAgent) ? 'win32' : 'linux');

/** IPC 오류 메시지에서 "Error invoking remote method ..." 접두어 제거 */
function clean(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''));
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw clean(err);
  }
}

function toUint8(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function openDialog(): Promise<OpenedFile | null> {
  if (api) {
    const f = await call(() => api.openDialog());
    return f ? { ...f, data: toUint8(f.data) } : null;
  }
  const input = document.getElementById('pdf-input') as HTMLInputElement;
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, path: null, data: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function readDroppedPdf(file: File): Promise<OpenedFile> {
  if (api) {
    const p = api.pathForFile(file);
    if (p) {
      const f = await call(() => api.openPath(p));
      return { ...f, data: toUint8(f.data) };
    }
  }
  return { name: file.name, path: null, data: new Uint8Array(await file.arrayBuffer()) };
}

/**
 * 저장. path 가 있고 forceDialog 가 아니면 그 경로에 덮어쓰고, 아니면 저장 대화상자를 띄운다.
 * 브라우저에서 실행 중이면 파일 다운로드로 대신한다. 취소하면 null.
 */
export async function save(
  path: string | null,
  data: Uint8Array,
  suggestedName: string,
  forceDialog: boolean,
): Promise<SaveResult | null> {
  if (api) {
    if (path && !forceDialog) return call(() => api.save(path, data));
    return call(() => api.saveAs(data, suggestedName, path ? dirname(path) : undefined));
  }
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { name: suggestedName, path: null };
}

// ---------------------------------------------------------------------------
// 내보내기 (이미지로 저장): 저장할 곳을 먼저 고르고, 만든 데이터를 조금씩 넘겨 바로 쓴다
// ---------------------------------------------------------------------------

export type ExportKind = 'zip' | 'png' | 'jpg';

export interface ExportTarget {
  /** 저장될 파일(또는 폴더) 이름 */
  name: string;
  /** mode 'file': 파일 끝에 이어 쓴다 */
  append(chunks: Uint8Array[]): Promise<void>;
  /** mode 'folder': 폴더에 파일 하나를 쓴다 */
  writeFile(name: string, data: Uint8Array): Promise<void>;
  finish(): Promise<SaveResult>;
  /** 취소·실패: 쓰다 만 파일을 지운다 */
  abort(): Promise<void>;
}

const MIME: Record<ExportKind, string> = { zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg' };

/**
 * mode 'file' 은 파일 하나(ZIP 또는 이미지 한 장), 'folder' 는 고른 폴더 안에 새 폴더를 만들어 낱장으로 저장한다.
 * 브라우저에서는 모아 두었다가 다운로드한다 ('folder' 는 데스크톱 앱 전용). 취소하면 null.
 */
export async function beginExport(mode: 'file' | 'folder', name: string, kind: ExportKind, docPath: string | null): Promise<ExportTarget | null> {
  if (api) {
    const s = await call(() => api.exportBegin({ mode, name, kind, defaultDir: docPath ? dirname(docPath) : undefined }));
    if (!s) return null;
    return {
      name: s.name,
      append: (chunks) => call(() => api.exportWrite(s.id, null, chunks)),
      writeFile: (file, data) => call(() => api.exportWrite(s.id, file, [data])),
      finish: () => call(() => api.exportFinish(s.id)),
      abort: () => call(() => api.exportAbort(s.id)),
    };
  }
  if (mode === 'folder') return null;
  let parts: BlobPart[] = [];
  return {
    name,
    append: async (chunks) => {
      parts.push(...(chunks as Uint8Array<ArrayBuffer>[]));
    },
    writeFile: async () => {
      throw new Error('folder export is not available in the browser');
    },
    finish: async () => {
      const url = URL.createObjectURL(new Blob(parts, { type: MIME[kind] }));
      parts = [];
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { name, path: null };
    },
    abort: async () => {
      parts = [];
    },
  };
}

/** 방금 내보낸 파일·폴더를 탐색기(Finder)에서 보여 준다 */
export function revealExport(path: string) {
  if (api) void api.exportReveal(path).catch(() => {});
}

// ---------------------------------------------------------------------------
// 서명 서랍 저장소: 데스크톱 앱은 사용자 폴더의 파일, 브라우저는 localStorage
// ---------------------------------------------------------------------------

export interface StoredSignature {
  id: string;
  name: string;
  data: Uint8Array;
}

const SIG_KEY = 'godseon.signatures';

function readLocalSignatures(): Array<{ id: string; name: string; data: string }> {
  try {
    const list = JSON.parse(localStorage.getItem(SIG_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function listSignatures(): Promise<StoredSignature[]> {
  if (api) return (await call(() => api.listSignatures())).map((s) => ({ ...s, data: toUint8(s.data) }));
  return readLocalSignatures().map((s) => ({ id: s.id, name: s.name, data: fromBase64(s.data) }));
}

export async function saveSignature(name: string, data: Uint8Array): Promise<string> {
  if (api) return (await call(() => api.saveSignature({ name, data }))).id;
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const list = readLocalSignatures();
  list.unshift({ id, name, data: toBase64(data) });
  localStorage.setItem(SIG_KEY, JSON.stringify(list)); // 가득 차면 오류 → 화면에서 알림
  return id;
}

export async function removeSignature(id: string): Promise<void> {
  if (api) return call(() => api.removeSignature(id));
  try {
    localStorage.setItem(SIG_KEY, JSON.stringify(readLocalSignatures().filter((s) => s.id !== id)));
  } catch {
    /* 무시 */
  }
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

export async function confirmUnsaved(docName: string): Promise<'save' | 'discard' | 'cancel'> {
  if (api) return call(() => api.confirmUnsaved(docName));
  return window.confirm(t('confirm.unsavedBrowser', { name: docName })) ? 'discard' : 'cancel';
}

export function setDocState(state: { dirty: boolean; hasDocument: boolean; title: string; path: string | null }) {
  if (api) api.setDocState(state);
  else document.title = state.hasDocument ? `${state.dirty ? '● ' : ''}${state.title} — GodseonPDF` : 'GodseonPDF';
}

export function ready() {
  api?.ready();
}

export function closeConfirmed() {
  api?.closeConfirmed();
}

export function onCommand(cb: (command: string) => void) {
  api?.onCommand(cb);
}

export function onOpenFile(cb: (file: OpenedFile) => void) {
  api?.onOpenFile((f) => cb({ ...f, data: toUint8(f.data) }));
}

export function onSaveAndClose(cb: () => void) {
  api?.onSaveAndClose(cb);
}

// ---------------------------------------------------------------------------
// 사용자가 추가한 글꼴: Electron 이면 앱 데이터 폴더에 저장, 브라우저면 이번 실행에만
// ---------------------------------------------------------------------------

export async function listFonts() {
  if (!api) return [];
  const list = await call(() => api.listFonts());
  return list.map((f) => ({ ...f, data: toUint8(f.data) }));
}

export async function normalizeFont(data: Uint8Array): Promise<Array<{ data: Uint8Array; kind: string }>> {
  if (api) return (await call(() => api.normalizeFont(data))).map((f) => ({ ...f, data: toUint8(f.data) }));
  const magic = String.fromCharCode(...data.subarray(0, 4));
  if (magic === 'ttcf') throw new Error(t('err.ttcBrowser'));
  const kind = magic === 'OTTO' ? 'otf' : magic === 'wOFF' ? 'woff' : magic === 'true' || (data[0] === 0 && data[1] === 1) ? 'ttf' : '';
  if (!kind) throw new Error(t('err.fontFormatBrowser'));
  return [{ data, kind }];
}

export async function saveFont(font: { name: string; kind: string; data: Uint8Array }): Promise<{ id: string }> {
  if (api) return call(() => api.saveFont(font));
  return { id: Math.random().toString(36).slice(2, 12) };
}

export async function removeFont(id: string) {
  if (api) await call(() => api.removeFont(id));
}

// ---------------------------------------------------------------------------
// 언어: Electron 이면 메인 프로세스 설정(모든 창·메뉴가 같이 바뀜), 브라우저면 localStorage
// ---------------------------------------------------------------------------

const LANG_KEY = 'godseon.lang';

export function initialLanguage(): Lang {
  if (api) return api.getLanguage() === 'en' ? 'en' : 'ko';
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    /* 저장소를 쓸 수 없음 */
  }
  return /^ko\b/i.test(navigator.language) ? 'ko' : 'en';
}

export function saveLanguage(lang: Lang) {
  if (api) api.setLanguage(lang);
  else {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* 무시 */
    }
  }
}

export function onLanguage(cb: (lang: Lang) => void) {
  api?.onLanguage(cb);
}
